import { DEFAULT_TIME_ZONE, civilToInstant, instantToCivil, isCivilDate } from "./civil-time";

/**
 * Track 8 — reading bank receipts (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md).
 *
 * Pure. Each bank's receipt, as the verifier relays it, states amounts, dates and
 * accounts in its own way: "1,500.00 ETB", "15-06-2025 14:30:00", "6/15/2025, 2:30:00
 * PM", "1****5678". These helpers turn them into integer santim, an instant, and a yes/no
 * on "was the university the one paid". Receipt times carry no zone; they are Addis
 * Ababa civil time.
 */

export const PAYMENT_PROVIDERS = ["CBE", "TELEBIRR", "DASHEN", "ABYSSINIA", "CBEBIRR"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

/** What a requester has to type besides the reference, per provider (verifier-api's inputs). */
export const PROVIDER_INPUT: Record<PaymentProviderId, { label: string; referenceLabel: string; extra: null | { kind: "SUFFIX"; digits: number; label: string } | { kind: "PHONE"; label: string } }> = {
  CBE: { label: "Commercial Bank of Ethiopia", referenceLabel: "Transaction reference (FT…)", extra: { kind: "SUFFIX", digits: 8, label: "Last 8 digits of the account you paid from" } },
  TELEBIRR: { label: "telebirr", referenceLabel: "Transaction number", extra: null },
  DASHEN: { label: "Dashen Bank", referenceLabel: "Transaction reference", extra: null },
  ABYSSINIA: { label: "Bank of Abyssinia", referenceLabel: "Transaction reference (FT…)", extra: { kind: "SUFFIX", digits: 5, label: "Last 5 digits of the account you paid from" } },
  CBEBIRR: { label: "CBE Birr", referenceLabel: "Receipt number", extra: { kind: "PHONE", label: "Phone number you paid from (2519…)" } },
};

/** "ETB 1,500.50", "1500.5 Birr", 1500.5 → 150050. Null when there is no number to read. */
export function parseAmountToSantim(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const [whole, fraction = ""] = match[0].split(".");
  const santim = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(santim) ? santim : null;
}

export interface ReceiptTime {
  at: Date;
  /** False when the receipt gave only a date — compare by civil date then. */
  hasTime: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

function civil(year: number, month: number, day: number, hour: number | null, minute: number | null, timeZone: string): ReceiptTime | null {
  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (!isCivilDate(date) || (hour !== null && (hour > 23 || minute! > 59))) return null;
  return { at: civilToInstant(date, hour === null ? "00:00" : `${pad(hour)}:${pad(minute!)}`, timeZone), hasTime: hour !== null };
}

function to24h(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const pm = meridiem.toUpperCase() === "PM";
  return hour === 12 ? (pm ? 12 : 0) : pm ? hour + 12 : hour;
}

/**
 * A receipt's payment date. Explicit zones ("…Z", "+03:00") are honoured; everything else
 * is read as civil time in `timeZone`. For d/m/y vs m/d/y: a part above 12 decides it;
 * otherwise "/" with AM/PM is American (CBE's receipts), and anything else is day-first.
 */
export function parseReceiptTime(value: unknown, timeZone: string = DEFAULT_TIME_ZONE): ReceiptTime | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();

  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const at = new Date(text);
    return Number.isNaN(at.getTime()) ? null : { at, hasTime: true };
  }

  const time = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  const hour = time ? to24h(Number(time[1]), time[3]) : null;
  const minute = time ? Number(time[2]) : null;

  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return civil(Number(iso[1]), Number(iso[2]), Number(iso[3]), hour, minute, timeZone);

  const numeric = text.match(/(\d{1,2})([/.-])(\d{1,2})\2(\d{4})/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[3]);
    const year = Number(numeric[4]);
    const monthFirst = a > 12 ? false : b > 12 ? true : numeric[2] === "/" && Boolean(time?.[3]);
    return monthFirst ? civil(year, a, b, hour, minute, timeZone) : civil(year, b, a, hour, minute, timeZone);
  }

  // "Jun 15, 2025 2:30 PM", "15 June 2025": let Date read the words, keep the parts as civil.
  const words = new Date(text.replace(/\s+at\s+/i, " "));
  if (!Number.isNaN(words.getTime()) && /[a-z]{3}/i.test(text)) {
    return civil(words.getFullYear(), words.getMonth() + 1, words.getDate(), hour, minute, timeZone);
  }
  return null;
}

/** Paid no earlier than the quote went out. A date-only receipt counts from the quote's civil date. */
export function paidAfter(receipt: ReceiptTime, quoteSentAt: Date, timeZone: string = DEFAULT_TIME_ZONE): boolean {
  if (receipt.hasTime) return receipt.at.getTime() >= quoteSentAt.getTime() - 60_000;
  return instantToCivil(receipt.at, timeZone).date >= instantToCivil(quoteSentAt, timeZone).date;
}

function words(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

export interface ReceiverConfig {
  /** The university's full account number (or wallet/merchant number) for this provider. */
  account: string | null;
  /** The account holder's name as the bank prints it. */
  name: string | null;
}

/**
 * Did this receipt pay the university? Receipts usually mask the account ("1****5678"),
 * so every run of digits it shows must sit in the right place in the configured number:
 * the last run at its end, a leading run at its start. When the receipt shows no digits
 * to compare, the holder's name decides (either containing the other, ignoring case and
 * punctuation — banks abbreviate). No comparable detail at all is a no.
 */
export function receiverMatches(receipt: { account: string | null; name: string | null }, config: ReceiverConfig): boolean {
  const configured = config.account?.replace(/\D/g, "") ?? "";
  const runs = receipt.account?.match(/\d+/g) ?? [];
  if (configured && runs.length) {
    const last = runs[runs.length - 1] ?? "";
    if (last.length < 4 || !configured.endsWith(last)) return false;
    if (runs.length > 1 && !configured.startsWith(runs[0] ?? "")) return false;
    return true;
  }
  const want = config.name ? words(config.name) : "";
  const got = receipt.name ? words(receipt.name) : "";
  if (want && got) return got.includes(want) || (got.length >= 8 && want.includes(got));
  return false;
}

/** A status line on the receipt, when the bank gives one, must say it went through. */
export function statusSaysPaid(status: unknown): boolean {
  if (status === undefined || status === null || status === "") return true;
  return /complete|success|verified|paid|settled/i.test(String(status)) && !/not|fail|pending|revers|unsuccess|declin|cancel/i.test(String(status));
}

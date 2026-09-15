import "server-only";
import { z } from "zod";
import type { Receipt, VerifierDriver, VerifyQuery, VerifyResult } from "./driver";

/**
 * The self-hosted verifier-api (github.com/Vixen878/verifier-api). One POST per provider
 * with an `x-api-key` header; each answers `{ success, ...fields }` in its own
 * vocabulary, parsed here leniently (banks add fields; amounts arrive as numbers or
 * "1,500.00 ETB") and mapped onto one `Receipt`.
 *
 * telebirr and CBE Birr receipts are only reachable from Ethiopian IP addresses, so the
 * instance serving those must be hosted in Ethiopia — see docs/payment-verifier.md.
 */

const TIMEOUT_MS = 20_000;
const loose = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const text = z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined || v === "" ? null : String(v)));
const any = z.unknown();

const endpoints = {
  CBE: {
    path: "/verify-cbe",
    body: (q: VerifyQuery) => ({ reference: q.reference, accountSuffix: q.accountSuffix }),
    schema: loose({ payerName: text, payerAccount: text, receiverName: text, receiverAccount: text, amount: any, date: any, reference: text }),
    map: (r: Record<string, unknown>) => ({ payerName: r.payerName, receiverName: r.receiverName, receiverAccount: r.receiverAccount, amount: r.amount, date: r.date, status: null, reference: r.reference }),
  },
  TELEBIRR: {
    path: "/verify-telebirr",
    body: (q: VerifyQuery) => ({ reference: q.reference }),
    schema: loose({ payerName: text, creditedPartyName: text, creditedPartyAccount: text, transactionStatus: any, receiptNumber: text, paymentDate: any, settledAmount: any, totalPaidAmount: any }),
    // settledAmount is what reached the university; fees and VAT are on top of it.
    map: (r: Record<string, unknown>) => ({ payerName: r.payerName, receiverName: r.creditedPartyName, receiverAccount: r.creditedPartyAccount, amount: r.settledAmount ?? r.totalPaidAmount, date: r.paymentDate, status: r.transactionStatus, reference: r.receiptNumber }),
  },
  DASHEN: {
    path: "/verify-dashen",
    body: (q: VerifyQuery) => ({ reference: q.reference }),
    schema: loose({ senderName: text, receiverName: text, transactionReference: text, transactionDate: any, transactionAmount: any }),
    map: (r: Record<string, unknown>) => ({ payerName: r.senderName, receiverName: r.receiverName, receiverAccount: null, amount: r.transactionAmount, date: r.transactionDate, status: null, reference: r.transactionReference }),
  },
  ABYSSINIA: {
    path: "/verify-abyssinia",
    body: (q: VerifyQuery) => ({ reference: q.reference, suffix: q.accountSuffix }),
    schema: loose({ transactionReference: text, accountInformation: text, paymentAmount: any, paymentDate: any, verificationStatus: any }),
    map: (r: Record<string, unknown>) => ({ payerName: null, receiverName: null, receiverAccount: r.accountInformation, amount: r.paymentAmount, date: r.paymentDate, status: r.verificationStatus, reference: r.transactionReference }),
  },
  CBEBIRR: {
    path: "/verify-cbebirr",
    body: (q: VerifyQuery) => ({ receiptNumber: q.reference, phoneNumber: q.phoneNumber }),
    schema: loose({ receiptNumber: text, payerDetails: any, receiverDetails: any, transactionAmount: any, paymentStatus: any, timestamp: any }),
    map: (r: Record<string, unknown>) => {
      const receiver = flatten(r.receiverDetails);
      return { payerName: flatten(r.payerDetails), receiverName: receiver, receiverAccount: receiver, amount: r.transactionAmount, date: r.timestamp, status: r.paymentStatus, reference: r.receiptNumber };
    },
  },
} as const;

/** CBE Birr's party details may be a string or a small object — one line of text either way. */
function flatten(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).filter((v) => typeof v === "string" || typeof v === "number").join(" ") || null;
  return String(value);
}

function reasonOf(body: unknown, fallback: string): string {
  const b = body as { error?: unknown; message?: unknown } | null;
  const said = typeof b?.error === "string" ? b.error : typeof b?.message === "string" ? b.message : null;
  return said ? said.slice(0, 300) : fallback;
}

export function httpVerifierDriver(baseUrl: string, apiKey: string): VerifierDriver {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    async verify(query): Promise<VerifyResult> {
      const endpoint = endpoints[query.provider];
      let response: Response;
      try {
        response = await fetch(`${base}${endpoint.path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify(endpoint.body(query)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
      } catch {
        return { ok: false, reason: "The payment verifier could not be reached.", unavailable: true };
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 429) {
        return { ok: false, reason: reasonOf(body, "The payment verifier is not available right now."), unavailable: true, raw: body };
      }
      const success = (body as { success?: unknown } | null)?.success === true;
      if (!response.ok || !success) {
        return { ok: false, reason: reasonOf(body, "The bank has no receipt matching these details."), unavailable: false, raw: body };
      }
      const parsed = endpoint.schema.safeParse(body);
      if (!parsed.success) return { ok: false, reason: "The bank's receipt could not be read.", unavailable: true, raw: body };
      const m = endpoint.map(parsed.data as Record<string, unknown>);
      const receipt: Receipt = {
        reference: typeof m.reference === "string" && m.reference ? m.reference : query.reference,
        payerName: typeof m.payerName === "string" ? m.payerName : null,
        receiverName: typeof m.receiverName === "string" ? m.receiverName : null,
        receiverAccount: typeof m.receiverAccount === "string" ? m.receiverAccount : null,
        amount: m.amount,
        date: m.date,
        status: m.status,
        raw: body,
      };
      return { ok: true, receipt };
    },
  };
}

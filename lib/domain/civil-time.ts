/**
 * Civil (wall-clock) time ↔ UTC instants, stated once — Track 6 of
 * ~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md, and §16.6 of
 * ~/.claude/plans/resource-register-and-scheduling.md.
 *
 * Every stored instant is UTC. Every human statement ("Monday 08:00 in Lab 3") is a
 * civil date + "HH:mm" + an IANA zone, converted here and nowhere else. The sandbox
 * this project started from stamped a bare `${local}Z` onto a datetime-local string,
 * silently shifting every class by three hours in Addis Ababa; nothing in this module
 * ever appends a "Z" to a local string.
 *
 * Pure — runs in the browser and on the server alike, no dependencies beyond `Intl`.
 */

export const DEFAULT_TIME_ZONE = "Africa/Addis_Ababa";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isCivilDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

export function isCivilTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** "HH:mm" → minutes since midnight. */
export function minutesOf(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Not a civil time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The zone's offset from UTC at a given instant, in milliseconds (east positive). */
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** A civil date + wall-clock time in `timeZone` → the UTC instant it names. Two-pass so
 *  a zone with DST resolves correctly on either side of a transition. */
export function civilToInstant(date: string, time: string, timeZone: string = DEFAULT_TIME_ZONE): Date {
  if (!isCivilDate(date)) throw new Error(`Not a civil date: ${date}`);
  const minutes = minutesOf(time);
  const [y, mo, d] = date.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  const first = offsetMs(wallAsUtc, timeZone);
  let instant = wallAsUtc - first;
  const second = offsetMs(instant, timeZone);
  if (second !== first) instant = wallAsUtc - second;
  return new Date(instant);
}

export interface CivilParts {
  date: string;
  time: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday. */
  weekday: number;
}

/** A UTC instant → what a wall clock in `timeZone` reads at that moment. */
export function instantToCivil(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): CivilParts {
  const local = new Date(instant.getTime() + offsetMs(instant.getTime(), timeZone));
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return { date, time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`, weekday: weekdayOf(date) };
}

/** ISO weekday of a civil date — a property of the calendar, not of any zone. */
export function weekdayOf(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The Monday of the ISO week containing `date`. */
export function startOfWeek(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export interface SeriesRule {
  weekdays: number[];
  startTimeLocal: string;
  endTimeLocal: string;
  startDate: string;
  endDate: string;
  timeZone: string;
}

export interface Occurrence {
  date: string;
  startsAt: Date;
  endsAt: Date;
}

/** Why a weekly rule is unusable, or null. Kept separate from expansion so a form can
 *  say what is wrong before anything is generated. */
export function validateSeriesRule(rule: SeriesRule): string | null {
  if (!rule.weekdays.length) return "Choose at least one weekday.";
  if (rule.weekdays.some((w) => !Number.isInteger(w) || w < 1 || w > 7)) return "Weekdays run from 1 (Monday) to 7 (Sunday).";
  if (!isCivilTime(rule.startTimeLocal) || !isCivilTime(rule.endTimeLocal)) return "Times must look like 08:00.";
  if (minutesOf(rule.endTimeLocal) <= minutesOf(rule.startTimeLocal)) return "A session must end after it starts, on the same day.";
  if (!isCivilDate(rule.startDate) || !isCivilDate(rule.endDate)) return "Dates must look like 2026-09-14.";
  if (rule.endDate < rule.startDate) return "The last date must not be before the first.";
  return null;
}

/** Every occurrence of a weekly rule within its own date range (inclusive), skipping
 *  `exceptions` (civil dates) and anything before `fromDate` when given — used when
 *  regenerating, so past occurrences are never rewritten. */
export function expandSeries(rule: SeriesRule, exceptions: Iterable<string> = [], fromDate?: string): Occurrence[] {
  const problem = validateSeriesRule(rule);
  if (problem) throw new Error(problem);
  const skip = new Set(exceptions);
  const days = new Set(rule.weekdays);
  const out: Occurrence[] = [];
  let date = fromDate && fromDate > rule.startDate ? fromDate : rule.startDate;
  while (date <= rule.endDate) {
    if (days.has(weekdayOf(date)) && !skip.has(date)) {
      out.push({
        date,
        startsAt: civilToInstant(date, rule.startTimeLocal, rule.timeZone),
        endsAt: civilToInstant(date, rule.endTimeLocal, rule.timeZone),
      });
    }
    date = addDays(date, 1);
  }
  return out;
}

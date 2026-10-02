/**
 * Calibration (2026-10-02): some machines must be calibrated every so many months
 * (analytical instruments, balances, testing machines). A category says how often
 * (`calibrationCycleMonths`); each item records when it was last done, as an ordinary
 * date detail of its category (`lastCalibrated`), so it is edited, drafted, exported
 * and kept in history like any other detail. Whether it is due is computed, never
 * stored: it changes with the calendar, not with an edit.
 */

/** The date detail every calibrated category carries. */
export const CALIBRATION_FIELD_KEY = "lastCalibrated";
export const CALIBRATION_FIELD_LABEL = "Last calibrated";

/** Due within this many days counts as "due soon". */
export const DUE_SOON_DAYS = 30;

export const calibrationStates = ["OK", "DUE_SOON", "OVERDUE", "NEVER"] as const;
export type CalibrationState = (typeof calibrationStates)[number];

export const CALIBRATION_LABEL: Record<CalibrationState, string> = {
  OK: "Calibrated",
  DUE_SOON: "Calibration due soon",
  OVERDUE: "Calibration overdue",
  NEVER: "Never calibrated",
};

export interface CalibrationInfo {
  state: CalibrationState;
  /** "YYYY-MM-DD", or null when it was never calibrated. */
  dueOn: string | null;
  /** Days until it is due (negative: overdue), or null when never calibrated. */
  days: number | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The same day N months on (the 31st of a short month lands on its last day). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

function dayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Today as "YYYY-MM-DD" (UTC is close enough for a day-granular due date). */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * An item's calibration, or null when its category isn't calibrated at all.
 * `lastCalibrated` is the item's `lastCalibrated` detail; anything that isn't a date
 * counts as never calibrated.
 */
export function calibrationOf(cycleMonths: number | null | undefined, lastCalibrated: unknown, today: string): CalibrationInfo | null {
  if (!cycleMonths || cycleMonths < 1) return null;
  if (typeof lastCalibrated !== "string" || !ISO.test(lastCalibrated)) return { state: "NEVER", dueOn: null, days: null };
  const dueOn = addMonths(lastCalibrated, cycleMonths);
  const days = dayNumber(dueOn) - dayNumber(today);
  const state: CalibrationState = days < 0 ? "OVERDUE" : days <= DUE_SOON_DAYS ? "DUE_SOON" : "OK";
  return { state, dueOn, days };
}

/** "due in 12 days", "due today", "overdue by 3 days", "never calibrated". */
export function calibrationWords(info: CalibrationInfo): string {
  if (info.days === null) return "never calibrated";
  if (info.days === 0) return "due today";
  if (info.days < 0) return `overdue by ${-info.days} day${info.days === -1 ? "" : "s"}`;
  return `due in ${info.days} day${info.days === 1 ? "" : "s"}`;
}

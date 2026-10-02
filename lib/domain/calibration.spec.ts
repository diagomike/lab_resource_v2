import { describe, expect, it } from "vitest";
import { addMonths, calibrationOf, calibrationWords } from "./calibration";

describe("calibration", () => {
  it("adds months, landing on a short month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2025-10-15", 12)).toBe("2026-10-15");
  });

  it("is due a cycle after it was last done", () => {
    expect(calibrationOf(12, "2025-12-01", "2026-10-03")).toEqual({ state: "OK", dueOn: "2026-12-01", days: 59 });
    expect(calibrationOf(12, "2025-10-20", "2026-10-03")).toMatchObject({ state: "DUE_SOON", days: 17 });
    expect(calibrationOf(6, "2026-03-01", "2026-10-03")).toMatchObject({ state: "OVERDUE", dueOn: "2026-09-01", days: -32 });
  });

  it("a calibrated kind with no date was never calibrated; an uncalibrated kind has no state", () => {
    expect(calibrationOf(12, null, "2026-10-03")).toEqual({ state: "NEVER", dueOn: null, days: null });
    expect(calibrationOf(12, "soon", "2026-10-03")?.state).toBe("NEVER");
    expect(calibrationOf(null, "2026-01-01", "2026-10-03")).toBeNull();
  });

  it("says it in words", () => {
    expect(calibrationWords({ state: "OVERDUE", dueOn: "x", days: -1 })).toBe("overdue by 1 day");
    expect(calibrationWords({ state: "DUE_SOON", dueOn: "x", days: 0 })).toBe("due today");
    expect(calibrationWords({ state: "NEVER", dueOn: null, days: null })).toBe("never calibrated");
  });
});

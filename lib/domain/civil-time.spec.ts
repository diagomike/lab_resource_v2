import { describe, expect, it } from "vitest";
import { addDays, civilToInstant, expandSeries, instantToCivil, startOfWeek, validateSeriesRule, weekdayOf } from "./civil-time";

describe("civilToInstant / instantToCivil", () => {
  it("08:00 in Addis Ababa is 05:00 UTC — the sandbox's `${local}Z` bug stamped it 08:00 UTC, three hours late", () => {
    const instant = civilToInstant("2026-09-14", "08:00", "Africa/Addis_Ababa");
    expect(instant.toISOString()).toBe("2026-09-14T05:00:00.000Z");
    expect(instant.toISOString()).not.toBe(new Date("2026-09-14T08:00:00Z").toISOString());
  });

  it("round-trips back to the same wall clock", () => {
    const instant = civilToInstant("2026-09-14", "14:30", "Africa/Addis_Ababa");
    expect(instantToCivil(instant, "Africa/Addis_Ababa")).toEqual({ date: "2026-09-14", time: "14:30", weekday: 1 });
  });

  it("an early-morning local time falls on the previous UTC day but keeps its own civil date", () => {
    const instant = civilToInstant("2026-09-15", "01:00", "Africa/Addis_Ababa");
    expect(instant.toISOString()).toBe("2026-09-14T22:00:00.000Z");
    expect(instantToCivil(instant, "Africa/Addis_Ababa").date).toBe("2026-09-15");
  });

  it("resolves a DST zone on both sides of a transition", () => {
    expect(civilToInstant("2026-01-15", "09:00", "Europe/Berlin").toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(civilToInstant("2026-07-15", "09:00", "Europe/Berlin").toISOString()).toBe("2026-07-15T07:00:00.000Z");
  });

  it("refuses malformed input rather than guessing", () => {
    expect(() => civilToInstant("2026-02-30", "08:00")).toThrow();
    expect(() => civilToInstant("2026-09-14", "8:00")).toThrow();
  });
});

describe("calendar helpers", () => {
  it("weekdayOf is ISO (Monday 1, Sunday 7)", () => {
    expect(weekdayOf("2026-09-14")).toBe(1);
    expect(weekdayOf("2026-09-20")).toBe(7);
  });

  it("addDays and startOfWeek cross month boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(startOfWeek("2026-10-01")).toBe("2026-09-28");
  });
});

describe("expandSeries", () => {
  const rule = { weekdays: [1, 3], startTimeLocal: "08:00", endTimeLocal: "10:00", startDate: "2026-09-14", endDate: "2026-09-27", timeZone: "Africa/Addis_Ababa" };

  it("materialises every matching weekday in the inclusive range", () => {
    const out = expandSeries(rule);
    expect(out.map((o) => o.date)).toEqual(["2026-09-14", "2026-09-16", "2026-09-21", "2026-09-23"]);
    expect(out[0].startsAt.toISOString()).toBe("2026-09-14T05:00:00.000Z");
    expect(out[0].endsAt.toISOString()).toBe("2026-09-14T07:00:00.000Z");
  });

  it("skips exception dates and anything before fromDate", () => {
    expect(expandSeries(rule, ["2026-09-16"], "2026-09-15").map((o) => o.date)).toEqual(["2026-09-21", "2026-09-23"]);
  });

  it("validates the rule before expanding", () => {
    expect(validateSeriesRule({ ...rule, endTimeLocal: "08:00" })).toMatch(/end after/);
    expect(validateSeriesRule({ ...rule, weekdays: [] })).toMatch(/weekday/);
    expect(validateSeriesRule({ ...rule, endDate: "2026-09-01" })).toMatch(/before the first/);
    expect(() => expandSeries({ ...rule, weekdays: [8] })).toThrow();
  });
});

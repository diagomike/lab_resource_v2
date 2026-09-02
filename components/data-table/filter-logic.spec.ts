import { describe, expect, it } from "vitest";
import { OPERATORS_BY_VARIANT } from "./config";
import {
  applyFilters,
  applyGlobal,
  comparatorFor,
  matchesValue,
  resolveRelative,
} from "./filter-logic";
import type { DataTableColumn, FilterVariant } from "./types";

/**
 * The operator matrix is the one part of the table that is worth testing without a
 * browser: it is pure, it is 14 operators wide, and every list screen in the app depends
 * on it agreeing with itself. Anything that needs a DOM is verified live instead.
 */

// A fixed "now" so every relative-date and boundary assertion is deterministic. Midday, so
// a bug that only shows up near a day boundary cannot hide behind the test clock.
const NOW = new Date(2026, 7, 20, 12, 0, 0); // 20 Aug 2026, local time

describe("matchesValue · text", () => {
  it("contains and notContains are case-insensitive substring tests", () => {
    expect(matchesValue("Digital Multimeter", "text", "contains", "multi")).toBe(true);
    expect(matchesValue("Digital Multimeter", "text", "contains", "MULTI")).toBe(true);
    expect(matchesValue("Digital Multimeter", "text", "notContains", "oscillo")).toBe(true);
    expect(matchesValue("Digital Multimeter", "text", "notContains", "multi")).toBe(false);
  });

  it("eq and ne compare the whole value, case-insensitively", () => {
    expect(matchesValue("Meron Assefa", "text", "eq", "meron assefa")).toBe(true);
    expect(matchesValue("Meron Assefa", "text", "eq", "Meron")).toBe(false);
    expect(matchesValue("Meron Assefa", "text", "ne", "Girma Wolde")).toBe(true);
  });

  it("treats a blank cell as neither equal nor unequal — isEmpty is the operator for that", () => {
    expect(matchesValue(null, "text", "eq", "anything")).toBe(false);
    expect(matchesValue(null, "text", "ne", "anything")).toBe(false);
    expect(matchesValue("", "text", "isEmpty", "")).toBe(true);
    expect(matchesValue("   ", "text", "isEmpty", "")).toBe(true);
    expect(matchesValue("x", "text", "isNotEmpty", "")).toBe(true);
  });

  it("passes everything through while the value is still blank", () => {
    expect(matchesValue("anything", "text", "contains", "")).toBe(true);
  });
});

describe("matchesValue · number and range", () => {
  it("covers every comparison operator", () => {
    expect(matchesValue(65, "number", "eq", "65")).toBe(true);
    expect(matchesValue(65, "number", "ne", "64")).toBe(true);
    expect(matchesValue(65, "number", "lt", "66")).toBe(true);
    expect(matchesValue(65, "number", "lt", "65")).toBe(false);
    expect(matchesValue(65, "number", "lte", "65")).toBe(true);
    expect(matchesValue(65, "number", "gt", "64")).toBe(true);
    expect(matchesValue(65, "number", "gte", "65")).toBe(true);
  });

  it("isBetween is inclusive at both ends and tolerates one open end", () => {
    expect(matchesValue(10, "number", "isBetween", ["10", "50"])).toBe(true);
    expect(matchesValue(50, "number", "isBetween", ["10", "50"])).toBe(true);
    expect(matchesValue(51, "number", "isBetween", ["10", "50"])).toBe(false);
    expect(matchesValue(9000, "number", "isBetween", ["5000", ""])).toBe(true);
    expect(matchesValue(4000, "number", "isBetween", ["5000", ""])).toBe(false);
    expect(matchesValue(4000, "number", "isBetween", ["", "5000"])).toBe(true);
    expect(matchesValue(4000, "number", "isBetween", ["", ""])).toBe(true);
  });

  it("parses grouped and prefixed numbers so a formatted column still filters", () => {
    expect(matchesValue("ETB 1,250", "number", "gt", "1000")).toBe(true);
    expect(matchesValue("ETB 1,250", "number", "lt", "1000")).toBe(false);
  });

  it("never matches a non-numeric cell on a comparison", () => {
    expect(matchesValue(null, "number", "gt", "0")).toBe(false);
    expect(matchesValue("—", "number", "gt", "0")).toBe(false);
    expect(matchesValue(null, "number", "isEmpty", "")).toBe(true);
  });

  it("range behaves as number does for isBetween", () => {
    expect(matchesValue(72, "range", "isBetween", ["50", "80"])).toBe(true);
    expect(matchesValue(90, "range", "isBetween", ["50", "80"])).toBe(false);
  });
});

describe("matchesValue · date", () => {
  const noonThatDay = new Date(2026, 7, 20, 12, 30).toISOString();
  const lateThatDay = new Date(2026, 7, 20, 23, 59, 30).toISOString();

  it("eq is day-granular, not instant-granular", () => {
    expect(matchesValue(noonThatDay, "date", "eq", "2026-08-20")).toBe(true);
    expect(matchesValue(lateThatDay, "date", "eq", "2026-08-20")).toBe(true);
    expect(matchesValue(noonThatDay, "date", "eq", "2026-08-21")).toBe(false);
    expect(matchesValue(noonThatDay, "date", "ne", "2026-08-21")).toBe(true);
  });

  // The Phase 4 PeriodReportPage trap: a "to" date anchored at midnight-start silently
  // excludes everything that happened on the day you asked for.
  it("isBetween includes the whole of both endpoint days", () => {
    expect(matchesValue(lateThatDay, "date", "isBetween", ["2026-08-20", "2026-08-20"])).toBe(true);
    expect(matchesValue(noonThatDay, "date", "isBetween", ["2026-08-01", "2026-08-20"])).toBe(true);
    expect(matchesValue(noonThatDay, "date", "isBetween", ["2026-08-01", "2026-08-19"])).toBe(false);
  });

  it("before/after respect the day boundary in the right direction", () => {
    expect(matchesValue(lateThatDay, "date", "lt", "2026-08-21")).toBe(true);
    expect(matchesValue(lateThatDay, "date", "lt", "2026-08-20")).toBe(false);
    expect(matchesValue(lateThatDay, "date", "lte", "2026-08-20")).toBe(true);
    expect(matchesValue(noonThatDay, "date", "gt", "2026-08-20")).toBe(false);
    expect(matchesValue(noonThatDay, "date", "gt", "2026-08-19")).toBe(true);
    expect(matchesValue(noonThatDay, "date", "gte", "2026-08-20")).toBe(true);
  });

  it("accepts a Date object as readily as an ISO string", () => {
    expect(matchesValue(new Date(2026, 7, 20, 9), "date", "eq", "2026-08-20")).toBe(true);
  });

  it("dateRange is isBetween", () => {
    expect(matchesValue(noonThatDay, "dateRange", "isBetween", ["2026-08-19", "2026-08-21"])).toBe(true);
  });
});

describe("matchesValue · isRelativeToToday", () => {
  const on = (d: Date) => matchesValue(d.toISOString(), "date", "isRelativeToToday", ["last7d"], NOW);

  it("resolves every preset to a non-empty inclusive window", () => {
    for (const preset of [
      "today",
      "yesterday",
      "last7d",
      "last30d",
      "last90d",
      "thisMonth",
      "thisYear",
      "next7d",
      "next30d",
    ]) {
      const window = resolveRelative(preset, NOW);
      expect(window, preset).not.toBeNull();
      expect(window![0], preset).toBeLessThan(window![1]);
    }
  });

  it("counts today as one of the last 7 days", () => {
    expect(on(new Date(2026, 7, 20, 8))).toBe(true); // today
    expect(on(new Date(2026, 7, 14, 8))).toBe(true); // 6 days back — the seventh day
    expect(on(new Date(2026, 7, 13, 23))).toBe(false); // 7 days back — outside
  });

  it("separates today from yesterday at the local midnight boundary", () => {
    const yesterdayLate = new Date(2026, 7, 19, 23, 59, 59).toISOString();
    const todayEarly = new Date(2026, 7, 20, 0, 0, 1).toISOString();
    expect(matchesValue(todayEarly, "date", "isRelativeToToday", ["today"], NOW)).toBe(true);
    expect(matchesValue(yesterdayLate, "date", "isRelativeToToday", ["today"], NOW)).toBe(false);
    expect(matchesValue(yesterdayLate, "date", "isRelativeToToday", ["yesterday"], NOW)).toBe(true);
  });

  it("spans the whole calendar month and year", () => {
    expect(matchesValue(new Date(2026, 7, 1, 0, 30).toISOString(), "date", "isRelativeToToday", ["thisMonth"], NOW)).toBe(true);
    expect(matchesValue(new Date(2026, 7, 31, 23, 30).toISOString(), "date", "isRelativeToToday", ["thisMonth"], NOW)).toBe(true);
    expect(matchesValue(new Date(2026, 6, 31, 23, 30).toISOString(), "date", "isRelativeToToday", ["thisMonth"], NOW)).toBe(false);
    expect(matchesValue(new Date(2026, 11, 31, 20).toISOString(), "date", "isRelativeToToday", ["thisYear"], NOW)).toBe(true);
    expect(matchesValue(new Date(2025, 11, 31, 20).toISOString(), "date", "isRelativeToToday", ["thisYear"], NOW)).toBe(false);
  });

  it("ignores an unknown preset rather than emptying the table", () => {
    expect(resolveRelative("lastFortnight", NOW)).toBeNull();
    expect(matchesValue(NOW.toISOString(), "date", "isRelativeToToday", ["lastFortnight"], NOW)).toBe(true);
  });
});

describe("matchesValue · boolean, select, multiSelect", () => {
  it("boolean eq/ne read true/false from either a real boolean or its text", () => {
    expect(matchesValue(true, "boolean", "eq", "true")).toBe(true);
    expect(matchesValue(false, "boolean", "eq", "false")).toBe(true);
    expect(matchesValue(true, "boolean", "ne", "false")).toBe(true);
    expect(matchesValue("yes", "boolean", "eq", "true")).toBe(true);
  });

  it("select compares the enum value exactly", () => {
    expect(matchesValue("NEEDS_REPAIR", "select", "eq", "NEEDS_REPAIR")).toBe(true);
    expect(matchesValue("NEEDS_REPAIR", "select", "eq", "needs_repair")).toBe(false);
    expect(matchesValue("NEEDS_REPAIR", "select", "ne", "GOOD")).toBe(true);
  });

  it("inArray is an OR across the checked set", () => {
    const roles = ["MANAGER", "STAFF"];
    expect(matchesValue(roles, "multiSelect", "inArray", ["MANAGER"])).toBe(true);
    expect(matchesValue(roles, "multiSelect", "inArray", ["SYS_ADMIN", "STAFF"])).toBe(true);
    expect(matchesValue(roles, "multiSelect", "inArray", ["SYS_ADMIN"])).toBe(false);
    expect(matchesValue(roles, "multiSelect", "notInArray", ["SYS_ADMIN"])).toBe(true);
    expect(matchesValue(roles, "multiSelect", "notInArray", ["STAFF"])).toBe(false);
  });

  it("an empty checked set filters nothing out", () => {
    expect(matchesValue(["MANAGER"], "multiSelect", "inArray", [])).toBe(true);
  });

  it("isEmpty on a multiSelect means the row holds no values at all", () => {
    expect(matchesValue([], "multiSelect", "isEmpty", "")).toBe(true);
    expect(matchesValue(["STAFF"], "multiSelect", "isEmpty", "")).toBe(false);
  });
});

describe("every declared operator is implemented for its variant", () => {
  // Guards against a variant gaining an operator in config.ts that matchesValue then falls
  // through to `default: return true` for — a filter that silently does nothing. Such an
  // operator returns true for EVERY input, so the check is simply: somewhere in a small
  // battery of cell values, this operator must reject at least one. Negated operators
  // (notContains, notInArray, isNotEmpty) legitimately accept a blank cell, which is why
  // the battery includes a real opposing value and not just null.
  const sample: Record<FilterVariant, unknown> = {
    text: "Digital Multimeter",
    number: 42,
    range: 42,
    date: new Date(2026, 7, 20, 10).toISOString(),
    dateRange: new Date(2026, 7, 20, 10).toISOString(),
    boolean: true,
    select: "GOOD",
    multiSelect: ["GOOD"],
  };
  const opposingRaw: Record<FilterVariant, unknown> = {
    text: "Oscilloscope",
    number: 999,
    range: 999,
    date: new Date(2020, 0, 1, 10).toISOString(),
    dateRange: new Date(2020, 0, 1, 10).toISOString(),
    boolean: false,
    select: "OBSOLETE",
    multiSelect: ["OBSOLETE"],
  };
  const opposingValue: Record<FilterVariant, string> = {
    text: "Oscilloscope",
    number: "999",
    range: "999",
    date: "2020-01-01",
    dateRange: "2020-01-01",
    boolean: "false",
    select: "OBSOLETE",
    multiSelect: "OBSOLETE",
  };

  for (const [variant, operators] of Object.entries(OPERATORS_BY_VARIANT)) {
    for (const op of operators) {
      it(`${variant} · ${op} rejects something`, () => {
        const v = variant as FilterVariant;
        const value =
          op === "isBetween"
            ? [opposingValue[v], opposingValue[v]]
            : op === "inArray" || op === "notInArray"
              ? [opposingValue[v]]
              : op === "isRelativeToToday"
                ? ["yesterday"]
                : opposingValue[v];
        const battery = [sample[v], opposingRaw[v], null];
        const results = battery.map((raw) => matchesValue(raw as never, v, op, value as never, NOW));
        expect(results.every((r) => typeof r === "boolean")).toBe(true);
        expect(results.includes(false), `${variant}.${op} accepted every input`).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------- applyFilters

interface Asset {
  tag: string;
  condition: string;
  cost: number | null;
  purchased: string | null;
  roles: string[];
}

const columns: DataTableColumn<Asset>[] = [
  { id: "tag", header: "Tag", cell: (a) => a.tag, variant: "text", value: (a) => a.tag },
  { id: "condition", header: "Condition", cell: (a) => a.condition, variant: "multiSelect", value: (a) => [a.condition] },
  { id: "cost", header: "Cost", cell: (a) => String(a.cost), variant: "number", value: (a) => a.cost },
  { id: "purchased", header: "Purchased", cell: (a) => a.purchased ?? "", variant: "date", value: (a) => a.purchased },
  { id: "roles", header: "Roles", cell: () => "", variant: "multiSelect", value: (a) => a.roles },
];

const rows: Asset[] = [
  { tag: "ASTU-000120", condition: "GOOD", cost: 12000, purchased: "2026-08-01T10:00:00.000Z", roles: ["A"] },
  { tag: "ASTU-000121", condition: "NEEDS_REPAIR", cost: 4000, purchased: "2024-02-15T10:00:00.000Z", roles: ["B"] },
  { tag: "ASTU-000122", condition: "GOOD", cost: null, purchased: null, roles: [] },
  { tag: "ASTU-000123", condition: "OBSOLETE", cost: 800, purchased: "2019-06-30T10:00:00.000Z", roles: ["A", "B"] },
];

describe("applyFilters", () => {
  it("and requires every filter to accept the row", () => {
    const out = applyFilters(
      rows,
      [
        { id: "condition", op: "inArray", v: ["GOOD"] },
        { id: "cost", op: "gt", v: "1000" },
      ],
      "and",
      columns,
      NOW,
    );
    expect(out.map((r) => r.tag)).toEqual(["ASTU-000120"]);
  });

  it("or accepts a row any single filter admits", () => {
    const out = applyFilters(
      rows,
      [
        { id: "condition", op: "inArray", v: ["OBSOLETE"] },
        { id: "cost", op: "gt", v: "10000" },
      ],
      "or",
      columns,
      NOW,
    );
    expect(out.map((r) => r.tag).sort()).toEqual(["ASTU-000120", "ASTU-000123"]);
  });

  it("supports two filters on the same column — impossible before this rewrite", () => {
    const out = applyFilters(
      rows,
      [
        { id: "cost", op: "gte", v: "1000" },
        { id: "cost", op: "lte", v: "5000" },
      ],
      "and",
      columns,
      NOW,
    );
    expect(out.map((r) => r.tag)).toEqual(["ASTU-000121"]);
  });

  it("ignores a filter naming a column that no longer exists", () => {
    const out = applyFilters(rows, [{ id: "ghostColumn", op: "contains", v: "x" }], "and", columns, NOW);
    expect(out).toHaveLength(rows.length);
  });

  it("returns every row when nothing is filtered", () => {
    expect(applyFilters(rows, [], "and", columns, NOW)).toHaveLength(4);
  });

  it("finds rows with no value at all via isEmpty", () => {
    const out = applyFilters(rows, [{ id: "purchased", op: "isEmpty", v: "" }], "and", columns, NOW);
    expect(out.map((r) => r.tag)).toEqual(["ASTU-000122"]);
  });
});

describe("applyGlobal", () => {
  it("searches across every column's raw value", () => {
    expect(applyGlobal(rows, columns, "needs_repair").map((r) => r.tag)).toEqual(["ASTU-000121"]);
    expect(applyGlobal(rows, columns, "000122").map((r) => r.tag)).toEqual(["ASTU-000122"]);
    expect(applyGlobal(rows, columns, "   ")).toHaveLength(4);
  });
});

describe("comparatorFor", () => {
  it("sorts numbers numerically, not as text", () => {
    const cmp = comparatorFor(columns.find((c) => c.id === "cost")!);
    const sorted = [...rows].sort(cmp).map((r) => r.cost);
    expect(sorted).toEqual([800, 4000, 12000, null]);
  });

  it("sorts dates chronologically", () => {
    const cmp = comparatorFor(columns.find((c) => c.id === "purchased")!);
    const sorted = [...rows].sort(cmp).map((r) => r.tag);
    expect(sorted).toEqual(["ASTU-000123", "ASTU-000121", "ASTU-000120", "ASTU-000122"]);
  });

  it("puts blanks last whatever the variant", () => {
    const cmp = comparatorFor(columns.find((c) => c.id === "cost")!);
    expect(cmp(rows[2], rows[0])).toBeGreaterThan(0);
    expect(cmp(rows[0], rows[2])).toBeLessThan(0);
  });

  it("sorts a text column naturally, so 9 comes before 10", () => {
    const col: DataTableColumn<{ n: string }> = { id: "n", header: "N", cell: (r) => r.n, variant: "text", value: (r) => r.n };
    const sorted = [{ n: "LAB 10" }, { n: "LAB 9" }, { n: "LAB 1" }].sort(comparatorFor(col));
    expect(sorted.map((r) => r.n)).toEqual(["LAB 1", "LAB 9", "LAB 10"]);
  });
});

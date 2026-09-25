import { describe, expect, it } from "vitest";
import { aggregatePurchasables, suggestedLines, type LabIdealRow, type LabIdealSheet } from "./purchasables";

const row = (categoryId: string, idealQty: number, actualCount: number, broken = 0): LabIdealRow => ({
  categoryId,
  categoryName: categoryId === "pc" ? "Computer" : categoryId === "mon" ? "Monitor" : "Chair",
  idealQty,
  actualCount,
  gap: Math.max(0, idealQty - actualCount),
  brokenItems: Array.from({ length: broken }, (_, i) => ({ id: `${categoryId}-b${i}`, name: "x", status: "BROKEN" })),
});

const sheet = (labItemId: string, rows: LabIdealRow[]): LabIdealSheet => ({ labItemId, labName: labItemId.toUpperCase(), rows });

describe("aggregatePurchasables", () => {
  it("sums ideal, current, gap and broken across labs, per category", () => {
    const out = aggregatePurchasables([sheet("a", [row("pc", 8, 6, 1), row("mon", 8, 8)]), sheet("b", [row("pc", 6, 3), row("mon", 6, 5)])]);
    const pc = out.find((r) => r.categoryId === "pc")!;
    expect(pc).toMatchObject({ idealQty: 14, actualCount: 9, gap: 5, brokenCount: 1 });
    expect(pc.labs.map((l) => [l.labItemId, l.gap])).toEqual([
      ["a", 2],
      ["b", 3],
    ]);
    expect(out.find((r) => r.categoryId === "mon")).toMatchObject({ idealQty: 14, actualCount: 13, gap: 1 });
  });

  it("does not let one lab's surplus cancel another lab's shortage", () => {
    const out = aggregatePurchasables([sheet("a", [row("pc", 2, 5)]), sheet("b", [row("pc", 4, 1)])]);
    expect(out[0]).toMatchObject({ idealQty: 6, actualCount: 6, gap: 3 });
  });

  it("ignores categories no lab set a target for, and orders by largest gap", () => {
    const out = aggregatePurchasables([sheet("a", [row("chair", 0, 12), row("mon", 4, 3), row("pc", 10, 2)])]);
    expect(out.map((r) => r.categoryId)).toEqual(["pc", "mon"]);
  });
});

describe("suggestedLines", () => {
  const rows = aggregatePurchasables([sheet("a", [row("pc", 8, 6, 1), row("mon", 4, 4, 2)]), sheet("b", [row("pc", 6, 3)])]);

  it("suggests the gap only by default, and drops categories with nothing to buy", () => {
    const lines = suggestedLines(rows, false);
    expect(lines).toEqual([{ categoryId: "pc", name: "Computer", qty: 5, justification: "Ideal 14, current 9 across 2 labs (A −2, B −3)" }]);
  });

  it("adds a replacement per broken unit when asked", () => {
    const lines = suggestedLines(rows, true);
    expect(lines.map((l) => [l.categoryId, l.qty])).toEqual([
      ["pc", 6],
      ["mon", 2],
    ]);
    expect(lines[1].justification).toBe("Ideal 4, current 4 across 1 lab (A −0 +2 broken)");
  });

  it("summarises the per-lab breakdown once more than four labs contribute", () => {
    const labs = ["a", "b", "c", "d", "e"].map((id, i) => sheet(id, [row("pc", 10, 10 - (i + 1))]));
    const [line] = suggestedLines(aggregatePurchasables(labs), false);
    expect(line.qty).toBe(15);
    expect(line.justification).toBe("Ideal 50, current 35 across 5 labs (5 labs; most in E −5, D −4, C −3)");
  });

  it("orders top-most missing items only, and replacements only for what failed itself", () => {
    // 5 workstations missing (each with a computer inside); 4 computers impaired by a
    // dead RAM stick each; those 4 RAM sticks are the broken ones.
    const ws: LabIdealRow = { ...row("ws", 25, 20), categoryName: "Workstation Setup", buyGap: 5, replaceCount: 0 };
    const pc: LabIdealRow = { ...row("pc", 25, 20, 4), buyGap: 0, replaceCount: 0 };
    const ram: LabIdealRow = { ...row("ram", 25, 20, 4), categoryName: "RAM", buyGap: 0, replaceCount: 4 };
    const out = aggregatePurchasables([sheet("a", [ws, pc, ram])]);
    expect(Object.fromEntries(suggestedLines(out, true).map((l) => [l.categoryId, l.qty]))).toEqual({ ws: 5, ram: 4 });
    expect(suggestedLines(out, false).map((l) => [l.categoryId, l.qty])).toEqual([["ws", 5]]);
    expect(out.find((r) => r.categoryId === "pc")).toMatchObject({ gap: 5, brokenCount: 4, buyGap: 0, replaceCount: 0 });
  });
});

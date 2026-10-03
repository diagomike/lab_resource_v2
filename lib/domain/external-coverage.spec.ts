import { describe, expect, it } from "vitest";
import { coverageLine, coverageOf, type Setup } from "./external-coverage";

const setups: Setup[] = [
  {
    placeCategoryId: "lab",
    placeCategoryName: "Lab",
    count: 2,
    needs: [
      { categoryId: "ws", categoryName: "Workstation", qty: 25 },
      { categoryId: "proj", categoryName: "Projector", qty: 1 },
    ],
  },
];

describe("outside-request coverage", () => {
  it("counts places and things per window against what the setups need", () => {
    const c = coverageOf(setups, ["d1", "d2"], [
      { windowKey: "d1", placeCategoryId: "lab", counts: { ws: 20, proj: 1 } },
      { windowKey: "d1", placeCategoryId: "lab", counts: { ws: 30, proj: 1 } },
      { windowKey: "d2", placeCategoryId: "lab", counts: { ws: 28 } },
    ]);
    expect(c.windows[0].complete).toBe(true);
    expect(c.windows[1].rows).toEqual([
      { label: "Lab", have: 1, need: 2 },
      { label: "Workstation", have: 28, need: 50 },
      { label: "Projector", have: 0, need: 2 },
    ]);
    expect(c.complete).toBe(false);
    expect(coverageLine(c.windows[1])).toBe("1 of 2 Lab · 28 of 50 Workstation · 0 of 2 Projector");
  });

  it("nothing held covers nothing; no windows is never complete", () => {
    expect(coverageOf(setups, ["d1"], []).complete).toBe(false);
    expect(coverageOf(setups, [], []).complete).toBe(false);
  });
});

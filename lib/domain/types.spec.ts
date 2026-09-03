import { describe, expect, it } from "vitest";
import { CONFIRMED_CHANGES, needsConfirm, type ChangeKind } from "./types";

describe("needsConfirm", () => {
  it("does not confirm a single-item correction", () => {
    expect(needsConfirm("setName", 1)).toBe(false);
    expect(needsConfirm("setProperty", 1)).toBe(false);
    expect(needsConfirm("setQuantity", 1)).toBe(false);
    expect(needsConfirm("addImage", 1)).toBe(false);
  });

  it("confirms every consequential kind even for one item", () => {
    for (const [kind, confirmed] of Object.entries(CONFIRMED_CHANGES) as [ChangeKind, boolean][]) {
      if (confirmed) expect(needsConfirm(kind, 1)).toBe(true);
    }
  });

  it("confirms an ordinarily-inline kind once the selection is a bulk one", () => {
    expect(needsConfirm("setName", 2)).toBe(true);
    expect(needsConfirm("setProperty", 25)).toBe(true);
  });
});

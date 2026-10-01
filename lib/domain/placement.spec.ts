import { describe, expect, it } from "vitest";
import { canPlace } from "./placement";
import type { Category } from "./types";

const category = (id: string, over: Partial<Category> = {}): Category => ({
  id,
  name: id,
  iconKey: "Package",
  group: "Test",
  countingMode: "SERIALIZED",
  fields: [],
  defaultChildren: [],
  impairRule: "ANY_CRITICAL",
  version: 0,
  ...over,
});

const categories = {
  lab: category("lab", { isPlace: true }),
  store: category("store", { isPlace: true }),
  computer: category("computer", { defaultChildren: [{ categoryId: "motherboard", qty: 1, critical: true }] }),
  motherboard: category("motherboard", { defaultChildren: [{ categoryId: "ram", qty: 2, critical: true }] }),
  ram: category("ram"),
  chair: category("chair"),
};

describe("canPlace — places are top level, things go inside", () => {
  it("a place is top level only, never inside anything", () => {
    expect(canPlace(categories, "lab", null)).toBe(true);
    expect(canPlace(categories, "lab", "store")).toBe(false);
    expect(canPlace(categories, "store", "computer")).toBe(false);
  });

  it("a thing goes into any place, never at the top level", () => {
    expect(canPlace(categories, "computer", "lab")).toBe(true);
    expect(canPlace(categories, "chair", "store")).toBe(true);
    expect(canPlace(categories, "computer", null)).toBe(false);
  });

  it("inside another thing only when that thing is made of it", () => {
    expect(canPlace(categories, "motherboard", "computer")).toBe(true);
    expect(canPlace(categories, "ram", "motherboard")).toBe(true);
    expect(canPlace(categories, "ram", "computer")).toBe(false);
    expect(canPlace(categories, "chair", "computer")).toBe(false);
  });

  it("an unknown category goes nowhere", () => {
    expect(canPlace(categories, "nope", "lab")).toBe(false);
  });
});

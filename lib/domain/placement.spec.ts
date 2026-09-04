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
  canBeRoot: false,
  placement: "ANYWHERE",
  allowedParentCategoryIds: [],
  ...over,
});

describe("canPlace", () => {
  it("an ANYWHERE category may be placed inside any category", () => {
    const categories = { motherboard: category("motherboard"), computer: category("computer"), lab: category("lab") };
    expect(canPlace(categories, "motherboard", "computer")).toBe(true);
    expect(canPlace(categories, "motherboard", "lab")).toBe(true);
  });

  it("an ANYWHERE category still cannot be a root unless canBeRoot is set", () => {
    const categories = { motherboard: category("motherboard") };
    expect(canPlace(categories, "motherboard", null)).toBe(false);
  });

  it("canBeRoot alone permits a top-level placement, independent of the placement mode", () => {
    const categories = { lab: category("lab", { canBeRoot: true, placement: "ONLY_LISTED", allowedParentCategoryIds: [] }) };
    expect(canPlace(categories, "lab", null)).toBe(true);
  });

  it("an ONLY_LISTED category may go only where its own allow-list names, not anywhere else", () => {
    const categories = {
      lab: category("lab", { canBeRoot: true, placement: "ONLY_LISTED", allowedParentCategoryIds: [] }),
      store: category("store"),
    };
    // A lab may not go inside a store — it isn't on the lab's own allow-list, and a
    // lab's placement is ONLY_LISTED with an empty list: a root and nothing else.
    expect(canPlace(categories, "lab", "store")).toBe(false);
  });

  it("an ONLY_LISTED category with a real allow-list may go exactly where it names", () => {
    const categories = {
      chemical: category("chemical", { placement: "ONLY_LISTED", allowedParentCategoryIds: ["store", "lab"] }),
      store: category("store", { canBeRoot: true }),
      lab: category("lab", { canBeRoot: true }),
      computer: category("computer"),
    };
    expect(canPlace(categories, "chemical", "store")).toBe(true);
    expect(canPlace(categories, "chemical", "lab")).toBe(true);
    expect(canPlace(categories, "chemical", "computer")).toBe(false);
  });

  it("returns false for an unknown category rather than throwing", () => {
    expect(canPlace({}, "ghost", "lab")).toBe(false);
  });

  it("a category's own default subtree template is implicitly consistent when its parts stay ANYWHERE — the seed's own configuration", () => {
    // Mirrors the seeded shape: Computer (ANYWHERE) is built from Motherboard
    // (ANYWHERE), so the template edge never contradicts a placement rule.
    const categories = { computer: category("computer"), motherboard: category("motherboard") };
    expect(canPlace(categories, "motherboard", "computer")).toBe(true);
  });
});

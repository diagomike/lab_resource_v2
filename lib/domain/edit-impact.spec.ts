import { describe, expect, it } from "vitest";
import { categoryImpact, childrenImpact, detailsImpact } from "./edit-impact";
import { indexItems } from "./tree";
import type { Category, Item } from "./types";

const category = (over: Partial<Category> = {}): Category => ({
  id: "computer",
  name: "Computer",
  iconKey: "Package",
  group: "IT",
  countingMode: "SERIALIZED",
  fields: [
    { key: "brand", label: "Brand", type: "text" },
    { key: "type", label: "Type", type: "enum", options: ["Desktop", "Laptop"] },
  ],
  defaultChildren: [],
  impairRule: "ANY_CRITICAL",
  version: 0,
  ...over,
});

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  parentId: null,
  categoryId: "computer",
  name: id,
  qty: 1,
  status: "WORKING",
  critical: false,
  props: {},
  ownerOrgNodeId: "se",
  currentOrgNodeId: "se",
  custodianId: "u1",
  images: [],
  createdAt: "",
  updatedAt: "",
  version: 0,
  ...over,
});

describe("detailsImpact", () => {
  it("warns only when a value that exists is being erased", () => {
    const it1 = item("a", { props: { brand: "Dell", type: null } });
    expect(detailsImpact(it1, category(), { brand: "HP", type: null })).toHaveLength(0);
    expect(detailsImpact(it1, category(), { brand: null, type: null })).toMatchObject([{ severity: "warning" }]);
  });

  it("does not warn about filling in an empty field", () => {
    const it1 = item("a", { props: { brand: null } });
    expect(detailsImpact(it1, category(), { brand: "Dell" })).toHaveLength(0);
  });
});

describe("childrenImpact", () => {
  it("counts the whole subtree a removal would take with it", () => {
    const parent = item("p");
    const child = item("c", { parentId: "p" });
    const grandchild = item("g", { parentId: "c" });
    const index = indexItems([parent, child, grandchild]);

    const notes = childrenImpact(index, { computer: category() }, { remove: ["c"], add: [] });
    expect(notes[0].severity).toBe("destructive");
    // The child plus the one nested inside it.
    expect(notes[0].detail).toContain("2 rows");
  });

  it("flags removal of a critical part separately", () => {
    const parent = item("p");
    const child = item("c", { parentId: "p", critical: true });
    const index = indexItems([parent, child]);
    const notes = childrenImpact(index, { computer: category() }, { remove: ["c"], add: [] });
    expect(notes.some((n) => n.id === "children-critical")).toBe(true);
  });
});

describe("categoryImpact", () => {
  const items = [
    item("a", { props: { brand: "Dell", type: "Desktop" } }),
    item("b", { props: { brand: "HP", type: "Laptop" } }),
    item("c", { props: { brand: null, type: "Desktop" } }),
  ];

  it("counts the items holding a value for a removed field", () => {
    const after = category({ fields: [category().fields[1]] }); // drop `brand`
    const note = categoryImpact(category(), after, items).find((n) => n.id === "cat-field-removed-brand")!;
    expect(note.severity).toBe("destructive");
    expect(note.detail).toContain("2 items");
    expect(note.orphanKeys).toEqual(["brand"]);
  });

  it("downgrades a removal nothing is using to a warning with no orphans", () => {
    const empty = [item("a"), item("b")];
    const after = category({ fields: [category().fields[1]] });
    const note = categoryImpact(category(), after, empty).find((n) => n.id === "cat-field-removed-brand")!;
    expect(note.severity).toBe("warning");
    expect(note.orphanKeys).toBeUndefined();
  });

  it("counts values that cannot survive a type change", () => {
    const after = category({ fields: [{ key: "brand", label: "Brand", type: "number" }, category().fields[1]] });
    const note = categoryImpact(category(), after, items).find((n) => n.id === "cat-field-type-brand")!;
    expect(note.severity).toBe("destructive");
    // "Dell" and "HP" are not numbers; the null is not counted.
    expect(note.detail).toContain("2 stored values");
  });

  it("counts items stranded by dropping an enum choice", () => {
    const after = category({ fields: [category().fields[0], { key: "type", label: "Type", type: "enum", options: ["Desktop"] }] });
    const note = categoryImpact(category(), after, items).find((n) => n.id === "cat-option-type-Laptop")!;
    expect(note.severity).toBe("destructive");
    expect(note.detail).toContain("1 item");
  });

  it("treats a default-parts change as future-only, not destructive", () => {
    const after = category({ defaultChildren: [{ categoryId: "ram", qty: 1, critical: true }] });
    const notes = categoryImpact(category(), after, items);
    const note = notes.find((n) => n.id === "cat-part-added-ram")!;
    expect(note.severity).toBe("info");
    expect(notes.every((n) => n.severity !== "destructive")).toBe(true);
  });

  it("surfaces (not blocks) a collision when a new field's key already exists as an item-specific custom property, normalized", () => {
    const withCustom = item("d", { customProps: { "Serial Number": { type: "TEXT", value: "abc" } } });
    const after = category({ fields: [...category().fields, { key: "serial_number", label: "Serial Number", type: "text" }] });
    const notes = categoryImpact(category(), after, [...items, withCustom]);
    const note = notes.find((n) => n.id === "cat-field-custom-collision-serial_number");
    expect(note).toBeDefined();
    expect(note!.severity).toBe("warning");
    expect(note!.detail).toContain("side by side");
  });

  it("does not surface a collision note when no item's custom property normalizes to the new field's key", () => {
    const withCustom = item("d", { customProps: { warranty: { type: "TEXT", value: "1yr" } } });
    const after = category({ fields: [...category().fields, { key: "serial_number", label: "Serial Number", type: "text" }] });
    const notes = categoryImpact(category(), after, [...items, withCustom]);
    expect(notes.find((n) => n.id === "cat-field-custom-collision-serial_number")).toBeUndefined();
  });
});

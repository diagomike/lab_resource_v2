import { describe, expect, it } from "vitest";
import type { Category } from "./types";
import { applyVersionOp, diffVersion, idealStats, VersionOpError, type LiveItem, type VItem } from "./version-ops";

const cat = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
  id,
  name,
  iconKey: "Package",
  countingMode: "SERIALIZED",
  fields: [],
  defaultChildren: [],
  impairRule: "ANY_CRITICAL",
  group: "g",
  version: 1,
  ...extra,
});
const categories: Record<string, Category> = {
  lab: cat("lab", "Lab", { canBeRoot: true }),
  ws: cat("ws", "Workstation", { defaultChildren: [{ categoryId: "pc", qty: 1, critical: true }, { categoryId: "chair", qty: 1, critical: false }] }),
  pc: cat("pc", "Computer"),
  chair: cat("chair", "Chair"),
  outlet: cat("outlet", "Network Outlet"),
};

const v = (id: string, parentId: string | null, categoryId: string, name: string, sourceItemId: string | null = id, extra: Partial<VItem> = {}): VItem => ({
  id,
  parentId,
  sourceItemId,
  categoryId,
  name,
  qty: 1,
  status: "WORKING",
  critical: false,
  props: {},
  customProps: {},
  ...extra,
});
const live = (items: VItem[]): LiveItem[] =>
  items.map((i) => ({ id: i.sourceItemId!, parentId: i.parentId, categoryId: i.categoryId, name: i.name, qty: i.qty, status: i.status, props: i.props, customProps: i.customProps }));

let n = 0;
const ctx = { categories, newId: () => `new${++n}` };

// A lab with Workstation 01–03 (each a computer + chair).
const base: VItem[] = [
  v("lab", null, "lab", "Block 510 R8"),
  ...[1, 2, 3].flatMap((k) => [
    v(`ws${k}`, "lab", "ws", `Workstation 0${k}`),
    v(`pc${k}`, `ws${k}`, "pc", "Computer"),
    v(`ch${k}`, `ws${k}`, "chair", "Chair"),
  ]),
];
const current = live(base);
const baseIds = base.map((b) => b.id);
const labels = { categoryName: (id: string) => categories[id]?.name ?? id };

describe("applyVersionOp", () => {
  it("adds whole workstations with their parts, continuing the numbering", () => {
    const { items, touched } = applyVersionOp(base, { kind: "createItem", parentId: "lab", categoryId: "ws", count: 2 }, ctx);
    const names = touched.map((id) => items.find((i) => i.id === id)!.name);
    expect(names).toEqual(["Workstation 04", "Workstation 05"]);
    expect(items.length).toBe(base.length + 2 * 3);
    expect(items.filter((i) => i.sourceItemId === null).every((i) => i.id.startsWith("new"))).toBe(true);
  });

  it("refuses a placement the category rules forbid and a duplicate sibling name", () => {
    const strict = { ...ctx, categories: { ...categories, outlet: cat("outlet", "Network Outlet", { placement: "ONLY_LISTED", allowedParentCategoryIds: ["lab"] }) } };
    expect(() => applyVersionOp(base, { kind: "createItem", parentId: "ws1", categoryId: "outlet", count: 1 }, strict)).toThrow(VersionOpError);
    expect(() => applyVersionOp(base, { kind: "setName", itemIds: ["ws1"], value: "workstation 02" }, ctx)).toThrow(/already exists/);
  });

  it("never mutates its input, and removes a subtree", () => {
    const before = JSON.stringify(base);
    const { items } = applyVersionOp(base, { kind: "deleteItem", itemIds: ["ws2"] }, ctx);
    expect(JSON.stringify(base)).toBe(before);
    expect(items.map((i) => i.id)).not.toContain("pc2");
    expect(() => applyVersionOp(base, { kind: "deleteItem", itemIds: ["lab"] }, ctx)).toThrow(VersionOpError);
  });
});

describe("diffVersion", () => {
  it("reads a status change, an addition and a removal as plain lines", () => {
    let items = applyVersionOp(base, { kind: "setStatus", itemIds: ["pc1"], value: "BROKEN" }, ctx).items;
    items = applyVersionOp(items, { kind: "createItem", parentId: "lab", categoryId: "ws", count: 1 }, ctx).items;
    items = applyVersionOp(items, { kind: "deleteItem", itemIds: ["ws3"] }, ctx).items;
    const diff = diffVersion(items, current, baseIds, labels);
    expect(diff.map((d) => [d.kind, d.name, d.lines[0]])).toEqual([
      ["changed", "Computer", "Status: Working → Broken"],
      ["added", "Workstation 04", "Added in Block 510 R8 (with 2 parts)"],
      ["removed", "Workstation 03", "Removed from Block 510 R8 (with 2 parts)"],
    ]);
    // Markers land on real items: the change on itself, the addition on the lab.
    expect(diff.map((d) => d.markerItemId)).toEqual(["pc1", "lab", "ws3"]);
  });

  it("ignores live items that arrived after the copy was taken", () => {
    const arrived = [...current, { id: "late", parentId: "lab", categoryId: "chair", name: "Spare chair", qty: 1, status: "WORKING" as const, props: {}, customProps: {} }];
    expect(diffVersion(base, arrived, baseIds, labels)).toEqual([]);
  });

  it("reports a move between containers", () => {
    // Workstation 02 already has a "Chair" — moving another one in would duplicate it.
    expect(() => applyVersionOp(base, { kind: "moveInTree", itemIds: ["ch1"], value: "ws2" }, ctx)).toThrow(/already in/);
    const renamed = applyVersionOp(base, { kind: "setName", itemIds: ["ch1"], value: "Spare chair" }, ctx).items;
    const { items } = applyVersionOp(renamed, { kind: "moveInTree", itemIds: ["ch1"], value: "ws2" }, ctx);
    expect(diffVersion(items, current, baseIds, labels)[0].lines).toEqual(["Name: Chair → Spare chair", "Moved from Workstation 01 into Workstation 02"]);
  });

  it("names nested places by their path inside the lab, not just the nearest container", () => {
    const { items } = applyVersionOp(base, { kind: "deleteItem", itemIds: ["pc1"] }, ctx);
    expect(diffVersion(items, current, baseIds, labels)[0].lines).toEqual(["Removed from Workstation 01"]);
    const added = applyVersionOp(base, { kind: "createItem", parentId: "pc1", categoryId: "chair", count: 1, name: "Stool" }, ctx).items;
    expect(diffVersion(added, current, baseIds, labels)[0].lines[0]).toBe("Added in Workstation 01 › Computer");
  });
});

describe("idealStats", () => {
  it("counts ideal against current per category and lists what is missing", () => {
    const ideal = applyVersionOp(base, { kind: "createItem", parentId: "lab", categoryId: "ws", count: 2 }, ctx).items;
    const stats = Object.fromEntries(idealStats(ideal, current, "lab").map((r) => [r.categoryId, r]));
    expect(stats.ws).toMatchObject({ idealCount: 5, currentCount: 3, gap: 2 });
    expect(stats.ws.missing.map((m) => m.name)).toEqual(["Workstation 04", "Workstation 05"]);
    expect(stats.pc).toMatchObject({ idealCount: 5, currentCount: 3, gap: 2 });
    expect(stats.lab).toBeUndefined();
  });
});

/**
 * temp_works never had a dedicated spec for instantiate.ts (only data-engine.test.ts
 * importing `newId` in passing) — a fresh spec for the recursive subtree builder
 * itself, since it is meaningful production logic (the "Add N × category" dialog and
 * the real-data importer both depend on it).
 */
import { describe, expect, it } from "vitest";
import { buildSubtree, instantiateMany } from "./instantiate";
import type { Category } from "./types";

const now = "2026-01-01T00:00:00.000Z";
const ctx = { ownerOrgNodeId: "se", custodianId: "u1", now };

const categories: Record<string, Category> = {
  computer: {
    id: "computer",
    name: "Computer",
    iconKey: "Laptop",
    group: "IT",
    countingMode: "SERIALIZED",
    version: 0,
    fields: [{ key: "brand", label: "Brand", type: "text" }],
    defaultChildren: [
      { categoryId: "monitor", qty: 1, critical: true },
      { categoryId: "speaker", qty: 2, critical: false },
    ],
    impairRule: "ANY_CRITICAL",
  },
  monitor: { id: "monitor", name: "Monitor", iconKey: "Monitor", group: "IT", countingMode: "SERIALIZED", version: 0, fields: [], defaultChildren: [], impairRule: "ANY_CRITICAL" },
  speaker: { id: "speaker", name: "Speaker", iconKey: "Speaker", group: "IT", countingMode: "SERIALIZED", version: 0, fields: [], defaultChildren: [], impairRule: "ANY_CRITICAL" },
};

describe("buildSubtree", () => {
  it("creates the root with a null-initialised prop for every field", () => {
    const rows = buildSubtree(categories, "monitor", null, "Monitor A", false, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ parentId: null, categoryId: "monitor", name: "Monitor A", status: "WORKING", qty: 1, version: 1 });
  });

  it("scaffolds the whole default subtree recursively, in one call", () => {
    const rows = buildSubtree(categories, "computer", null, "Computer 1", false, ctx);
    // 1 computer + 1 monitor + 2 speakers.
    expect(rows).toHaveLength(4);
    const root = rows[0];
    const children = rows.slice(1);
    expect(children.every((r) => r.parentId === root.id)).toBe(true);
    expect(children.filter((r) => r.categoryId === "speaker")).toHaveLength(2);
  });

  it("carries the template's critical flag onto each instantiated child", () => {
    const rows = buildSubtree(categories, "computer", null, "Computer 1", false, ctx);
    const monitor = rows.find((r) => r.categoryId === "monitor")!;
    const speaker = rows.find((r) => r.categoryId === "speaker")!;
    expect(monitor.critical).toBe(true);
    expect(speaker.critical).toBe(false);
  });

  it("numbers same-category siblings when there is more than one", () => {
    const rows = buildSubtree(categories, "computer", null, "Computer 1", false, ctx);
    const speakers = rows.filter((r) => r.categoryId === "speaker");
    expect(speakers.map((r) => r.name)).toEqual(["Speaker 1", "Speaker 2"]);
  });

  it("defaults currentOrgNodeId to the owner and never leaves custodianId unset", () => {
    const [row] = buildSubtree(categories, "monitor", null, "Monitor A", false, ctx);
    expect(row.currentOrgNodeId).toBe("se");
    expect(row.custodianId).toBe("u1");
  });

  it("respects an explicit currentOrgNodeId when on loan from the start", () => {
    const [row] = buildSubtree(categories, "monitor", null, "Monitor A", false, { ...ctx, currentOrgNodeId: "chem" });
    expect(row.ownerOrgNodeId).toBe("se");
    expect(row.currentOrgNodeId).toBe("chem");
  });

  it("stops at an unknown category rather than throwing", () => {
    expect(buildSubtree(categories, "not-a-category", null, "X", false, ctx)).toEqual([]);
  });
});

describe("instantiateMany", () => {
  it("creates `count` siblings, each with its own scaffolded subtree", () => {
    const rows = instantiateMany(categories, "computer", "lab-1", 3, ctx);
    const roots = rows.filter((r) => r.parentId === "lab-1");
    expect(roots).toHaveLength(3);
    // 3 × (1 computer + 1 monitor + 2 speakers).
    expect(rows).toHaveLength(12);
  });

  it("numbers roots only when there is more than one", () => {
    const [single] = instantiateMany(categories, "monitor", null, 1, ctx);
    expect(single.name).toBe("Monitor");
    const many = instantiateMany(categories, "monitor", null, 2, ctx);
    expect(many.map((r) => r.name)).toEqual(["Monitor 01", "Monitor 02"]);
  });

  it("continues numbering from a given start index", () => {
    const rows = instantiateMany(categories, "monitor", null, 2, ctx, false, 6);
    expect(rows.map((r) => r.name)).toEqual(["Monitor 06", "Monitor 07"]);
  });

  it("marks every created root critical when asked", () => {
    const rows = instantiateMany(categories, "monitor", null, 2, ctx, true);
    expect(rows.every((r) => r.critical)).toBe(true);
  });

  it("uses overrides.baseName in place of the category's own name, still numbered when count > 1", () => {
    const [single] = instantiateMany(categories, "monitor", null, 1, ctx, false, 1, { baseName: "Software Lab 3" });
    expect(single.name).toBe("Software Lab 3");
    const many = instantiateMany(categories, "monitor", null, 2, ctx, false, 1, { baseName: "Software Lab" });
    expect(many.map((r) => r.name)).toEqual(["Software Lab 01", "Software Lab 02"]);
  });

  it("falls back to the category's own name when baseName is blank or whitespace-only", () => {
    const [row] = instantiateMany(categories, "monitor", null, 1, ctx, false, 1, { baseName: "   " });
    expect(row.name).toBe("Monitor");
  });

  it("merges overrides.props onto each ROOT item, never onto its auto-generated children", () => {
    const rows = instantiateMany(categories, "computer", null, 1, ctx, false, 1, { props: { brand: "Dell" } });
    const root = rows.find((r) => r.categoryId === "computer")!;
    const monitor = rows.find((r) => r.categoryId === "monitor")!;
    expect(root.props.brand).toBe("Dell");
    expect(monitor.props).toEqual({}); // monitor's own fixture defines no fields, so this stays empty either way
  });

  it("applies overrides.props independently to every root when count > 1", () => {
    const rows = instantiateMany(categories, "computer", null, 2, ctx, false, 1, { props: { brand: "HP" } });
    const roots = rows.filter((r) => r.categoryId === "computer");
    expect(roots.every((r) => r.props.brand === "HP")).toBe(true);
  });
});

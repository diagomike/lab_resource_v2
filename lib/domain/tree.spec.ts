import { describe, expect, it } from "vitest";
import { buildRollup, buildSearchList, buildTree, groupRows, indexItems, type RowNode } from "./tree";
import type { Category, Item } from "./types";

const now = "2026-01-01T00:00:00.000Z";

const category = (id: string, group = "Test", impairRule: Category["impairRule"] = "ANY_CRITICAL", fields: Category["fields"] = []): Category => ({
  id,
  name: id,
  iconKey: "Package",
  group,
  countingMode: "SERIALIZED",
  version: 0,
  fields,
  defaultChildren: [],
  impairRule,
});

const item = (id: string, categoryId: string, parentId: string | null, overrides: Partial<Item> = {}): Item => ({
  id,
  categoryId,
  parentId,
  name: id,
  qty: 1,
  status: "WORKING",
  critical: false,
  props: {},
  images: [],
  ownerOrgNodeId: "se",
  currentOrgNodeId: "se",
  custodianId: "u1",
  version: 1,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe("tree/rollup/search — three materially distinct row shapes", () => {
  const categories = {
    lab: category("lab", "Places", "NEVER"),
    setup: category("setup"),
    computer: category("computer"),
    storage: category("storage", "Test", "ANY_CRITICAL", [{ key: "sizeGB", label: "Size", type: "number", unit: "GB" }]),
  };
  const items = [
    item("lab-se", "lab", null),
    item("setup-1", "setup", "lab-se"),
    item("setup-2", "setup", "lab-se"),
    item("pc-1", "computer", "setup-1"),
    item("pc-2", "computer", "setup-2", { status: "BROKEN" }),
    item("disk-1", "storage", "pc-1", { props: { sizeGB: 512 } }),
    item("disk-2", "storage", "pc-2", { props: { sizeGB: 256 } }),
    item("lab-chem", "lab", null, { ownerOrgNodeId: "chem", currentOrgNodeId: "chem" }),
  ];
  const index = indexItems(items);

  it("gives the dashboard and the Search list the same answer for a matched set", () => {
    const matched = new Set(items.filter((i) => i.categoryId === "computer").map((i) => i.id));
    expect(buildSearchList(index, matched)).toHaveLength(matched.size);
    expect(matched.size).toBe(2);
  });

  it("keeps physical hierarchy, inventory summary and search list materially distinct", () => {
    const tree = buildTree(index, null);
    const summary = buildRollup(index, null);
    const flat = buildSearchList(index, new Set(["pc-1", "pc-2"]));
    // Tree: direct children only, grouped — the lab's two setups collapse to a cluster.
    expect(tree.find((row) => row.id === "lab-se")?.children[0].kind).toBe("cluster");
    // Rollup: the WHOLE subtree grouped by category — one row for the lab's computers,
    // reaching through the setups.
    const labSummary = summary.find((row) => row.id === "lab-se")!;
    expect(labSummary.children.some((row) => row.kind === "cluster" && row.categoryId === "computer" && row.members.length === 2)).toBe(true);
    // Search: flat, no synthetic hierarchy at all.
    expect(flat.every((row) => row.depth === 0 && row.children.length === 0)).toBe(true);
  });
});

describe("groupRows — the grouped register", () => {
  const labA = item("labA", "lab", null, { name: "Lab 10", ownerOrgNodeId: "cse" });
  const labB = item("labB", "lab", null, { name: "Lab 2", ownerOrgNodeId: "cse" });
  const labC = item("labC", "lab", null, { name: "Chem Lab", ownerOrgNodeId: "chem" });
  const pc = item("pc1", "computer", "labA");
  const roots = buildTree(indexItems([labA, labB, labC, pc]), null);
  // Owning unit nests along the org chart: ASTU › College › Department.
  const byOwner = (i: Item) =>
    i.ownerOrgNodeId === "cse"
      ? [{ id: "astu", label: "ASTU" }, { id: "coeec", label: "CoEEC" }, { id: "cse", label: "CSE" }]
      : [{ id: "astu", label: "ASTU" }, { id: "chem", label: "Chemical Engineering" }];

  it("nests resources under a hierarchy of headings, keeping each one's own contents", () => {
    const out = groupRows(roots, [byOwner]);
    expect(out.map((r) => r.kind === "group" && r.label)).toEqual(["ASTU"]);
    const astu = out[0] as Extract<RowNode, { kind: "group" }>;
    expect(astu.members.map((m) => m.id).sort()).toEqual(["labA", "labB", "labC"]);
    const labels = (rows: RowNode[]) => rows.map((r) => (r.kind === "group" ? r.label : r.kind === "item" ? r.item.name : "cluster"));
    expect(labels(astu.children)).toEqual(["Chemical Engineering", "CoEEC"]);
    const cse = (astu.children[1] as Extract<RowNode, { kind: "group" }>).children[0] as Extract<RowNode, { kind: "group" }>;
    expect(labels(cse.children)).toEqual(["Lab 2", "Lab 10"]); // natural order
    const lab10 = cse.children[1];
    expect(lab10.kind === "item" && lab10.children.map((c) => c.id)).toEqual(["pc1"]);
  });

  it("stacks a second level under the first", () => {
    const out = groupRows(roots, [(i) => [{ id: i.ownerOrgNodeId, label: i.ownerOrgNodeId }], () => [{ id: "lab", label: "Lab" }]]);
    expect(out.map((r) => r.kind === "group" && r.label)).toEqual(["chem", "cse"]);
    expect((out[1] as Extract<RowNode, { kind: "group" }>).children.map((r) => r.kind === "group" && r.label)).toEqual(["Lab"]);
  });

  it("returns the rows unchanged with no grouping chosen", () => {
    expect(groupRows(roots, [])).toBe(roots);
  });
});

import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, matchItems, type FilterCtx, type FilterState } from "./filters";
import { computeStatuses } from "./status";
import { descendantCategories, indexItems } from "./tree";
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

const query = (rules: FilterState["rules"]): FilterState => ({ ...EMPTY_FILTERS, rules });

const contextFor = (items: Item[], categories: Record<string, Category>): FilterCtx => {
  const index = indexItems(items);
  return { categories, index, statuses: computeStatuses(items, categories), descCats: descendantCategories(index) };
};

describe("matchItems", () => {
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
  const ctx = contextFor(items, categories);

  it("combines rules with AND, so each one narrows the last", () => {
    const owned = query([{ id: "a", field: "owner", op: "inArray", values: ["se"] }]);
    const ownedAndBroken = query([
      { id: "a", field: "owner", op: "inArray", values: ["se"] },
      { id: "b", field: "status", op: "inArray", values: ["BROKEN"] },
    ]);
    expect(matchItems(items, owned, ctx).has("lab-chem")).toBe(false);
    expect(matchItems(items, ownedAndBroken, ctx)).toEqual(new Set(["pc-2"]));
  });

  it("keeps permanent ownership separate from the current holding unit", () => {
    const loaned = item("loaned", "computer", null, { ownerOrgNodeId: "se", currentOrgNodeId: "chem" });
    const loanCtx = contextFor([loaned], categories);
    const byOwner = query([{ id: "owner", field: "owner", op: "inArray", values: ["se"] }]);
    const byHolder = query([{ id: "holder", field: "currentOrg", op: "inArray", values: ["chem"] }]);
    // The same row answers to both — which is exactly what a loan is.
    expect(matchItems([loaned], byOwner, loanCtx)).toEqual(new Set(["loaned"]));
    expect(matchItems([loaned], byHolder, loanCtx)).toEqual(new Set(["loaned"]));
  });

  it("filters a computer by a property of its grandchild disk", () => {
    const big = query([
      { id: "cat", field: "category", op: "inArray", values: ["computer"] },
      { id: "size", field: "desc:storage:sizeGB", op: "gte", values: ["500"] },
    ]);
    expect(matchItems(items, big, ctx)).toEqual(new Set(["pc-1"]));
  });

  it("answers presence questions without a value, over the whole subtree", () => {
    // "contains a disk" is asked of everything that contains one at any depth, so the
    // lab and the setups match too. Narrowing to the machines themselves is what the
    // category rule is for.
    const anythingWithADisk = query([{ id: "s", field: "desc:storage:sizeGB", op: "isNotEmpty", values: [] }]);
    expect(matchItems(items, anythingWithADisk, ctx)).toEqual(new Set(["lab-se", "setup-1", "setup-2", "pc-1", "pc-2"]));

    const computersWithADisk = query([
      { id: "cat", field: "category", op: "inArray", values: ["computer"] },
      { id: "s", field: "desc:storage:sizeGB", op: "isNotEmpty", values: [] },
    ]);
    expect(matchItems(items, computersWithADisk, ctx)).toEqual(new Set(["pc-1", "pc-2"]));
  });
});

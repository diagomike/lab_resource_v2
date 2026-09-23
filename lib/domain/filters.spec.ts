import { describe, expect, it } from "vitest";
import { customPropFilterFields, EMPTY_FILTERS, matchItems, parseSearch, type FilterCtx, type FilterState } from "./filters";
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

  it("matches a custom (item-specific) property not defined by its category", () => {
    const tagged = item("special", "computer", null, { customProps: { assetTag: { type: "TEXT", value: "AX-42" } } });
    const untagged = item("plain", "computer", null);
    const ctx2 = contextFor([tagged, untagged], categories);
    const rule = query([{ id: "c", field: "custom:assetTag", op: "contains", values: ["ax-42"] }]);
    expect(matchItems([tagged, untagged], rule, ctx2)).toEqual(new Set(["special"]));
  });

  it("includes a custom property's value in free-text search", () => {
    const tagged = item("special", "computer", null, { customProps: { assetTag: { type: "TEXT", value: "AX-42-unique" } } });
    const ctx2 = contextFor([tagged], categories);
    expect(matchItems([tagged], { ...EMPTY_FILTERS, search: "ax-42-unique" }, ctx2)).toEqual(new Set(["special"]));
  });
});

describe("customPropFilterFields", () => {
  it("discovers distinct custom-property keys from the given (already scoped) items only", () => {
    const withCustom = item("special", "computer", null, { customProps: { assetTag: { type: "TEXT", value: "AX-42" } } });
    const withoutCustom = item("plain", "computer", null);
    expect(customPropFilterFields([withCustom, withoutCustom])).toEqual([
      { id: "custom:assetTag", label: "assetTag", kind: "text", group: "Custom properties", options: undefined },
    ]);
  });

  it("offers a Yes/No option set for a BOOLEAN custom property", () => {
    const withBool = item("special", "computer", null, { customProps: { verified: { type: "BOOLEAN", value: true } } });
    const [field] = customPropFilterFields([withBool]);
    expect(field.kind).toBe("enum");
    expect(field.options).toEqual([{ value: "true", label: "Yes" }, { value: "false", label: "No" }]);
  });

  it("has no scope logic of its own — it discovers keys ONLY from what it is given, which is exactly why the caller (items.ts's domainFilterFields) must pass an already scope-filtered item list, never the whole table", () => {
    const anItem = item("x", "computer", null, { customProps: { secret: { type: "TEXT", value: "x" } } });
    expect(customPropFilterFields([])).toEqual([]);
    expect(customPropFilterFields([anItem]).map((f) => f.id)).toEqual(["custom:secret"]);
  });
});

describe("search @key terms", () => {
  const categories = {
    computer: category("computer", "IT", "ANY_CRITICAL", [
      { key: "serial", label: "Serial no.", type: "text" },
      { key: "brand", label: "Brand", type: "text" },
    ]),
    chair: category("chair", "Furniture", "NEVER"),
  };
  const items = [
    item("pc-a", "computer", null, { name: "Computer 01", props: { serial: "EXNDSF-001", brand: "Dell" } }),
    item("pc-b", "computer", null, { name: "Computer 02", props: { serial: "ABC-9", brand: "HP" } }),
    item("pc-c", "computer", null, { name: "Computer 03", props: { brand: "Dell" } }),
    item("chair-a", "chair", null, { name: "Chair 01", customProps: { asset_tag: { type: "TEXT", value: "T-77" } } as Item["customProps"] }),
  ];
  const ctx = contextFor(items, categories);
  const search = (q: string) => [...matchItems(items, { ...EMPTY_FILTERS, search: q }, ctx)].sort();

  it("parses terms and leaves the rest as a phrase", () => {
    expect(parseSearch('@serial:EXN dell  @brand @tag:"A B"')).toEqual({
      text: "dell",
      terms: [
        { key: "serial", value: "EXN" },
        { key: "brand", value: null },
        { key: "tag", value: "A B" },
      ],
    });
    expect(parseSearch("@serial:").terms).toEqual([{ key: "serial", value: null }]);
  });

  it("@key alone matches items that have the field filled in", () => {
    expect(search("@serial")).toEqual(["pc-a", "pc-b"]);
  });

  it("@key:value matches a case-insensitive part of the value", () => {
    expect(search("@serial:exndsf")).toEqual(["pc-a"]);
    expect(search("@serial:nothing")).toEqual([]);
  });

  it("keys match the field's label too, ignoring case, spaces and punctuation", () => {
    expect(search("@SerialNo")).toEqual(["pc-a", "pc-b"]);
  });

  it("custom properties and the built-ins answer too", () => {
    expect(search("@asset_tag:t-7")).toEqual(["chair-a"]);
    expect(search("@category:chair")).toEqual(["chair-a"]);
    expect(search("@name:computer 02")).toEqual(["pc-b"]); // a bare word after a term is free text
    expect(search('@name:"Computer 0"')).toEqual(["pc-a", "pc-b", "pc-c"]);
  });

  it("terms combine with each other and with free text", () => {
    expect(search("@brand:dell @serial")).toEqual(["pc-a"]);
    expect(search("@brand:dell 03")).toEqual(["pc-c"]);
  });
});

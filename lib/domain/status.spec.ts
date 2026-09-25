import { describe, expect, it } from "vitest";
import { changeValueLabel, computeStatuses } from "./status";
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

describe("derived status", () => {
  const categories = {
    parent: category("parent"),
    child: category("child"),
    lab: category("lab", "Places", "NEVER"),
    redundant: category("redundant", "Test", "ALL_CRITICAL"),
  };

  it("propagates a critical failure upward but ignores a noncritical one", () => {
    const critical = [item("parent", "parent", null), item("child", "child", "parent", { critical: true, status: "BROKEN" })];
    const optional = [item("parent", "parent", null), item("child", "child", "parent", { critical: false, status: "BROKEN" })];
    expect(computeStatuses(critical, categories).get("parent")?.effective).toBe("IMPAIRED");
    expect(computeStatuses(optional, categories).get("parent")?.effective).toBe("WORKING");
  });

  it("travels more than one level — a broken part impairs its parent's parent", () => {
    const deep = [item("pc", "parent", null), item("board", "parent", "pc", { critical: true }), item("ram", "child", "board", { critical: true, status: "BROKEN" })];
    const statuses = computeStatuses(deep, categories);
    expect(statuses.get("board")?.effective).toBe("IMPAIRED");
    expect(statuses.get("pc")?.effective).toBe("IMPAIRED");
  });

  it("honours ALL_CRITICAL and NEVER", () => {
    const halfDown = [item("rack", "redundant", null), item("sw-1", "child", "rack", { critical: true, status: "BROKEN" }), item("sw-2", "child", "rack", { critical: true })];
    expect(computeStatuses(halfDown, categories).get("rack")?.effective).toBe("WORKING");

    const lab = [item("lab", "lab", null), item("pc", "child", "lab", { critical: true, status: "BROKEN" })];
    expect(computeStatuses(lab, categories).get("lab")?.effective).toBe("WORKING");
  });

  it("ignores every child unconditionally under NEVER, even a critical one — there is no critical-child exception", () => {
    // The missing case temp_works' own suite never exercised: its test fixture built
    // NEVER's lab differently from the shape its seed actually used (a switch rack
    // marked critical). See ~/.claude/plans/wait-i-want-gentle-haven.md §5's note on
    // why the seed's behaviour is authoritative, not the README's sentence about a
    // "critical switch rack" exception — that shape does not exist in the algorithm.
    const store = [
      item("store", "lab", null),
      item("rack", "child", "store", { critical: true, status: "BROKEN" }),
      item("shelf", "child", "store", { critical: false, status: "BROKEN" }),
    ];
    expect(computeStatuses(store, categories).get("store")?.effective).toBe("WORKING");
  });

  it("names the culprits, and never writes them onto the parent", () => {
    const items = [item("pc", "parent", null), item("monitor", "child", "pc", { critical: true, status: "BROKEN" })];
    const statuses = computeStatuses(items, categories);
    expect(statuses.get("pc")?.culprits).toEqual(["monitor"]);
    // The stored fact is untouched; only the derived reading changed.
    expect(items[0].status).toBe("WORKING");
  });
});

describe("changeValueLabel", () => {
  it("shows stored codes by the words people see on screen", () => {
    expect(changeValueLabel("status", "UNDER_MAINTENANCE")).toBe("Maintenance");
    expect(changeValueLabel("booking mode", "NOT_BOOKABLE")).toBe("Not bookable");
    expect(changeValueLabel("booking mode", "ROOM")).toBe("Bookable room");
    expect(changeValueLabel("public portal", true)).toBe("Listed on the portal");
    expect(changeValueLabel("counting mode", "serialized")).toBe("Individual units");
    expect(changeValueLabel("name", "ROOM")).toBe("ROOM"); // only coded fields are translated
    expect(changeValueLabel("booking mode", null)).toBe("—");
  });
});

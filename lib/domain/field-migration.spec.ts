import { describe, expect, it } from "vitest";
import { categoryKeyFor, convertValue, distinctValues, fieldKeyFor, parseDate, planCategoryMigration } from "./field-migration";
import type { Category, FieldDef, Item } from "./types";

const category = (fields: FieldDef[]): Category => ({
  id: "lab",
  name: "Lab",
  iconKey: "Package",
  group: "Places",
  countingMode: "SERIALIZED",
  fields,
  defaultChildren: [],
  impairRule: "NEVER",
  version: 1,
});

const item = (id: string, props: Item["props"], customProps: Item["customProps"] = {}): Item => ({
  id,
  parentId: null,
  categoryId: "lab",
  name: `Lab ${id}`,
  qty: 1,
  status: "WORKING",
  critical: false,
  props,
  customProps,
  images: [],
  ownerOrgNodeId: "d",
  currentOrgNodeId: "d",
  custodianId: "u",
  version: 1,
  createdAt: "",
  updatedAt: "",
});

const text = (key: string, label = key): FieldDef => ({ key, label, type: "text" });
const num = (key: string, label = key, unit?: string): FieldDef => ({ key, label, type: "number", unit });

describe("convertValue — reading a stored value as a new type", () => {
  it("reads numbers out of everyday text, units and thousands separators included", () => {
    expect(convertValue("16", num("ram"))).toEqual({ ok: true, value: 16 });
    expect(convertValue("16 GB", num("ram"))).toEqual({ ok: true, value: 16 });
    expect(convertValue("1,200", num("w"))).toEqual({ ok: true, value: 1200 });
    expect(convertValue("-3.5 °C", num("t"))).toEqual({ ok: true, value: -3.5 });
  });

  it("refuses text that is not a number rather than guessing", () => {
    expect(convertValue("B528-RG16", num("room")).ok).toBe(false);
    expect(convertValue("about five", num("seats")).ok).toBe(false);
    expect(convertValue("16-20", num("seats")).ok).toBe(false);
    expect(convertValue(true, num("seats")).ok).toBe(false);
  });

  it("anything reads as text; a number keeps its unit", () => {
    expect(convertValue(25, text("seats"), num("seats", "Seats", "chairs"))).toEqual({ ok: true, value: "25 chairs" });
    expect(convertValue(true, text("x"))).toEqual({ ok: true, value: "Yes" });
  });

  it("yes/no, choices and dates", () => {
    expect(convertValue("Yes", { key: "b", label: "b", type: "boolean" })).toEqual({ ok: true, value: true });
    expect(convertValue("0", { key: "b", label: "b", type: "boolean" })).toEqual({ ok: true, value: false });
    expect(convertValue("maybe", { key: "b", label: "b", type: "boolean" }).ok).toBe(false);
    expect(convertValue("desktop", { key: "t", label: "t", type: "enum", options: ["Desktop", "Laptop"] })).toEqual({ ok: true, value: "Desktop" });
    expect(convertValue("1/3/2027", { key: "d", label: "d", type: "date" })).toEqual({ ok: true, value: "2027-03-01" });
    expect(parseDate("2027-02-30")).toBeNull();
  });
});

describe("planCategoryMigration — nothing is lost silently", () => {
  it("Room from text to number: convertible values convert, the rest are kept as an extra detail", () => {
    const before = category([text("room", "Room")]);
    const after = category([num("room", "Room")]);
    const plan = planCategoryMigration(before, after, [item("a", { room: "16" }), item("b", { room: "B528-RG16" }), item("c", { room: null })]);
    expect(plan.converted).toBe(1);
    expect(plan.items.find((i) => i.itemId === "a")?.props.room).toBe(16);
    const b = plan.items.find((i) => i.itemId === "b")!;
    expect(b.props.room).toBeUndefined();
    expect(b.customProps["Earlier Room"]).toEqual({ type: "TEXT", value: "B528-RG16" });
    expect(plan.kept).toMatchObject([{ itemId: "b", keptAs: "Earlier Room", reason: "type" }]);
    expect(plan.items.some((i) => i.itemId === "c")).toBe(false);
  });

  it("erases only when the editor chose to", () => {
    const plan = planCategoryMigration(category([text("room")]), category([num("room")]), [item("b", { room: "B528" })], { erase: ["room"] });
    expect(plan.erased).toHaveLength(1);
    expect(plan.items[0].customProps).toEqual({});
  });

  it("a removed detail's values stay visible on each item as an extra detail", () => {
    const plan = planCategoryMigration(category([num("seats", "Seats"), text("room")]), category([text("room")]), [item("a", { seats: 25, room: "8" }, { "Earlier Seats": { type: "TEXT", value: "x" } })]);
    expect(plan.items[0].props).toEqual({ room: "8" });
    expect(plan.items[0].customProps["Earlier Seats 2"]).toEqual({ type: "NUMBER", value: 25 });
  });

  it("a removed choice moves to the option the editor picked, or is kept", () => {
    const before = category([{ key: "level", label: "Level", type: "enum", options: ["Central", "Departmental"] }]);
    const after = category([{ key: "level", label: "Level", type: "enum", options: ["Main store", "Department store"] }]);
    const plan = planCategoryMigration(before, after, [item("a", { level: "Central" }), item("b", { level: "Departmental" })], {
      optionMoves: { level: { Central: "Main store", Departmental: null } },
    });
    expect(plan.items.find((i) => i.itemId === "a")?.props.level).toBe("Main store");
    expect(plan.kept).toMatchObject([{ itemId: "b", reason: "option" }]);
  });

  it("a detail becoming required can fill the items that lack it", () => {
    const after = category([{ ...text("block", "Block"), required: true }]);
    const plan = planCategoryMigration(category([text("block", "Block")]), after, [item("a", { block: "510" }), item("b", {})], { fills: { block: "Unknown" } });
    expect(plan.filled).toBe(1);
    expect(plan.items).toEqual([{ itemId: "b", props: { block: "Unknown" }, customProps: {} }]);
  });
});

describe("generated keys", () => {
  it("field keys come from the label and never collide", () => {
    expect(fieldKeyFor("Serial no.", [])).toBe("serial_no");
    expect(fieldKeyFor("Room", ["room"])).toBe("room_2");
    expect(fieldKeyFor("3D size", [])).toBe("d_3d_size");
    expect(fieldKeyFor("—", [])).toBe("detail");
  });

  it("category keys come from the name", () => {
    expect(categoryKeyFor("Chemicals and Reagents", [])).toBe("chemicals-and-reagents");
    expect(categoryKeyFor("Lab", ["lab"])).toBe("lab-2");
    expect(categoryKeyFor("3D printer", [])).toBe("c-3d-printer");
  });

  it("distinct values seed a new choice's options", () => {
    expect(distinctValues([item("a", { t: "Laptop" }), item("b", { t: "desktop" }), item("c", { t: "laptop" })], "t")).toEqual(["desktop", "Laptop"]);
  });
});

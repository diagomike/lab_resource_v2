import { describe, expect, it } from "vitest";
import { classifyEdit, nextStage, routeEdit, type GovernedCategory } from "./category-governance";
import type { Item } from "./types";

const lab = (over: Partial<GovernedCategory> = {}): GovernedCategory => ({
  id: "lab",
  name: "Lab",
  iconKey: "FlaskConical",
  group: "Places",
  countingMode: "SERIALIZED",
  fields: [
    { key: "room", label: "Room", type: "text" },
    { key: "seats", label: "Seats", type: "number" },
  ],
  defaultChildren: [],
  impairRule: "NEVER",
  version: 1,
  bookingMode: "ROOM",
  publicListed: false,
  ...over,
});

const item = (id: string, props: Item["props"]): Item => ({ id, parentId: null, categoryId: "lab", name: id, qty: 1, status: "WORKING", critical: false, props, images: [], ownerOrgNodeId: "d", currentOrgNodeId: "d", custodianId: "u", version: 1, createdAt: "", updatedAt: "" });
const items = [item("a", { room: "B528-RG16", seats: 25 }), item("b", { room: "C-105", seats: null })];

describe("classifyEdit — adding goes through, changing data waits", () => {
  it("adding a detail, an option, a part, a name or an icon is additive", () => {
    const after = lab({ name: "Laboratory", iconKey: "Beaker", fields: [...lab().fields, { key: "block", label: "Block", type: "text" }], defaultChildren: [{ categoryId: "bench", qty: 4, critical: false }] });
    expect(classifyEdit(lab(), after, items)).toEqual({ cls: "ADDITIVE", reasons: [] });
  });

  it("anything goes on a category no item uses yet", () => {
    expect(classifyEdit(lab(), lab({ fields: [], countingMode: "BULK" }), []).cls).toBe("ADDITIVE");
  });

  it("retyping, renaming or removing a detail that holds values is changing", () => {
    const retyped = classifyEdit(lab(), lab({ fields: [{ key: "room", label: "Room", type: "number" }, { key: "seats", label: "Seats", type: "number" }] }), items);
    expect(retyped.cls).toBe("CHANGING");
    expect(retyped.reasons).toEqual(["Changes “Room” from text to a number (2 values)"]);
    expect(classifyEdit(lab(), lab({ fields: [{ key: "room", label: "Room", type: "text" }, { key: "seats", label: "Room Number", type: "number" }] }), items).reasons).toEqual([
      "Renames “Seats” to “Room Number” (1 item has a value)",
    ]);
    expect(classifyEdit(lab(), lab({ fields: [{ key: "room", label: "Room", type: "text" }] }), items).reasons).toEqual(["Removes “Seats”, filled in on 1 item"]);
  });

  it("removing an empty detail, or relabelling one, is additive", () => {
    const noSeats = [item("a", { room: "8" })];
    expect(classifyEdit(lab(), lab({ fields: [{ key: "room", label: "Room", type: "text" }] }), noSeats).cls).toBe("ADDITIVE");
    expect(classifyEdit(lab(), lab({ fields: [{ key: "room", label: "Room", type: "text" }, { key: "seats", label: "Places", type: "text" }] }), noSeats).cls).toBe("ADDITIVE");
  });

  it("making a detail required, or changing how items count, book or show, is changing", () => {
    const required = lab({ fields: [{ key: "room", label: "Room", type: "text" }, { key: "seats", label: "Seats", type: "number", required: true }] });
    expect(classifyEdit(lab(), required, items).reasons).toEqual(["Makes “Seats” required; 1 item has none"]);
    expect(classifyEdit(lab(), required, items, { seats: 20 }).reasons).toEqual(["Makes “Seats” required; 1 item has none and will be filled in"]);
    expect(classifyEdit(lab(), lab({ bookingMode: "NOT_BOOKABLE" }), items).cls).toBe("CHANGING");
    expect(classifyEdit(lab(), lab({ publicListed: true }), items).reasons).toEqual(["Shows its count on the public portal"]);
  });
});

describe("routeEdit — who decides", () => {
  const custodian = { isTop: false, headsOwnUnit: false };
  const head = { isTop: false, headsOwnUnit: true };
  const top = { isTop: true, headsOwnUnit: false };

  it("additive edits apply for anyone allowed to edit", () => {
    expect(routeEdit("ADDITIVE", custodian, true)).toEqual({ kind: "APPLY" });
  });

  it("a custodian's changing edit waits for their head; the head's own applies", () => {
    expect(routeEdit("CHANGING", custodian, false)).toEqual({ kind: "PROPOSE", stages: ["HEAD"] });
    expect(routeEdit("CHANGING", head, false)).toEqual({ kind: "APPLY" });
  });

  it("reaching other departments' items passes the admin and Property Administration", () => {
    expect(routeEdit("CHANGING", custodian, true)).toEqual({ kind: "PROPOSE", stages: ["HEAD", "ADMIN", "PROPERTY_ADMIN"] });
    expect(routeEdit("CHANGING", head, true)).toEqual({ kind: "PROPOSE", stages: ["ADMIN", "PROPERTY_ADMIN"] });
    expect(routeEdit("CHANGING", top, true)).toEqual({ kind: "APPLY" });
  });

  it("stages advance in order", () => {
    expect(nextStage(["HEAD", "ADMIN", "PROPERTY_ADMIN"], "HEAD")).toBe("ADMIN");
    expect(nextStage(["HEAD"], "HEAD")).toBeNull();
  });
});

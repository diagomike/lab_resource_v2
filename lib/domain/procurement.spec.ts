import { describe, expect, it } from "vitest";
import { canMove, describeArrival, describeLineChanges, movableTo, requestStageFor } from "./procurement";

describe("procurement", () => {
  it("moves forward to any later stage, never back, never closed by hand", () => {
    expect(movableTo("PREPARING")).toEqual(["PLACED_ON_EGP", "BUYER_FOUND", "ON_DELIVERY", "ARRIVED"]);
    expect(canMove("BUYER_FOUND", "PLACED_ON_EGP")).toBe(false);
    expect(canMove("PLACED_ON_EGP", "ON_DELIVERY")).toBe(true);
    expect(movableTo("ARRIVED")).toEqual([]);
    expect(movableTo("CANCELLED")).toEqual([]);
  });

  it("the requests it covers follow it", () => {
    expect(requestStageFor("PLACED_ON_EGP")).toBe("ORDER_PLACED");
    expect(requestStageFor("ARRIVED")).toBe("IN_STORE");
    expect(requestStageFor("CANCELLED")).toBe("WITH_PROCUREMENT");
  });

  it("says what changed in what is bought", () => {
    const before = [
      { id: "a", name: "Chair", qty: 412 },
      { id: "b", name: "Whiteboard", qty: 4 },
    ];
    const after = [
      { id: "a", name: "Chair", qty: 380 },
      { name: "Projector", qty: 2, unit: "pcs" },
    ];
    expect(describeLineChanges(before, after)).toEqual(["Chair: 412 → 380", "+ Projector: 2 pcs", "− Whiteboard (was 4)"]);
  });

  it("names arrival shortfalls only", () => {
    expect(describeArrival([{ name: "Chair", qty: 380, arrived: 372 }, { name: "Desk", qty: 10, arrived: 10 }])).toEqual(["Chair: 380 bought, 372 came"]);
  });
});

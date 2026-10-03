import { describe, expect, it } from "vitest";
import { OFFERS, maxPeople, recommend, setupLine, typicalSeats, type ResolvedOffer } from "./external-offers";

const training: ResolvedOffer = {
  key: "TRAINING",
  name: "Training",
  summary: "",
  placeCategoryId: "lab",
  placeCategoryName: "Lab",
  seatCategoryId: "ws",
  seatCategoryName: "Workstation",
  seatsPerPlace: 20,
  perPlace: [{ categoryId: "wb", categoryName: "Whiteboard", qty: 1 }],
};

describe("packaged offers for outside requesters", () => {
  it("turns a headcount into as few labs as hold everyone, spread evenly", () => {
    expect(setupLine(recommend(training, 40)!)).toBe("2 × Lab, each with 20 × Workstation and 1 × Whiteboard");
    // 45 people need a third lab; 15 in each, not 20 + 20 + 5.
    expect(recommend(training, 45)).toMatchObject({ count: 3, needs: [{ categoryId: "ws", qty: 15 }, { categoryId: "wb", qty: 1 }] });
    expect(recommend(training, 1)).toMatchObject({ count: 1, needs: [{ qty: 1 }, { qty: 1 }] });
    expect(setupLine(recommend({ ...training, perPlace: [] }, 20)!)).toBe("1 × Lab, each with 20 × Workstation");
  });

  it("refuses a headcount it can't place: none, a fraction, more than the labs a setup may ask for", () => {
    expect(recommend(training, 0)).toBeNull();
    expect(recommend(training, 12.5)).toBeNull();
    expect(maxPeople(training)).toBe(400);
    expect(recommend(training, 400)?.count).toBe(20);
    expect(recommend(training, 401)).toBeNull();
  });

  it("takes a typical lab's seats as the median of what the labs hold", () => {
    expect(typicalSeats([20, 20, 21, 22, 20, 0])).toBe(20);
    expect(typicalSeats([20, 40])).toBe(20);
    expect(typicalSeats([])).toBe(20);
  });

  it("every offer names a place, a seat and a summary", () => {
    expect(OFFERS.map((o) => o.key)).toEqual(["EXAM", "TRAINING", "WORKSHOP"]);
    expect(OFFERS.every((o) => o.placeKey && o.seatKey && o.summary.length > 20)).toBe(true);
  });
});

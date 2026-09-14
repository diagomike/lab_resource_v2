import { describe, expect, it } from "vitest";
import { findClashes, overlaps, related, type ExistingClaim } from "./availability";

// lab ─┬─ pc1 ─ ram1
//      └─ pc2
// lab2 ── pc3
const PARENT: Record<string, string | null> = { lab: null, pc1: "lab", ram1: "pc1", pc2: "lab", lab2: null, pc3: "lab2" };
const parentOf = (id: string) => PARENT[id];

const at = (h: number) => new Date(Date.UTC(2026, 8, 14, h));

function claim(partial: Partial<ExistingClaim> & Pick<ExistingClaim, "itemId">): ExistingClaim {
  return { reservationId: `r-${partial.itemId}`, startsAt: at(5), endsAt: at(7), blocking: true, title: "Existing", ...partial };
}

describe("overlaps — half-open windows", () => {
  it("back-to-back sessions do not overlap", () => {
    expect(overlaps(at(5), at(7), at(7), at(9))).toBe(false);
    expect(overlaps(at(5), at(7), at(6), at(9))).toBe(true);
  });
});

describe("related", () => {
  it("is true for the same item, a container and anything nested inside it", () => {
    expect(related("pc1", "pc1", parentOf)).toBe(true);
    expect(related("lab", "ram1", parentOf)).toBe(true);
    expect(related("ram1", "lab", parentOf)).toBe(true);
  });

  it("is false for siblings and for items in different rooms", () => {
    expect(related("pc1", "pc2", parentOf)).toBe(false);
    expect(related("pc1", "pc3", parentOf)).toBe(false);
  });
});

describe("findClashes", () => {
  it("booking a room clashes with a machine already booked inside it", () => {
    const clashes = findClashes({ itemIds: ["lab"], startsAt: at(6), endsAt: at(8) }, [claim({ itemId: "ram1" })], parentOf);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ itemId: "lab", claimedItemId: "ram1", blocking: true });
  });

  it("booking a machine clashes with its room already booked (a class holds the whole lab)", () => {
    const clashes = findClashes({ itemIds: ["pc1"], startsAt: at(6), endsAt: at(8) }, [claim({ itemId: "lab", title: "SE301 lecture" })], parentOf);
    expect(clashes.map((c) => c.title)).toEqual(["SE301 lecture"]);
  });

  it("two machines in the same room do not clash; neither do back-to-back bookings of the same one", () => {
    expect(findClashes({ itemIds: ["pc2"], startsAt: at(5), endsAt: at(7) }, [claim({ itemId: "pc1" })], parentOf)).toEqual([]);
    expect(findClashes({ itemIds: ["pc1"], startsAt: at(7), endsAt: at(9) }, [claim({ itemId: "pc1" })], parentOf)).toEqual([]);
  });

  it("reports contending (non-blocking) claims separately, and ignores the proposal's own reservation", () => {
    const existing = [claim({ itemId: "pc1", blocking: false, reservationId: "pending" }), claim({ itemId: "pc1", reservationId: "self" })];
    const clashes = findClashes({ itemIds: ["pc1"], startsAt: at(5), endsAt: at(6) }, existing, parentOf, ["self"]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ reservationId: "pending", blocking: false });
  });

  it("does not hang on a malformed cycle", () => {
    const cyclic = (id: string) => (id === "a" ? "b" : id === "b" ? "a" : null);
    expect(findClashes({ itemIds: ["a"], startsAt: at(5), endsAt: at(6) }, [claim({ itemId: "c" })], cyclic)).toEqual([]);
  });
});

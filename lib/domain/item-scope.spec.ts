/**
 * temp_works/src/lib/scope.test.ts exercises `scopedItemIds`/`defaultScopeFor`
 * against a full generated demo dataset — both rejected from this port (see
 * item-scope.ts's header: that becomes a Prisma `where`-clause builder in a later
 * phase, not this in-memory shape). This is a fresh, focused spec for the two
 * predicates that did port: `unitsOf` and `withAncestors`.
 */
import { describe, expect, it } from "vitest";
import { unitsOf, withAncestors } from "./item-scope";
import { indexItems } from "./tree";
import type { Item } from "./types";

const now = "2026-01-01T00:00:00.000Z";
const item = (id: string, parentId: string | null, overrides: Partial<Item> = {}): Item => ({
  id,
  parentId,
  categoryId: "lab",
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

describe("unitsOf", () => {
  it("answers to the owner alone when it has never moved", () => {
    expect(unitsOf(item("a", null))).toEqual(["se"]);
  });

  it("answers to BOTH ends when on loan — that is what a loan is", () => {
    const loaned = item("a", null, { ownerOrgNodeId: "se", currentOrgNodeId: "chem" });
    expect(unitsOf(loaned)).toEqual(["se", "chem"]);
  });

  it("does not double-count when owner and current are the same unit", () => {
    expect(unitsOf(item("a", null, { ownerOrgNodeId: "se", currentOrgNodeId: "se" }))).toEqual(["se"]);
  });
});

describe("withAncestors", () => {
  it("pulls in every container up to the root, so nothing visible is stranded", () => {
    const items = [item("lab", null), item("setup", "lab"), item("pc", "setup")];
    const index = indexItems(items);
    const closed = withAncestors(index, new Set(["pc"]));
    expect(closed).toEqual(new Set(["pc", "setup", "lab"]));
  });

  it("is a no-op for a root with nothing above it", () => {
    const items = [item("lab", null)];
    const index = indexItems(items);
    expect(withAncestors(index, new Set(["lab"]))).toEqual(new Set(["lab"]));
  });

  it("merges the ancestor chains of several matched ids without duplicating work", () => {
    const items = [item("lab", null), item("setup-1", "lab"), item("pc-1", "setup-1"), item("setup-2", "lab"), item("pc-2", "setup-2")];
    const index = indexItems(items);
    const closed = withAncestors(index, new Set(["pc-1", "pc-2"]));
    expect(closed).toEqual(new Set(["pc-1", "setup-1", "pc-2", "setup-2", "lab"]));
  });
});

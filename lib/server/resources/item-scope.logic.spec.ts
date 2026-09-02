import { describe, expect, it } from "vitest";
import { buildItemScopeWhere, NO_ITEMS_WHERE } from "./item-scope.logic";

describe("buildItemScopeWhere", () => {
  it("gives a global role everything, unconditionally", () => {
    const where = buildItemScopeWhere({
      hasGlobalReach: true,
      custodyItemIds: ["irrelevant"],
      visibleNodeIds: [],
    });
    expect(where).toEqual({});
  });

  it("scopes a custodian to exactly the item ids they hold custody of, plus contents", () => {
    const where = buildItemScopeWhere({
      hasGlobalReach: false,
      custodyItemIds: ["lab-1", "setup-1", "pc-1"],
      visibleNodeIds: ["se", "chem"], // must be ignored — custody wins
    });
    expect(where).toEqual({ id: { in: ["lab-1", "setup-1", "pc-1"] } });
  });

  it("a custodian of nothing sees nothing, rather than falling through to org reach", () => {
    const where = buildItemScopeWhere({
      hasGlobalReach: false,
      custodyItemIds: [],
      visibleNodeIds: ["se"],
    });
    expect(where).toEqual({ id: { in: [] } });
  });

  it("a department head sees their unit's items via owner OR current, not AND", () => {
    const where = buildItemScopeWhere({
      hasGlobalReach: false,
      custodyItemIds: null,
      visibleNodeIds: ["se"],
    });
    expect(where).toEqual({
      OR: [{ ownerOrgNodeId: { in: ["se"] } }, { currentOrgNodeId: { in: ["se"] } }],
    });
  });

  it("a department head's reach includes org-closure descendants passed in via visibleNodeIds", () => {
    // ScopeService.visibleNodeIds already resolves the closure — this function only
    // has to trust the set it is given, not re-derive reachability.
    const where = buildItemScopeWhere({
      hasGlobalReach: false,
      custodyItemIds: null,
      visibleNodeIds: ["coeec", "se", "ce"],
    });
    expect(where).toEqual({
      OR: [
        { ownerOrgNodeId: { in: ["coeec", "se", "ce"] } },
        { currentOrgNodeId: { in: ["coeec", "se", "ce"] } },
      ],
    });
  });

  it("owner-in-scope alone is enough — a lent-out item is still visible to its owning department", () => {
    // (Sanity check on the shape: the predicate is OR, so a row matching only
    // ownerOrgNodeId still satisfies it even though currentOrgNodeId points elsewhere.)
    const where = buildItemScopeWhere({
      hasGlobalReach: false,
      custodyItemIds: null,
      visibleNodeIds: ["se"],
    });
    expect(where).toMatchObject({ OR: expect.arrayContaining([{ ownerOrgNodeId: { in: ["se"] } }]) });
  });

  it("current-in-scope alone is enough — a borrowed item is visible to the lab holding it", () => {
    const where = buildItemScopeWhere({
      hasGlobalReach: false,
      custodyItemIds: null,
      visibleNodeIds: ["chem"],
    });
    expect(where).toMatchObject({ OR: expect.arrayContaining([{ currentOrgNodeId: { in: ["chem"] } }]) });
  });

  it("a department A user's predicate never mentions department B's node id", () => {
    const where = buildItemScopeWhere({
      hasGlobalReach: false,
      custodyItemIds: null,
      visibleNodeIds: ["se"], // department A only
    });
    const serialised = JSON.stringify(where);
    expect(serialised).not.toContain("chem"); // department B's node id
  });

  it("no reach at all — the student/unscoped-role case — matches nothing", () => {
    const where = buildItemScopeWhere({
      hasGlobalReach: false,
      custodyItemIds: null,
      visibleNodeIds: [],
    });
    expect(where).toEqual(NO_ITEMS_WHERE);
  });
});

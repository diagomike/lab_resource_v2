import { describe, expect, it } from "vitest";
import { buildItemScopeWhere, NO_ITEMS_WHERE } from "./item-scope.logic";

describe("buildItemScopeWhere", () => {
  it("gives UNIVERSITY mode everything, unconditionally", () => {
    const where = buildItemScopeWhere({ mode: "UNIVERSITY", custodyItemIds: ["irrelevant"], visibleNodeIds: [] });
    expect(where).toEqual({});
  });

  it("scopes MY_CUSTODY to exactly the item ids resolved (self + contents), ignoring visibleNodeIds", () => {
    const where = buildItemScopeWhere({
      mode: "MY_CUSTODY",
      custodyItemIds: ["lab-1", "setup-1", "pc-1"],
      visibleNodeIds: ["se", "chem"], // must be ignored — custody wins
    });
    expect(where).toEqual({ OR: [{ id: { in: ["lab-1", "setup-1", "pc-1"] } }] });
  });

  it("a custodian of nothing sees nothing, rather than falling through to org reach", () => {
    const where = buildItemScopeWhere({ mode: "MY_CUSTODY", custodyItemIds: [], visibleNodeIds: ["se"] });
    expect(where).toEqual(NO_ITEMS_WHERE);
  });

  it("ORG_SUBTREE sees a unit's items via owner OR current, not AND", () => {
    const where = buildItemScopeWhere({ mode: "ORG_SUBTREE", custodyItemIds: null, visibleNodeIds: ["se"] });
    expect(where).toEqual({
      OR: [{ ownerOrgNodeId: { in: ["se"] } }, { currentOrgNodeId: { in: ["se"] } }],
    });
  });

  it("ORG_SUBTREE trusts the closure-expanded set it is given rather than re-deriving it", () => {
    const where = buildItemScopeWhere({ mode: "ORG_SUBTREE", custodyItemIds: null, visibleNodeIds: ["coeec", "se", "ce"] });
    expect(where).toEqual({
      OR: [
        { ownerOrgNodeId: { in: ["coeec", "se", "ce"] } },
        { currentOrgNodeId: { in: ["coeec", "se", "ce"] } },
      ],
    });
  });

  it("owner-in-scope alone is enough — a lent-out item is still visible to its owning department", () => {
    const where = buildItemScopeWhere({ mode: "ORG_SUBTREE", custodyItemIds: null, visibleNodeIds: ["se"] });
    expect(where).toMatchObject({ OR: expect.arrayContaining([{ ownerOrgNodeId: { in: ["se"] } }]) });
  });

  it("current-in-scope alone is enough — a borrowed item is visible to the lab holding it", () => {
    const where = buildItemScopeWhere({ mode: "ORG_SUBTREE", custodyItemIds: null, visibleNodeIds: ["chem"] });
    expect(where).toMatchObject({ OR: expect.arrayContaining([{ currentOrgNodeId: { in: ["chem"] } }]) });
  });

  it("a department A user's predicate never mentions department B's node id", () => {
    const where = buildItemScopeWhere({ mode: "ORG_SUBTREE", custodyItemIds: null, visibleNodeIds: ["se"] });
    expect(JSON.stringify(where)).not.toContain("chem");
  });

  it("no reach at all — the unscoped-role case — matches nothing", () => {
    const where = buildItemScopeWhere({ mode: "ORG_SUBTREE", custodyItemIds: null, visibleNodeIds: [] });
    expect(where).toEqual(NO_ITEMS_WHERE);
  });

  it("EXPLICIT_NODES scopes to a hand-picked set, ignoring the caller's own visibleNodeIds", () => {
    const where = buildItemScopeWhere({
      mode: "EXPLICIT_NODES",
      custodyItemIds: null,
      visibleNodeIds: ["se"],
      explicitNodeIds: ["chem-store"],
    });
    expect(where).toEqual({
      OR: [{ ownerOrgNodeId: { in: ["chem-store"] } }, { currentOrgNodeId: { in: ["chem-store"] } }],
    });
  });

  it("an empty EXPLICIT_NODES view matches nothing", () => {
    const where = buildItemScopeWhere({ mode: "EXPLICIT_NODES", custodyItemIds: null, visibleNodeIds: ["se"], explicitNodeIds: [] });
    expect(where).toEqual(NO_ITEMS_WHERE);
  });

  it("extraGrantedIds is additive — an approval grant reaches an item outside the caller's own scope", () => {
    const where = buildItemScopeWhere({
      mode: "ORG_SUBTREE",
      custodyItemIds: null,
      visibleNodeIds: ["se"],
      extraGrantedIds: ["chem-pc-9"],
    });
    expect(where).toEqual({
      OR: [{ ownerOrgNodeId: { in: ["se"] } }, { currentOrgNodeId: { in: ["se"] } }, { id: { in: ["chem-pc-9"] } }],
    });
  });

  it("extraGrantedIds alone can rescue an otherwise-empty scope", () => {
    const where = buildItemScopeWhere({
      mode: "ORG_SUBTREE",
      custodyItemIds: null,
      visibleNodeIds: [],
      extraGrantedIds: ["chem-pc-9"],
    });
    expect(where).toEqual({ OR: [{ id: { in: ["chem-pc-9"] } }] });
  });
});

import { describe, expect, it } from "vitest";
import { parseItemQuery } from "./items";

/**
 * `parseItemQuery` is the one place the wire's `rules`/`join` params (the closed
 * Phase 6 filtering gap — see PROGRESS.md) become the domain `FilterRule[]`/`join`
 * `search()`/`tree()`/`facets()` all consume via `buildFilterState`. Covers only this
 * pure parsing function, not the DB-backed reads around it — see the module's own
 * header comment on why those stay integration-tested against a live database instead.
 */
describe("parseItemQuery", () => {
  it("parses the core fields unchanged", () => {
    const sp = new URLSearchParams({ q: "dell", categoryId: "cat1", status: "WORKING", ownerOrgNodeId: "org1", currentOrgNodeId: "org2", custodianId: "u1" });
    expect(parseItemQuery(sp)).toMatchObject({
      q: "dell",
      categoryId: "cat1",
      status: "WORKING",
      ownerOrgNodeId: "org1",
      currentOrgNodeId: "org2",
      custodianId: "u1",
      join: "and",
    });
  });

  it("rejects an invalid status rather than passing it through", () => {
    const sp = new URLSearchParams({ status: "NOT_A_STATUS" });
    expect(parseItemQuery(sp).status).toBeUndefined();
  });

  it("parses a well-formed rules array into FilterRule[]", () => {
    const rules = [{ id: "r1", field: "desc:storage:sizeGB", op: "gte", values: ["500"] }];
    const sp = new URLSearchParams({ rules: JSON.stringify(rules) });
    expect(parseItemQuery(sp).rules).toEqual(rules);
  });

  it("supports several rules on the same field, matching lib/domain/filters.ts's own contract", () => {
    const rules = [
      { id: "r1", field: "desc:storage:sizeGB", op: "gte", values: ["500"] },
      { id: "r2", field: "desc:storage:sizeGB", op: "lte", values: ["1000"] },
    ];
    const sp = new URLSearchParams({ rules: JSON.stringify(rules) });
    expect(parseItemQuery(sp).rules).toHaveLength(2);
  });

  it("treats malformed JSON in rules as absent, not a thrown error", () => {
    const sp = new URLSearchParams({ rules: "{not json" });
    expect(() => parseItemQuery(sp)).not.toThrow();
    expect(parseItemQuery(sp).rules).toBeUndefined();
  });

  it("treats a rules array failing schema validation as absent", () => {
    const sp = new URLSearchParams({ rules: JSON.stringify([{ id: "r1", field: "x", op: "notAnOperator", values: ["1"] }]) });
    expect(parseItemQuery(sp).rules).toBeUndefined();
  });

  it("defaults join to and, and reads or explicitly", () => {
    expect(parseItemQuery(new URLSearchParams()).join).toBe("and");
    expect(parseItemQuery(new URLSearchParams({ join: "or" })).join).toBe("or");
    expect(parseItemQuery(new URLSearchParams({ join: "nonsense" })).join).toBe("and");
  });
});

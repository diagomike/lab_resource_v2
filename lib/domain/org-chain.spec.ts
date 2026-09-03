import { describe, expect, it } from "vitest";
import { ancestorsOfChain, indexOrgChain } from "./org-chain";
import { ORG_NODES } from "./__fixtures__/seed";
import type { OrgNode } from "./types";

const node = (id: string, kind: OrgNode["kind"], level: number, parentIds: string[], occupantId: string | null = null): OrgNode => ({
  id,
  name: id.toUpperCase(),
  kind,
  level,
  parentIds,
  occupantId,
  active: true,
});

const index = () => indexOrgChain(ORG_NODES);

describe("org closure", () => {
  it("reaches every descendant and records the node itself at depth 0", () => {
    const i = index();
    const fromAstu = i.descendants.get("astu")!;
    expect(fromAstu.get("astu")).toBe(0);
    expect(fromAstu.get("coeec")).toBe(1);
    expect(fromAstu.get("se")).toBe(2);
    expect(fromAstu.size).toBe(ORG_NODES.length);
  });

  it("gives a department no descendants but itself", () => {
    expect([...index().descendants.get("se")!.keys()]).toEqual(["se"]);
  });

  it("takes the minimum depth when a DAG offers two paths", () => {
    const nodes = [
      node("u", "UNIVERSITY", 0, []),
      node("c", "COLLEGE", 1, ["u"]),
      node("shared", "DEPARTMENT", 2, ["c", "u"]),
    ];
    const i = indexOrgChain(nodes);
    expect(i.descendants.get("u")!.get("shared")).toBe(1);
  });
});

describe("ancestorsOfChain", () => {
  it("orders nearest first and never includes the node itself", () => {
    const chain = ancestorsOfChain("se", index()).map((a) => a.node.id);
    expect(chain).toEqual(["coeec", "astu"]);
  });

  it("keeps BOTH parents at equal depth, ordered by name", () => {
    const nodes = [
      node("u", "UNIVERSITY", 0, []),
      { ...node("b-college", "COLLEGE", 1, ["u"]), name: "B College" },
      { ...node("a-college", "COLLEGE", 1, ["u"]), name: "A College" },
      node("dept", "DEPARTMENT", 2, ["b-college", "a-college"]),
    ];
    const chain = ancestorsOfChain("dept", indexOrgChain(nodes));
    expect(chain.map((a) => a.node.name)).toEqual(["A College", "B College", "U"]);
    expect(chain.map((a) => a.depth)).toEqual([1, 1, 2]);
  });

  it("excludes offices, which hang beside the colleges rather than above a department", () => {
    const chain = ancestorsOfChain("chem", index()).map((a) => a.node.id);
    expect(chain).not.toContain("proc-office");
    expect(chain).not.toContain("property-office");
  });
});

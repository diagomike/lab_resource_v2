import { computeClosureRows, wouldCreateCycle } from "./closure-algorithm";

/** Shorthand: "a>b" reads as an edge from parent a to child b. */
const e = (spec: string) => {
  const [parentId, childId] = spec.split(">");
  return { parentId, childId };
};

describe("computeClosureRows", () => {
  it("gives every node a depth-0 row for itself", () => {
    const rows = computeClosureRows(["a", "b"], []);
    expect(rows).toEqual([
      { ancestorId: "a", descendantId: "a", depth: 0 },
      { ancestorId: "b", descendantId: "b", depth: 0 },
    ]);
  });

  it("walks a simple chain to full depth", () => {
    const rows = computeClosureRows(["a", "b", "c"], [e("a>b"), e("b>c")]);
    const fromA = rows.filter((r) => r.ancestorId === "a");
    expect(fromA).toEqual(
      expect.arrayContaining([
        { ancestorId: "a", descendantId: "a", depth: 0 },
        { ancestorId: "a", descendantId: "b", depth: 1 },
        { ancestorId: "a", descendantId: "c", depth: 2 },
      ]),
    );
    // Reachability is directional — a child never reaches its parent.
    expect(rows.find((r) => r.ancestorId === "c" && r.descendantId === "a")).toBeUndefined();
  });

  /**
   * The case the whole DAG design exists for: at ASTU, CSE sits under both its school
   * and the Quality Assurance directorate. In LRMS the same shape gives the Property
   * Administration office reach into every department without special-case code.
   */
  it("reaches a node that has two independent parents", () => {
    const rows = computeClosureRows(
      ["vp", "school", "property", "cse"],
      [e("vp>school"), e("school>cse"), e("property>cse")],
    );
    expect(rows).toContainEqual({ ancestorId: "school", descendantId: "cse", depth: 1 });
    expect(rows).toContainEqual({ ancestorId: "property", descendantId: "cse", depth: 1 });
    expect(rows).toContainEqual({ ancestorId: "vp", descendantId: "cse", depth: 2 });
    // Property Admin reaching CSE must NOT drag in the school it happens to sit under.
    expect(rows.find((r) => r.ancestorId === "property" && r.descendantId === "school")).toBeUndefined();
  });

  it("takes the shortest path when a descendant is reachable two ways", () => {
    // root>mid>leaf is depth 2, but root>leaf direct is depth 1. Shortest wins.
    const rows = computeClosureRows(["root", "mid", "leaf"], [e("root>mid"), e("mid>leaf"), e("root>leaf")]);
    expect(rows).toContainEqual({ ancestorId: "root", descendantId: "leaf", depth: 1 });
  });

  it("terminates on a diamond without duplicating rows", () => {
    const rows = computeClosureRows(["a", "b", "c", "d"], [e("a>b"), e("a>c"), e("b>d"), e("c>d")]);
    const aToD = rows.filter((r) => r.ancestorId === "a" && r.descendantId === "d");
    expect(aToD).toHaveLength(1);
    expect(aToD[0].depth).toBe(2);
  });
});

describe("wouldCreateCycle", () => {
  it("refuses a node parenting itself", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("refuses an edge that closes a loop", () => {
    // a>b>c already exists; adding c>a would close the loop.
    expect(wouldCreateCycle([e("a>b"), e("b>c")], "c", "a")).toBe(true);
  });

  it("allows a second parent, which is not a cycle", () => {
    // school>cse exists; property>cse is a legitimate second parent.
    expect(wouldCreateCycle([e("school>cse")], "property", "cse")).toBe(false);
  });

  it("allows an unrelated edge", () => {
    expect(wouldCreateCycle([e("a>b")], "c", "d")).toBe(false);
  });
});

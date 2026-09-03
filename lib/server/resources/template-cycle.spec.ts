import { describe, expect, it } from "vitest";
import { wouldCreateTemplateCycle, type TemplateEdge } from "./template-cycle";

describe("wouldCreateTemplateCycle", () => {
  it("allows a fresh tree with no existing edges", () => {
    expect(wouldCreateTemplateCycle([], "computer", ["motherboard", "ram"])).toBe(false);
  });

  it("refuses a category naming itself as its own part", () => {
    expect(wouldCreateTemplateCycle([], "computer", ["computer"])).toBe(true);
  });

  it("refuses a direct two-cycle (A contains B, now B is asked to contain A)", () => {
    const edges: TemplateEdge[] = [{ parentCategoryId: "b", childCategoryId: "a" }];
    expect(wouldCreateTemplateCycle(edges, "a", ["b"])).toBe(true);
  });

  it("refuses an indirect cycle through several levels", () => {
    const edges: TemplateEdge[] = [
      { parentCategoryId: "b", childCategoryId: "c" },
      { parentCategoryId: "c", childCategoryId: "d" },
    ];
    // b -> c -> d already exists; proposing d -> a is fine (a is untouched by the chain)...
    expect(wouldCreateTemplateCycle(edges, "d", ["a"])).toBe(false);
    // ...but proposing d -> b closes b -> c -> d -> b.
    expect(wouldCreateTemplateCycle(edges, "d", ["a", "b"])).toBe(true);
  });

  it("detects a cycle that only closes through the full existing graph", () => {
    const edges: TemplateEdge[] = [
      { parentCategoryId: "a", childCategoryId: "b" },
      { parentCategoryId: "b", childCategoryId: "c" },
    ];
    // c -> a would close a -> b -> c -> a
    expect(wouldCreateTemplateCycle(edges, "c", ["a"])).toBe(true);
  });

  it("a category's own existing outgoing edges are replaced, not doubled — editing it to drop a cycle is allowed", () => {
    const edges: TemplateEdge[] = [
      { parentCategoryId: "a", childCategoryId: "b" }, // a's own old edge — must not count against a's new proposal
      { parentCategoryId: "b", childCategoryId: "c" },
    ];
    expect(wouldCreateTemplateCycle(edges, "a", ["c"])).toBe(false);
  });

  it("two independent branches sharing a common part is not a cycle", () => {
    const edges: TemplateEdge[] = [{ parentCategoryId: "computer", childCategoryId: "screw" }];
    expect(wouldCreateTemplateCycle(edges, "chair", ["screw"])).toBe(false);
  });
});

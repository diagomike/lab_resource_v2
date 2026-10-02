import { describe, expect, it } from "vitest";
import {
  activate,
  buildChain,
  canDecide,
  chainSettled,
  currentStep,
  describeChain,
  describeSelectors,
  isBlocked,
  collapseRepeatedApprovers,
  movementChain,
  mayRequestTransfer,
  validateChain,
  type ChainStep,
  type StepSelector,
} from "./approvals";
import { indexOrgChain } from "./org-chain";
import { ORG_NODES, PEOPLE } from "./__fixtures__/seed";
import type { Item, Person } from "./types";
import type { RoleKind } from "@/lib/shared";

/** The university's stated add route, used as a chain that fully resolves. */
const ADD_CHAIN_FIXTURE: StepSelector[] = [
  { type: "OWNER_HEAD" },
  { type: "HIERARCHY", stopAtKind: "UNIVERSITY" },
  { type: "NODE_OCCUPANT", nodeId: "proc-office" },
  { type: "REQUESTER_RECEIPT" },
];

const orgIndex = indexOrgChain(ORG_NODES);
const who = (id: string): Person => PEOPLE.find((p) => p.id === id)!;

function chain(selectors: StepSelector[], over: Partial<Parameters<typeof buildChain>[1]> = {}) {
  return buildChain(selectors, {
    ownerNodeId: "se",
    requesterId: "u1",
    nodes: ORG_NODES,
    orgIndex,
    ...over,
  });
}

describe("mayRequestTransfer: who may ask to move resources", () => {
  const person = (roles: RoleKind[]): Person => ({ id: "x", name: "x", homeOrgNodeId: "se", roles });

  it("custodians, heads, the store keeper and the admin may ask", () => {
    for (const role of ["CUSTODIAN", "MANAGER", "STORE_KEEPER", "SYS_ADMIN"] as RoleKind[]) expect(mayRequestTransfer(person([role]))).toBe(true);
  });

  it("the offices that only approve, an outside requester and nobody at all may not", () => {
    for (const role of ["PROCUREMENT", "PROPERTY_ADMIN", "EXTERNAL"] as RoleKind[]) expect(mayRequestTransfer(person([role]))).toBe(false);
    expect(mayRequestTransfer(undefined)).toBe(false);
  });
});

describe("buildChain: the org chart is the route", () => {
  it("walks up from the owning unit, nearest office first", () => {
    const steps = chain([{ type: "HIERARCHY", stopAtKind: "UNIVERSITY" }]);
    expect(steps.map((s) => s.nodeId)).toEqual(["coeec", "astu"]);
  });

  it("stops at the named kind, inclusive", () => {
    const steps = chain([{ type: "HIERARCHY", stopAtKind: "COLLEGE" }]);
    expect(steps.map((s) => s.nodeId)).toEqual(["coeec"]);
  });

  it("stopping at the college keeps both colleges of a department with two", () => {
    const nodes = [...ORG_NODES, { id: "mecha", name: "Mechatronics", kind: "DEPARTMENT" as const, level: 2, parentIds: ["coeec", "comcme"], occupantId: "p-head-mecha", active: true }];
    const steps = buildChain([{ type: "HIERARCHY", stopAtKind: "COLLEGE" }], { ownerNodeId: "mecha", requesterId: "u1", nodes, orgIndex: indexOrgChain(nodes) });
    expect(steps.map((s) => s.nodeId).sort()).toEqual(["coeec", "comcme"]);
  });

  it("never puts the owning department on its own hierarchy walk", () => {
    const steps = chain([{ type: "HIERARCHY", stopAtKind: "UNIVERSITY" }]);
    expect(steps.map((s) => s.nodeId)).not.toContain("se");
  });

  it("reaches an office by name, since offices are nobody's ancestor", () => {
    const steps = chain([{ type: "NODE_OCCUPANT", nodeId: "proc-office" }]);
    expect(steps[0].nodeId).toBe("proc-office");
    expect(steps[0].approverId).toBe("p-procurement");
  });

  it("builds the university's stated add route in order", () => {
    const steps = chain([{ type: "OWNER_HEAD" }, { type: "HIERARCHY", stopAtKind: "UNIVERSITY" }, { type: "NODE_OCCUPANT", nodeId: "proc-office" }, { type: "REQUESTER_RECEIPT" }]);
    expect(steps.map((s) => s.nodeId)).toEqual(["se", "coeec", "astu", "proc-office", null]);
    expect(steps.at(-1)!.receipt).toBe(true);
  });
});

describe("a vacant office blocks", () => {
  const headless = ORG_NODES.map((n) => (n.id === "coeec" ? { ...n, occupantId: null } : n));
  const vacantChain = () =>
    buildChain([{ type: "HIERARCHY", stopAtKind: "UNIVERSITY" }], {
      ownerNodeId: "se",
      requesterId: "u1",
      nodes: headless,
      orgIndex: indexOrgChain(headless),
    });

  it("holds the request at the empty post instead of routing around it", () => {
    const steps = vacantChain();
    const dean = steps.find((s) => s.nodeId === "coeec")!;
    expect(dean.status).not.toBe("SKIPPED");
    expect(dean.approverId).toBeNull();
    expect(isBlocked(dean, { nodes: headless })).toBe(true);
    // The request stops dead at the empty deanship: it is the armed step, and the
    // university above it is not reachable while it stands.
    expect(currentStep(steps)?.nodeId).toBe("coeec");
    expect(steps.find((s) => s.nodeId === "astu")!.status).toBe("WAITING");
    expect(chainSettled(steps)).toBe(false);
  });

  it("says so on the route rather than showing a shorter chain", () => {
    const steps = vacantChain();
    // The walk is over the owning unit's ANCESTORS, so it starts at the college.
    expect(steps.map((s) => s.nodeId)).toEqual(["coeec", "astu"]);
    expect(describeChain(steps, { nodes: headless })).toBe(
      "College: College of Electrical Engineering and Computing: currently vacant → University: Adama Science and Technology University",
    );
  });

  it("nobody at all can decide a vacant step", () => {
    const dean = vacantChain().find((s) => s.nodeId === "coeec")!;
    const armed = { ...dean, status: "PENDING" as const };
    for (const id of ["p-head-se", "p-dean-coeec", "u1", "u6"]) {
      expect(canDecide(armed, who(id), headless)).toBe(false);
    }
  });

  it("clears the moment somebody is appointed, with no rebuild", () => {
    const dean = vacantChain().find((s) => s.nodeId === "coeec")!;
    const armed = { ...dean, status: "PENDING" as const };
    const appointed = headless.map((n) => (n.id === "coeec" ? { ...n, occupantId: "u6" } : n));
    expect(isBlocked(armed, { nodes: appointed })).toBe(false);
    expect(canDecide(armed, who("u6"), appointed)).toBe(true);
  });
});

describe("self-approval is still skipped", () => {
  it("skips the requester's own post rather than asking them to approve themselves", () => {
    const steps = chain([{ type: "OWNER_HEAD" }, { type: "HIERARCHY", stopAtKind: "COLLEGE" }], { requesterId: "p-head-se" });
    expect(steps[0].status).toBe("SKIPPED");
    expect(steps[0].skipReason).toMatch(/requester holds this post/i);
    expect(currentStep(steps)?.nodeId).toBe("coeec");
  });

  it("never skips the receipt step, which is meant to be the requester", () => {
    const steps = chain([{ type: "REQUESTER_RECEIPT" }]);
    expect(steps[0].status).toBe("PENDING");
    expect(steps[0].approverId).toBe("u1");
    expect(steps[0].receipt).toBe(true);
  });

  it("re-derives a custodian step from the live resource, not the frozen id", () => {
    // There is no resource without a custodian, so this step always has somebody to
    // ask — and if custody changes hands mid-request, it is the new custodian's.
    const item = { custodianId: "u1" } as Item;
    const steps = chain([{ type: "ITEM_CUSTODIAN" }], { item, requesterId: "u2" });
    expect(steps[0].status).toBe("PENDING");
    expect(canDecide(steps[0], who("u1"), ORG_NODES, item)).toBe(true);

    const handedOver = { custodianId: "u6" } as Item;
    expect(canDecide(steps[0], who("u1"), ORG_NODES, handedOver)).toBe(false);
    expect(canDecide(steps[0], who("u6"), ORG_NODES, handedOver)).toBe(true);
  });
});

describe("a rule naming an office that is not on the chart", () => {
  const ctx = { ownerNodeId: "se", targetNodeId: null, nodes: ORG_NODES, orgIndex: indexOrgChain(ORG_NODES) };

  it("is refused, and names the office", () => {
    const error = validateChain([{ type: "NODE_OCCUPANT", nodeId: "no-such-office" }], ctx);
    expect(error).toMatch(/not on the org chart/i);
    expect(error).toContain("no-such-office");
  });

  it("is refused when the office was deactivated rather than removed", () => {
    const retired = ORG_NODES.map((n) => (n.id === "proc-office" ? { ...n, active: false } : n));
    const error = validateChain([{ type: "NODE_OCCUPANT", nodeId: "proc-office" }], { ...ctx, nodes: retired });
    expect(error).toMatch(/Procurement/);
  });

  it("passes a route whose every office resolves", () => {
    expect(validateChain(ADD_CHAIN_FIXTURE, ctx)).toBeUndefined();
  });

  it("does not confuse a vacant office with a missing one", () => {
    const headless = ORG_NODES.map((n) => (n.id === "proc-office" ? { ...n, occupantId: null } : n));
    expect(validateChain([{ type: "NODE_OCCUPANT", nodeId: "proc-office" }], { ...ctx, nodes: headless })).toBeUndefined();
  });
});

describe("chain progression", () => {
  const steps = chain([{ type: "OWNER_HEAD" }, { type: "HIERARCHY", stopAtKind: "UNIVERSITY" }]);

  it("arms exactly one step at a time", () => {
    expect(steps.filter((s) => s.status === "PENDING")).toHaveLength(1);
    expect(currentStep(steps)?.nodeId).toBe("se");
  });

  it("advances to the next undecided step once one is approved", () => {
    const after = activate(steps.map((s) => (s.order === 0 ? { ...s, status: "APPROVED" as const } : s)));
    expect(currentStep(after)?.nodeId).toBe("coeec");
    expect(chainSettled(after)).toBe(false);
  });

  it("is settled only when every step is approved or skipped", () => {
    const all = steps.map((s) => ({ ...s, status: "APPROVED" as ChainStep["status"] }));
    expect(chainSettled(all)).toBe(true);
  });
});

describe("canDecide is occupancy, checked live", () => {
  const steps = chain([{ type: "OWNER_HEAD" }]);

  it("lets the current occupant decide", () => {
    expect(canDecide(steps[0], who("p-head-se"), ORG_NODES)).toBe(true);
  });

  it("refuses anybody else", () => {
    expect(canDecide(steps[0], who("p-head-chem"), ORG_NODES)).toBe(false);
    expect(canDecide(steps[0], who("u1"), ORG_NODES)).toBe(false);
  });

  it("follows a change of head instead of staying with whoever was named", () => {
    // The step still carries the old occupant, but the chart has moved on.
    const moved = ORG_NODES.map((n) => (n.id === "se" ? { ...n, occupantId: "u6" } : n));
    expect(steps[0].approverId).toBe("p-head-se");
    expect(canDecide(steps[0], who("p-head-se"), moved)).toBe(false);
    expect(canDecide(steps[0], who("u6"), moved)).toBe(true);
  });

  it("refuses a step that is not the one waiting", () => {
    const waiting = { ...steps[0], status: "WAITING" as const };
    expect(canDecide(waiting, who("p-head-se"), ORG_NODES)).toBe(false);
  });
});

describe("describeSelectors states a rule without naming a department", () => {
  it("says the relation, not the unit: the same rule covers every pair", () => {
    expect(describeSelectors([{ type: "ITEM_CUSTODIAN" }, { type: "OWNER_HEAD" }, { type: "TARGET_HEAD" }, { type: "REQUESTER_RECEIPT" }], ORG_NODES)).toBe(
      "Current custodian → Head of the owning unit → Head of the receiving unit → Requester confirms receipt",
    );
  });

  it("names an office, because a rule genuinely fixes that one", () => {
    expect(describeSelectors(ADD_CHAIN_FIXTURE, ORG_NODES)).toBe("Head of the owning unit → Up the org chart to the university → Procurement Office → Requester confirms receipt");
  });

  it("spells out where a hierarchy walk stops", () => {
    expect(describeSelectors([{ type: "HIERARCHY", stopAtKind: "COLLEGE" }], ORG_NODES)).toBe("Up the org chart to the college");
    expect(describeSelectors([{ type: "OWNER_ANCESTOR", kind: "COLLEGE" }], ORG_NODES)).toBe("The college above the owning unit");
  });

  it("keeps a step visible when the office it names has gone", () => {
    // The old preview resolved rules against a sample department and dropped
    // whatever would not resolve, so a rule could read "applies immediately"
    // while routing.
    expect(describeSelectors([{ type: "NODE_OCCUPANT", nodeId: "gone" }], ORG_NODES)).toBe("an office that is not on the org chart");
  });

  it("covers every selector type, so no rule can render as a blank", () => {
    const every: StepSelector[] = [
      { type: "HIERARCHY", stopAtKind: "UNIVERSITY" },
      { type: "NODE_OCCUPANT", nodeId: "proc-office" },
      { type: "OWNER_ANCESTOR", kind: "COLLEGE" },
      { type: "OWNER_HEAD" },
      { type: "TARGET_HEAD" },
      { type: "ITEM_CUSTODIAN" },
      { type: "TARGET_CUSTODIAN" },
      { type: "REQUESTER_RECEIPT" },
    ];
    for (const selector of every) {
      expect(describeSelectors([selector], ORG_NODES)).not.toBe("");
    }
    expect(describeSelectors([], ORG_NODES)).toBe("nobody: applies immediately");
  });

  it("shows every step of a movement's line", () => {
    expect(describeSelectors(movementChain("STORE_OUT", { propertyNodeId: "property-office" }), ORG_NODES)).toContain("Property Administration");
  });
});

describe("movementChain: the line each movement walks", () => {
  const offices = { cmdNodeId: "cmd-office", propertyNodeId: "property-office" };
  const types = (selectors: StepSelector[]) => selectors.map((s) => (s.type === "NODE_OCCUPANT" ? s.nodeId : s.type));

  it("a loan keeps its departmental chain and never reaches a central office", () => {
    expect(types(movementChain("LOAN", { ...offices, crossesColleges: true, askReceivingCustodian: true }))).toEqual([
      "ITEM_CUSTODIAN",
      "OWNER_HEAD",
      "TARGET_CUSTODIAN",
      "TARGET_HEAD",
      "REQUESTER_RECEIPT",
    ]);
  });

  it("a permanent transfer inside one college goes to the CMD only", () => {
    expect(types(movementChain("PERMANENT", { ...offices, crossesColleges: false }))).toEqual(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "cmd-office", "REQUESTER_RECEIPT"]);
  });

  it("a permanent transfer between colleges goes to the CMD, then Property Administration", () => {
    expect(types(movementChain("PERMANENT", { ...offices, crossesColleges: true }))).toEqual([
      "ITEM_CUSTODIAN",
      "OWNER_HEAD",
      "TARGET_HEAD",
      "cmd-office",
      "property-office",
      "REQUESTER_RECEIPT",
    ]);
  });

  it("every Main Store movement goes to Property Administration, never Procurement", () => {
    expect(types(movementChain("STORE_OUT", offices))).toEqual(["property-office", "TARGET_CUSTODIAN"]);
    expect(types(movementChain("FROM_STORE", offices))).toEqual(["ITEM_CUSTODIAN", "TARGET_HEAD", "property-office", "REQUESTER_RECEIPT"]);
    expect(types(movementChain("TO_STORE", offices))).toEqual(["OWNER_HEAD", "property-office", "TARGET_CUSTODIAN"]);
    expect(types(movementChain("TO_STORE", { ...offices, askItemCustodian: true }))).toEqual(["ITEM_CUSTODIAN", "OWNER_HEAD", "property-office", "TARGET_CUSTODIAN"]);
    for (const shape of ["LOAN", "PERMANENT", "STORE_OUT", "FROM_STORE", "TO_STORE", "RETURN"] as const) {
      expect(types(movementChain(shape, { ...offices, crossesColleges: true }))).not.toContain("proc-office");
    }
  });

  it("resolves against the org chart: the CMD and Property Administration occupants decide their steps", () => {
    const steps = buildChain(movementChain("PERMANENT", { ...offices, crossesColleges: true }), {
      ownerNodeId: "se",
      targetNodeId: "chem",
      requesterId: "u1",
      nodes: ORG_NODES,
      orgIndex,
      item: { custodianId: "u9" } as Item,
    });
    expect(steps.map((s) => s.approverId)).toEqual(["u9", "p-head-se", "p-head-chem", "p-cmd", "p-property", "u1"]);
  });
});

describe("collapseRepeatedApprovers: one person, one signature", () => {
  it("skips a later consent step the same person already holds, but never an acceptance or a receipt", () => {
    const steps = collapseRepeatedApprovers(
      buildChain([{ type: "ITEM_CUSTODIAN" }, { type: "OWNER_HEAD" }, { type: "TARGET_HEAD" }, { type: "TARGET_CUSTODIAN" }, { type: "REQUESTER_RECEIPT" }], {
        ownerNodeId: "se",
        targetNodeId: "se",
        targetCustodianId: "p-head-se",
        requesterId: "u1",
        nodes: ORG_NODES,
        orgIndex,
        item: { custodianId: "u9" } as Item,
      }),
    );
    expect(steps.map((s) => [s.selector, s.status])).toEqual([
      ["ITEM_CUSTODIAN", "PENDING"],
      ["OWNER_HEAD", "WAITING"],
      ["TARGET_HEAD", "SKIPPED"],
      ["TARGET_CUSTODIAN", "WAITING"],
      ["REQUESTER_RECEIPT", "WAITING"],
    ]);
    expect(steps[2].skipReason).toBe("Already approved at an earlier step");
  });
});

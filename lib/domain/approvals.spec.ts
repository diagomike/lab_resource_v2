import { describe, expect, it } from "vitest";
import {
  SEED_POLICIES,
  activate,
  buildChain,
  canDecide,
  chainSettled,
  currentStep,
  describeChain,
  describeSelectors,
  isBlocked,
  resolvePolicy,
  validateChain,
  type ApprovalPolicy,
  type ChainStep,
  type StepSelector,
} from "./approvals";
import { indexOrgChain } from "./org-chain";
import { ORG_NODES, PEOPLE, SEED_CATEGORIES } from "./__fixtures__/seed";
import type { Category, ChangeKind, Item, Person } from "./types";
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
const cat = (id: string): Category => SEED_CATEGORIES.find((c) => c.id === id)!;

const policy = (over: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  id: "p",
  name: "p",
  operation: "setStatus",
  appliesTo: { type: "ANY" },
  actorRole: "ANY",
  outcome: "AUTO",
  enabled: true,
  ...over,
});

function chain(selectors: StepSelector[], over: Partial<Parameters<typeof buildChain>[1]> = {}) {
  return buildChain(selectors, {
    ownerNodeId: "se",
    requesterId: "u1",
    nodes: ORG_NODES,
    orgIndex,
    ...over,
  });
}

describe("resolvePolicy", () => {
  const resolve = (policies: ApprovalPolicy[], person: Person, category?: Category) => resolvePolicy({ operation: "setStatus", person, category, policies });

  it("refuses when no rule matches — silence is not permission", () => {
    const r = resolve([], who("u1"));
    expect(r.outcome).toBe("DENY");
    expect(r.reason).toMatch(/no approval rule/i);
  });

  it("prefers a rule naming the role over one matching anybody", () => {
    const r = resolve(
      [
        policy({ id: "a", name: "anyone", actorRole: "ANY", outcome: "CHAIN", chain: [{ type: "OWNER_HEAD" }] }),
        policy({ id: "b", name: "custodians", actorRole: "CUSTODIAN", outcome: "AUTO" }),
      ],
      who("u1"),
    );
    expect(r.policy?.id).toBe("b");
    expect(r.outcome).toBe("AUTO");
  });

  it("prefers the narrower object selector", () => {
    const computer = cat("computer");
    const ranked = resolve(
      [
        policy({ id: "any", appliesTo: { type: "ANY" }, outcome: "CHAIN", chain: [{ type: "OWNER_HEAD" }] }),
        policy({ id: "group", appliesTo: { type: "GROUP", group: computer.group }, outcome: "DENY" }),
        policy({ id: "exact", appliesTo: { type: "CATEGORY", categoryId: "computer" }, outcome: "AUTO" }),
      ],
      who("u1"),
      computer,
    );
    expect(ranked.policy?.id).toBe("exact");
  });

  it("picks the narrower role when somebody holds two posts", () => {
    // A person who was both PROPERTY_ADMIN and CUSTODIAN had their rule chosen by
    // whichever id sorted first — "pol-create-cust" beat "pol-prop-admin-createItem"
    // — so the store's own intake was quietly sent up for approval. Anybody wearing
    // two hats hits this, so it is ranked rather than left to alphabetical accident.
    const twoHats: Person = { id: "two-hats", name: "Two hats", homeOrgNodeId: "se", roles: ["PROPERTY_ADMIN", "CUSTODIAN"] };
    const r = resolvePolicy({ operation: "createItem", person: twoHats, category: cat("computer"), policies: SEED_POLICIES });
    expect(r.outcome).toBe("AUTO");
    expect(r.policy?.actorRole).toBe("PROPERTY_ADMIN");

    // A plain custodian still routes, which is the rule that had been winning.
    expect(resolvePolicy({ operation: "createItem", person: who("u1"), category: cat("computer"), policies: SEED_POLICIES }).outcome).toBe("CHAIN");
  });

  it("gives the store keeper their own rules rather than borrowed ones", () => {
    const keeper = who("p-store");
    expect(keeper.roles).toEqual(["STORE_KEEPER", "STAFF"]);
    // Booking goods in is the job, so it applies at once...
    expect(resolvePolicy({ operation: "createItem", person: keeper, category: cat("computer"), policies: SEED_POLICIES }).outcome).toBe("AUTO");
    // ...but handing stock to a department changes who answers for it, so it does not.
    const handover = resolvePolicy({ operation: "transferItem", person: keeper, category: cat("computer"), policies: SEED_POLICIES });
    expect(handover.outcome).toBe("CHAIN");
    expect(handover.policy?.chain).toEqual([{ type: "TARGET_HEAD" }, { type: "TARGET_CUSTODIAN" }]);
  });

  it("treats a routing rule that names no approver as a refusal", () => {
    const r = resolve([policy({ outcome: "CHAIN", chain: [] })], who("u1"));
    expect(r.outcome).toBe("DENY");
    expect(r.reason).toMatch(/names no approver/i);
  });

  it("ignores disabled rules", () => {
    const r = resolve([policy({ outcome: "AUTO", enabled: false })], who("u1"));
    expect(r.outcome).toBe("DENY");
  });
});

describe("buildChain — the org chart is the route", () => {
  it("walks up from the owning unit, nearest office first", () => {
    const steps = chain([{ type: "HIERARCHY", stopAtKind: "UNIVERSITY" }]);
    expect(steps.map((s) => s.nodeId)).toEqual(["coeec", "astu"]);
  });

  it("stops at the named kind, inclusive", () => {
    const steps = chain([{ type: "HIERARCHY", stopAtKind: "COLLEGE" }]);
    expect(steps.map((s) => s.nodeId)).toEqual(["coeec"]);
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
      "College — College of Electrical Engineering and Computing — currently vacant → University — Adama Science and Technology University",
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
  it("says the relation, not the unit — the same rule covers every pair", () => {
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
    expect(describeSelectors([], ORG_NODES)).toBe("nobody — applies immediately");
  });

  it("shows every step of a rule the old preview truncated", () => {
    const storeTransfer = SEED_POLICIES.find((p) => p.id === "pol-store-transfer")!;
    expect(describeSelectors(storeTransfer.chain!, ORG_NODES)).toBe("Head of the receiving unit → Receiving custodian accepts");

    const headBorrow = SEED_POLICIES.find((p) => p.id === "pol-transfer-mgr")!;
    expect(describeSelectors(headBorrow.chain!, ORG_NODES)).toBe("Current custodian → Head of the owning unit → Requester confirms receipt");
  });
});

describe("the seeded rules match what the university described", () => {
  const resolve = (operation: ChangeKind, person: Person, category?: Category) => resolvePolicy({ operation, person, category, policies: SEED_POLICIES });

  it("lets a custodian correct a field with no approval at all", () => {
    expect(resolve("setProperty", who("u1"), cat("computer")).outcome).toBe("AUTO");
  });

  it("sends a custodian's status change to the department head", () => {
    const r = resolve("setStatus", who("u1"), cat("computer"));
    expect(r.outcome).toBe("CHAIN");
    expect(describeChain(chain(r.policy!.chain!))).toBe("Head — Software Engineering");
  });

  it("but lets consumables be written off directly", () => {
    // A bottle of acetone running out is a fact being recorded, not a decision.
    expect(cat("chemical").countingMode).toBe("BULK");
    expect(resolve("setStatus", who("u1"), cat("chemical")).outcome).toBe("AUTO");
  });

  it("routes a new resource all the way up and back for receipt", () => {
    const r = resolve("createItem", who("u1"), cat("computer"));
    expect(r.outcome).toBe("CHAIN");
    expect(describeChain(chain(r.policy!.chain!))).toBe(
      "Head — Software Engineering → College — College of Electrical Engineering and Computing → University — Adama Science and Technology University → Procurement Office → Confirm receipt",
    );
  });

  it("lets a head create a laboratory outright, but not equipment", () => {
    expect(resolve("createItem", who("p-head-se"), cat("lab")).outcome).toBe("AUTO");
    expect(resolve("createItem", who("p-head-se"), cat("computer")).outcome).toBe("CHAIN");
  });

  it("refuses students and instructors everything", () => {
    for (const op of ["setProperty", "setStatus", "createItem", "deleteItem"] as ChangeKind[]) {
      expect(resolve(op, who("u7"), cat("computer")).outcome).toBe("DENY");
      expect(resolve(op, who("u2"), cat("computer")).outcome).toBe("DENY");
    }
  });

  it("lets the property office act on the register it holds", () => {
    expect(resolve("setStatus", who("p-property"), cat("computer")).outcome).toBe("AUTO");
  });

  it("names a role for every rule it enables, or matches anybody deliberately", () => {
    for (const p of SEED_POLICIES) {
      if (p.outcome === "CHAIN") expect(p.chain?.length).toBeGreaterThan(0);
    }
  });
});

describe("role coverage", () => {
  it("gives every role that can hold resources some way to record a correction", () => {
    for (const role of ["CUSTODIAN", "MANAGER", "PROPERTY_ADMIN", "PROCUREMENT"] as RoleKind[]) {
      const person: Person = { id: "x", name: "x", homeOrgNodeId: "se", roles: [role] };
      expect(resolvePolicy({ operation: "setProperty", person, category: cat("computer"), policies: SEED_POLICIES }).outcome).toBe("AUTO");
    }
  });
});

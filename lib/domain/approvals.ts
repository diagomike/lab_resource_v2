/**
 * One idea, and it is the institution's own: THE ORG CHART IS THE APPROVAL ROUTE.
 * There is no "is this an approval office" flag. Being a parent in the hierarchy is
 * what makes an office an approver, so nothing reaches the Academic Vice President
 * without passing through its college first.
 *
 * Two invariants matter more than the rest:
 *   · A HEADLESS OFFICE BLOCKS, never routes around itself. A request may only be
 *     held up by a step that can legitimately be decided; a vacant deanship is a
 *     structural gap, not a refusal, and the request stops dead until somebody is
 *     appointed.
 *   · Authorization is by occupancy, checked live. A step belongs to an office, not
 *     a person, so an in-flight request follows a change of head rather than
 *     stalling on whoever held the post when it was raised.
 *
 * Rules are (operation × who is acting × what kind of thing) and resolve to one of
 * three answers — applies immediately, needs approval, or not permitted. Most
 * specific wins. NO MATCHING RULE MEANS REFUSED.
 *
 * Ported from temp_works/src/lib/approvals.ts essentially verbatim. The one real
 * change: `buildChain`/`validateChain` take a `ChainContext` built from
 * lib/domain/org-chain.ts's `OrgChainIndex` instead of temp_works' own org.ts
 * `OrgIndex` — see that module's header for why (it is a thin adapter over the
 * already-shipped closure-algorithm.ts, not a re-derivation).
 */
import { ancestorsOfChain, indexOrgChain, type OrgChainIndex } from "./org-chain";
import type { Category, ChangeKind, CountingMode, Item, OrgNode, Person } from "./types";
import type { OrgNodeKind, RoleKind } from "@/lib/shared";

// ── Selectors ────────────────────────────────────────────────────────────

export type StepSelector =
  /** Walk up the org chart from the owning unit, stopping at this kind inclusive. */
  | { type: "HIERARCHY"; stopAtKind: OrgNodeKind }
  /** A named office — Procurement and Property are not ancestors of anything. */
  | { type: "NODE_OCCUPANT"; nodeId: string }
  /**
   * The owning unit's nearest ancestor OF A NAMED LEVEL, rather than the next step
   * up. An external request runs the other way — Vice President, then dean, then
   * head — because it arrives at the institution rather than from inside a
   * department, so it needs to name a level directly instead of stepping toward one.
   */
  | { type: "OWNER_ANCESTOR"; kind: OrgNodeKind }
  /** The head of the unit that owns the resource. */
  | { type: "OWNER_HEAD" }
  /** The head of the unit receiving it. Transfers only. */
  | { type: "TARGET_HEAD" }
  /** Whoever is answerable for the resource today. */
  | { type: "ITEM_CUSTODIAN" }
  /** Whoever will be answerable for it once it lands. */
  | { type: "TARGET_CUSTODIAN" }
  /** Back to the person who asked: "I have received it." Never skipped. */
  | { type: "REQUESTER_RECEIPT" };

export type ObjectSelector =
  | { type: "ANY" }
  | { type: "GROUP"; group: string }
  | { type: "CATEGORY"; categoryId: string }
  | { type: "COUNTING_MODE"; mode: CountingMode };

export interface ApprovalPolicy {
  id: string;
  name: string;
  operation: ChangeKind;
  /** Which resources this rule speaks about. */
  appliesTo: ObjectSelector;
  /** "ANY" matches every role. */
  actorRole: RoleKind | "ANY";
  outcome: "AUTO" | "CHAIN" | "DENY";
  /** CHAIN only. An empty chain is treated as DENY — it routes to nobody. */
  chain?: StepSelector[];
  enabled: boolean;
}

export type StepStatus = "PENDING" | "WAITING" | "APPROVED" | "REJECTED" | "SKIPPED";

export interface ChainStep {
  id: string;
  order: number;
  /** Which selector produced this step, so it can say how to re-resolve itself.
   *  Authorization must not hang off display text. */
  selector: StepSelector["type"];
  label: string;
  /** The office this step belongs to. null for custodian/receipt steps. */
  nodeId: string | null;
  /** Who may decide it, resolved at build time and re-checked live at decision
   *  time. null means the post is VACANT, which holds the request rather than
   *  skipping it. */
  approverId: string | null;
  status: StepStatus;
  skipReason: string | null;
  /** A receipt is the requester confirming delivery, not an approval. */
  receipt: boolean;
  decidedById?: string;
  decidedAt?: string;
  note?: string;
}

export interface ChainContext {
  item?: Item;
  ownerNodeId: string | null;
  targetNodeId?: string | null;
  targetCustodianId?: string | null;
  requesterId: string;
  nodes: OrgNode[];
  orgIndex: OrgChainIndex;
}

// ── Policy resolution ────────────────────────────────────────────────────

function objectMatches(selector: ObjectSelector, category: Category | undefined): boolean {
  if (selector.type === "ANY") return true;
  if (!category) return false;
  if (selector.type === "CATEGORY") return category.id === selector.categoryId;
  if (selector.type === "GROUP") return category.group === selector.group;
  return category.countingMode === selector.mode;
}

/** More specific rules win. A rule about one category beats a rule about anything. */
function objectSpecificity(selector: ObjectSelector): number {
  return selector.type === "CATEGORY" ? 3 : selector.type === "GROUP" ? 2 : selector.type === "COUNTING_MODE" ? 1 : 0;
}

/**
 * Roles from most specific to least — the tie-breaker whenever a person holds
 * several and two rules both claim them. Almost everybody is STAFF, so a rule aimed
 * at staff is the weakest possible claim on a person.
 */
const ROLE_SPECIFICITY: RoleKind[] = ["SYS_ADMIN", "PROPERTY_ADMIN", "PROCUREMENT", "STORE_KEEPER", "MANAGER", "CUSTODIAN", "STAFF", "STUDENT", "EXTERNAL"];

/** Higher is narrower. 0 for a rule that matches anybody. */
function roleRank(role: RoleKind | "ANY"): number {
  if (role === "ANY") return 0;
  const at = ROLE_SPECIFICITY.indexOf(role);
  return at === -1 ? 1 : ROLE_SPECIFICITY.length - at;
}

export interface PolicyResolution {
  outcome: "AUTO" | "CHAIN" | "DENY";
  policy?: ApprovalPolicy;
  reason: string;
}

/**
 * Which rule governs this change. No matching rule means DENY, and that is the
 * institution's own stated rule: if an approval path has not been configured for
 * someone, they do not have the privilege. Silence is a refusal, not a permission.
 */
export function resolvePolicy(input: { operation: ChangeKind; person: Person | undefined; category?: Category; policies: ApprovalPolicy[] }): PolicyResolution {
  if (!input.person) return { outcome: "DENY", reason: "Nobody is signed in." };
  const roles = input.person.roles ?? [];

  const matching = input.policies
    .filter((p) => p.enabled && p.operation === input.operation)
    .filter((p) => p.actorRole === "ANY" || roles.includes(p.actorRole))
    .filter((p) => objectMatches(p.appliesTo, input.category))
    .sort(
      (a, b) =>
        // A rule naming a role beats one matching anybody, and between two named
        // roles the narrower one wins. That second half is load-bearing for anyone
        // holding more than one post: the main store keeper is both PROPERTY_ADMIN
        // and CUSTODIAN, and without it the winner was decided by whichever rule id
        // sorted first — which silently sent the store's own intake for approval.
        roleRank(b.actorRole) - roleRank(a.actorRole) || objectSpecificity(b.appliesTo) - objectSpecificity(a.appliesTo) || a.id.localeCompare(b.id),
    );

  const policy = matching[0];
  if (!policy) {
    return { outcome: "DENY", reason: "No approval rule grants this action, so it is not permitted." };
  }
  if (policy.outcome === "CHAIN" && !policy.chain?.length) {
    return { outcome: "DENY", policy, reason: `"${policy.name}" routes for approval but names no approver.` };
  }
  return { outcome: policy.outcome, policy, reason: policy.name };
}

// ── Chain building ───────────────────────────────────────────────────────

const KIND_LABEL: Record<OrgNodeKind, string> = {
  UNIVERSITY: "University",
  COLLEGE: "College",
  DEPARTMENT: "Department",
  OFFICE: "Office",
};

function step(order: number, selector: StepSelector["type"], label: string, nodeId: string | null, approverId: string | null, receipt = false, skipReason: string | null = null): ChainStep {
  return {
    id: `s${order}`,
    order,
    selector,
    label,
    nodeId,
    approverId,
    status: skipReason ? "SKIPPED" : "WAITING",
    skipReason,
    receipt,
  };
}

/**
 * Turn a policy's selectors into concrete steps against the real org chart.
 *
 * EXACTLY ONE thing causes a skip, and it is not a refusal: the only person who
 * could decide the step is the person who asked. Self-approval is not rejected, it
 * is simply not an approval, so the request moves on to whoever is next.
 *
 * A VACANT POST DOES NOT SKIP — it holds the request. The step is built with no
 * approver, sits there showing the office as vacant, and becomes decidable the
 * moment somebody is appointed to it.
 *
 * A selector naming an office not on the org chart at all produces no step and
 * would silently shorten the route, so `validateChain` refuses the request before
 * this ever runs.
 */
export function buildChain(selectors: StepSelector[], ctx: ChainContext): ChainStep[] {
  const steps: ChainStep[] = [];
  const push = (selector: StepSelector["type"], label: string, nodeId: string | null, approverId: string | null, opts: { receipt?: boolean } = {}) => {
    const order = steps.length;
    if (opts.receipt) {
      steps.push(step(order, selector, label, nodeId, approverId, true));
      return;
    }
    if (approverId && approverId === ctx.requesterId) {
      steps.push(step(order, selector, label, nodeId, approverId, false, "The requester holds this post — skipped"));
      return;
    }
    steps.push(step(order, selector, label, nodeId, approverId));
  };

  const headOf = (nodeId: string | null | undefined) => {
    if (!nodeId) return { node: undefined, occupant: null as string | null };
    const node = ctx.nodes.find((n) => n.id === nodeId && n.active);
    return { node, occupant: node?.occupantId ?? null };
  };

  for (const selector of selectors) {
    switch (selector.type) {
      case "HIERARCHY": {
        if (!ctx.ownerNodeId) break;
        const stopLevel = ctx.nodes.find((n) => n.kind === selector.stopAtKind)?.level;
        for (const { node } of ancestorsOfChain(ctx.ownerNodeId, ctx.orgIndex)) {
          push("HIERARCHY", `${KIND_LABEL[node.kind]} — ${node.name}`, node.id, node.occupantId);
          // Inclusive: stopping "at the college" means the college decides and the
          // walk ends there rather than carrying on to the university.
          if (node.kind === selector.stopAtKind) break;
          if (stopLevel !== undefined && node.level <= stopLevel) break;
        }
        break;
      }
      case "NODE_OCCUPANT": {
        const { node, occupant } = headOf(selector.nodeId);
        if (node) push("NODE_OCCUPANT", node.name, node.id, occupant);
        break;
      }
      case "OWNER_ANCESTOR": {
        if (!ctx.ownerNodeId) break;
        const found = ancestorsOfChain(ctx.ownerNodeId, ctx.orgIndex).find((a) => a.node.kind === selector.kind);
        if (found) {
          push("OWNER_ANCESTOR", `${KIND_LABEL[found.node.kind]} — ${found.node.name}`, found.node.id, found.node.occupantId);
        }
        break;
      }
      case "OWNER_HEAD": {
        const { node, occupant } = headOf(ctx.ownerNodeId);
        if (node) push("OWNER_HEAD", `Head — ${node.name}`, node.id, occupant);
        break;
      }
      case "TARGET_HEAD": {
        const { node, occupant } = headOf(ctx.targetNodeId);
        if (node) push("TARGET_HEAD", `Receiving head — ${node.name}`, node.id, occupant);
        break;
      }
      case "ITEM_CUSTODIAN": {
        // No branch for "the resource has no custodian": it never has none. Custody
        // hands off, it does not lapse — see Item.custodianId.
        push("ITEM_CUSTODIAN", "Current custodian", null, ctx.item?.custodianId ?? null);
        break;
      }
      case "TARGET_CUSTODIAN": {
        // Accepting something into your own laboratory is the moment you become
        // answerable for it, so it is never skipped for being the requester: a
        // store keeper handing stock to themselves still has to sign for it.
        push("TARGET_CUSTODIAN", "Receiving custodian accepts", null, ctx.targetCustodianId ?? null, { receipt: ctx.targetCustodianId === ctx.requesterId });
        break;
      }
      case "REQUESTER_RECEIPT": {
        push("REQUESTER_RECEIPT", "Confirm receipt", null, ctx.requesterId, { receipt: true });
        break;
      }
    }
  }

  return activate(steps);
}

/**
 * Would this route lose a step against the org chart it will actually run on?
 *
 * A rule names an office by id and an institution whose chart has no such node
 * produces a chain with that step simply absent: not skipped, not shown, not in the
 * audit trail. Blocking instead would queue forever, since nobody can be appointed
 * to an office that does not exist, so this refuses the request up front and names
 * what is wrong, where an administrator can fix the rule.
 *
 * Returns an error message, or undefined when every named office resolves.
 */
export function validateChain(selectors: StepSelector[], ctx: Pick<ChainContext, "ownerNodeId" | "targetNodeId" | "nodes" | "orgIndex">): string | undefined {
  const live = (nodeId: string | null | undefined) => !!nodeId && ctx.nodes.some((n) => n.id === nodeId && n.active);

  for (const selector of selectors) {
    if (selector.type === "NODE_OCCUPANT" && !live(selector.nodeId)) {
      const named = ctx.nodes.find((n) => n.id === selector.nodeId)?.name ?? selector.nodeId;
      return `This approval rule routes through "${named}", which is not on the org chart. Ask an administrator to correct the rule.`;
    }
    if (selector.type === "OWNER_HEAD" && !live(ctx.ownerNodeId)) {
      return "This resource has no owning unit on the org chart, so there is nobody to route it to.";
    }
    if (selector.type === "TARGET_HEAD" && !live(ctx.targetNodeId)) {
      return "The receiving unit is not on the org chart.";
    }
    if (selector.type === "OWNER_ANCESTOR" && ctx.ownerNodeId) {
      const found = ancestorsOfChain(ctx.ownerNodeId, ctx.orgIndex).find((a) => a.node.kind === selector.kind);
      if (!found) {
        return `This approval rule routes through the ${KIND_LABEL[selector.kind].toLowerCase()} above the owning unit, and there is none. Ask an administrator to correct the rule.`;
      }
    }
  }
  return undefined;
}

/** The first step that can actually be decided becomes PENDING; the rest wait. */
export function activate(steps: ChainStep[]): ChainStep[] {
  let armed = false;
  return steps.map((s) => {
    if (s.status === "SKIPPED" || s.status === "APPROVED" || s.status === "REJECTED") return s;
    if (!armed) {
      armed = true;
      return { ...s, status: "PENDING" as StepStatus };
    }
    return { ...s, status: "WAITING" as StepStatus };
  });
}

/** True when every step has been decided or skipped — nothing left to wait for. */
export function chainSettled(steps: ChainStep[]): boolean {
  return steps.every((s) => s.status === "APPROVED" || s.status === "SKIPPED");
}

export function currentStep(steps: ChainStep[]): ChainStep | undefined {
  return steps.find((s) => s.status === "PENDING");
}

/** What a step needs in order to say who may decide it today. */
export interface ResolveContext {
  nodes: OrgNode[];
  /** The resource, for a custodian step — custody can change hands mid-request. */
  item?: Item;
}

/**
 * Who may decide this step RIGHT NOW — the one place that answers it.
 *
 * Deliberately re-derived rather than trusting the `approverId` frozen into the
 * step: if the head of department changed yesterday, it is the new head who
 * decides. That is also what makes a vacancy self-healing — appointing somebody to
 * the office unblocks every request waiting on it, with no rebuild and no
 * re-resolution pass.
 *
 * Returns null when the post is vacant, which is exactly the blocked case.
 */
export function resolveApprover(step: ChainStep, ctx: ResolveContext): string | null {
  if (step.nodeId) {
    const node = ctx.nodes.find((n) => n.id === step.nodeId && n.active);
    return node?.occupantId ?? null;
  }
  // A receipt names the requester and a receiving custodian names a person, not an
  // office; neither is re-derivable from the chart, so the frozen id stands.
  if (step.selector === "ITEM_CUSTODIAN") return ctx.item?.custodianId ?? step.approverId;
  return step.approverId;
}

/** May this person decide this step right now? */
export function canDecide(step: ChainStep | undefined, person: Person | undefined, nodes: OrgNode[], item?: Item): boolean {
  if (!step || !person || step.status !== "PENDING") return false;
  return resolveApprover(step, { nodes, item }) === person.id;
}

/** Waiting on an empty post — live, not skipped, and decidable by nobody until the
 *  institution fills the office. */
export function isBlocked(step: ChainStep, ctx: ResolveContext): boolean {
  if (step.status !== "PENDING" && step.status !== "WAITING") return false;
  return !resolveApprover(step, ctx);
}

/** A ROUTE THAT EXISTS: "Head — Software Engineering → College — CoEEC → Confirm
 *  receipt". One request's resolved chain, so the offices are named — do not reach
 *  for it to draw a POLICY, see `describeSelectors`. */
export function describeChain(steps: ChainStep[], ctx?: ResolveContext): string {
  const live = steps.filter((s) => s.status !== "SKIPPED");
  if (!live.length) return "nobody — applies immediately";
  return live.map((s) => (ctx && isBlocked(s, ctx) ? `${s.label} — currently vacant` : s.label)).join(" → ");
}

/** What each kind of step is, said without reference to any particular unit. */
export const SELECTOR_LABEL: Record<StepSelector["type"], string> = {
  HIERARCHY: "Up the org chart",
  NODE_OCCUPANT: "A named office",
  OWNER_ANCESTOR: "A level above the owner",
  OWNER_HEAD: "Head of the owning unit",
  TARGET_HEAD: "Head of the receiving unit",
  ITEM_CUSTODIAN: "Current custodian",
  TARGET_CUSTODIAN: "Receiving custodian accepts",
  REQUESTER_RECEIPT: "Requester confirms receipt",
};

/**
 * A RULE THAT DESCRIBES ROUTES: "Head of the owning unit → Head of the receiving
 * unit → Requester confirms receipt". A policy names offices BY THEIR RELATION to
 * the request and never by id, which is what lets one rule cover every pair of
 * units in the university. Resolving it against a sample department would make a
 * generic rule read as though it were about those two departments, and would
 * quietly drop any step the sample context cannot resolve. `nodes` is needed only
 * for NODE_OCCUPANT, which genuinely names a fixed office.
 */
export function describeSelectors(selectors: StepSelector[], nodes: OrgNode[]): string {
  if (!selectors.length) return "nobody — applies immediately";
  return selectors.map((s) => selectorLabel(s, nodes)).join(" → ");
}

function selectorLabel(selector: StepSelector, nodes: OrgNode[]): string {
  switch (selector.type) {
    case "HIERARCHY":
      return `Up the org chart to the ${KIND_LABEL[selector.stopAtKind].toLowerCase()}`;
    case "OWNER_ANCESTOR":
      return `The ${KIND_LABEL[selector.kind].toLowerCase()} above the owning unit`;
    case "NODE_OCCUPANT":
      // A rule may outlive the office it names. Saying so is the point: this is the
      // same misconfiguration `validateChain` refuses a request for, surfaced here
      // where an administrator can actually correct the rule.
      return nodes.find((n) => n.id === selector.nodeId)?.name ?? "an office that is not on the org chart";
    default:
      return SELECTOR_LABEL[selector.type];
  }
}

/** Who currently occupies a step's office, for display. */
export function stepHolder(step: ChainStep, nodes: OrgNode[], people: Person[]): Person | undefined {
  const id = step.nodeId ? nodes.find((n) => n.id === step.nodeId)?.occupantId : step.approverId;
  return people.find((p) => p.id === id);
}

/** Builds a ChainContext's `orgIndex` from a flat node list — the one piece of
 *  wiring temp_works' own `ChainContext` construction did inline via `indexOrg`. */
export function buildOrgIndex(nodes: OrgNode[]) {
  return indexOrgChain(nodes);
}

// ─────────────────────────────────────────────────────────────────────────
// The rules an institution starts with. These are the cases the university stated
// in its own words, written out. The shape of the set matters as much as its
// contents: correcting a fact applies at once, deciding something routes, and
// anything not named here is refused. Genuinely production seed content (a later
// phase's prisma seed script writes these into ApprovalPolicy rows), kept here
// rather than split into a fixtures-only file, matching temp_works' own layout.
// ─────────────────────────────────────────────────────────────────────────

function p(id: string, name: string, operation: ChangeKind, actorRole: RoleKind | "ANY", outcome: ApprovalPolicy["outcome"], extra: Partial<ApprovalPolicy> = {}): ApprovalPolicy {
  return { id, name, operation, actorRole, outcome, appliesTo: { type: "ANY" }, enabled: true, ...extra };
}

/** Department head, then up the chart, then procurement, then back for receipt. */
const ADD_CHAIN: StepSelector[] = [
  { type: "OWNER_HEAD" },
  { type: "HIERARCHY", stopAtKind: "UNIVERSITY" },
  { type: "NODE_OCCUPANT", nodeId: "proc-office" },
  { type: "REQUESTER_RECEIPT" },
];

export const SEED_POLICIES: ApprovalPolicy[] = [
  // ── Corrections apply on the spot ────────────────────────────────────────
  // "for simple field change, add actions lab assistants can do it without any
  // request approval path". Making a custodian queue a request to fix a typo in a
  // serial number is how a register stops being kept up to date at all.
  p("pol-prop-cust", "Custodians correct their own records", "setProperty", "CUSTODIAN", "AUTO"),
  p("pol-name-cust", "Custodians rename their own records", "setName", "CUSTODIAN", "AUTO"),
  p("pol-qty-cust", "Custodians adjust stock quantities", "setQuantity", "CUSTODIAN", "AUTO"),
  p("pol-img-add", "Custodians add photographs", "addImage", "CUSTODIAN", "AUTO"),
  p("pol-img-del", "Custodians remove photographs", "removeImage", "CUSTODIAN", "AUTO"),

  // ── Status is a decision, not a correction ──────────────────────────────
  p("pol-status-cust", "Status changes go to the department head", "setStatus", "CUSTODIAN", "CHAIN", { chain: [{ type: "OWNER_HEAD" }] }),
  // "for consumables it might not need those levels" — a bottle of acetone running
  // out is a fact being recorded, not a decision being taken.
  p("pol-status-bulk", "Consumables are written off without approval", "setStatus", "CUSTODIAN", "AUTO", { appliesTo: { type: "COUNTING_MODE", mode: "BULK" } }),

  // ── Creating, deleting, moving ───────────────────────────────────────────
  p("pol-create-cust", "New resources follow the procurement route", "createItem", "CUSTODIAN", "CHAIN", { chain: ADD_CHAIN }),
  p("pol-delete-cust", "Deletions need the head and the college", "deleteItem", "CUSTODIAN", "CHAIN", {
    chain: [{ type: "OWNER_HEAD" }, { type: "HIERARCHY", stopAtKind: "COLLEGE" }],
  }),
  p("pol-move-cust", "Relocation needs the department head", "moveInTree", "CUSTODIAN", "CHAIN", { chain: [{ type: "OWNER_HEAD" }] }),
  p("pol-custodian-cust", "Handing custody on needs the head", "setCustodian", "CUSTODIAN", "CHAIN", { chain: [{ type: "OWNER_HEAD" }] }),

  // ── Heads and deans ──────────────────────────────────────────────────────
  p("pol-prop-mgr", "Heads correct records in their own unit", "setProperty", "MANAGER", "AUTO"),
  p("pol-name-mgr", "Heads rename records in their own unit", "setName", "MANAGER", "AUTO"),
  p("pol-qty-mgr", "Heads adjust stock", "setQuantity", "MANAGER", "AUTO"),
  p("pol-status-mgr", "Heads set status directly", "setStatus", "MANAGER", "AUTO"),
  p("pol-custodian-mgr", "Heads assign custody in their own unit", "setCustodian", "MANAGER", "AUTO"),
  p("pol-move-mgr", "Heads relocate within their own unit", "moveInTree", "MANAGER", "AUTO"),
  p("pol-img-mgr", "Heads add photographs", "addImage", "MANAGER", "AUTO"),
  // "Department head can create labs" — a place is organisational, not procured.
  p("pol-create-place-mgr", "Heads create laboratories and stores", "createItem", "MANAGER", "AUTO", { appliesTo: { type: "GROUP", group: "Places" } }),
  p("pol-create-mgr", "Equipment a head adds still goes up the chart", "createItem", "MANAGER", "CHAIN", {
    chain: [{ type: "HIERARCHY", stopAtKind: "UNIVERSITY" }, { type: "NODE_OCCUPANT", nodeId: "proc-office" }, { type: "REQUESTER_RECEIPT" }],
  }),
  p("pol-delete-mgr", "A head's deletion still needs the college", "deleteItem", "MANAGER", "CHAIN", { chain: [{ type: "HIERARCHY", stopAtKind: "COLLEGE" }] }),

  // ── Borrowing from another department ───────────────────────────────────
  // The university's own sequence: the custodian who currently holds it, then the
  // head of the unit that owns it, then the head of the unit receiving it, and
  // finally back to whoever asked, to confirm the thing actually arrived.
  p("pol-transfer-cust", "Borrowing needs both units and a receipt", "transferItem", "CUSTODIAN", "CHAIN", {
    chain: [{ type: "ITEM_CUSTODIAN" }, { type: "OWNER_HEAD" }, { type: "TARGET_HEAD" }, { type: "REQUESTER_RECEIPT" }],
  }),
  p("pol-transfer-mgr", "A head borrowing still needs the owning unit", "transferItem", "MANAGER", "CHAIN", {
    chain: [{ type: "ITEM_CUSTODIAN" }, { type: "OWNER_HEAD" }, { type: "REQUESTER_RECEIPT" }],
  }),

  // ── Ownership is the one nobody does alone ──────────────────────────────
  p("pol-owner-any", "Transferring ownership needs the college", "setOwnerOrg", "ANY", "CHAIN", {
    chain: [{ type: "OWNER_HEAD" }, { type: "HIERARCHY", stopAtKind: "COLLEGE" }],
  }),
  p("pol-current-any", "Moving a resource between units needs both heads", "setCurrentOrg", "ANY", "CHAIN", {
    chain: [{ type: "OWNER_HEAD" }, { type: "TARGET_HEAD" }, { type: "REQUESTER_RECEIPT" }],
  }),

  // ── The store keeper ─────────────────────────────────────────────────────
  // Booking goods in, naming them and correcting them is the whole job, so it
  // applies at once. Sending a store's own intake up for approval would stall
  // every delivery behind a signature nobody is waiting for.
  ...(["createItem", "setProperty", "setName", "setQuantity", "setStatus", "addImage", "removeImage", "moveInTree"] as ChangeKind[]).map((op) =>
    p(`pol-store-${op}`, "The store keeps its own shelves", op, "STORE_KEEPER", "AUTO"),
  ),
  // Handing stock out to a department is not a shelf move: ownership changes, so
  // the receiving custodian has to accept it.
  p("pol-store-transfer", "Handing stock over needs the receiving custodian", "transferItem", "STORE_KEEPER", "CHAIN", { chain: [{ type: "TARGET_CUSTODIAN" }] }),

  // ── The offices that hold the register ──────────────────────────────────
  // Property administration is the custodian of the whole register and
  // procurement is the office that books new equipment in, so neither routes to
  // anyone.
  ...(["setProperty", "setName", "setStatus", "setQuantity", "setCustodian", "moveInTree", "createItem", "addImage", "removeImage"] as ChangeKind[]).flatMap((op) => [
    p(`pol-prop-admin-${op}`, "Property administration holds the register", op, "PROPERTY_ADMIN", "AUTO"),
    p(`pol-procurement-${op}`, "Procurement books resources in", op, "PROCUREMENT", "AUTO"),
  ]),

  // Staff and students are named nowhere above, so every write they attempt is
  // refused by the no-matching-rule path. That is deliberate: it is the same
  // mechanism, demonstrated, rather than a special case.
];

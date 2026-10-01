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
 * Who may ASK for a movement is one fixed rule (`mayRequestTransfer`); the steps come
 * from the movement's shape (`movementChain`).
 *
 * Ported from temp_works/src/lib/approvals.ts essentially verbatim. The one real
 * change: `buildChain`/`validateChain` take a `ChainContext` built from
 * lib/domain/org-chain.ts's `OrgChainIndex` instead of temp_works' own org.ts
 * `OrgIndex` — see that module's header for why (it is a thin adapter over the
 * already-shipped closure-algorithm.ts, not a re-derivation).
 */
import { ancestorsOfChain, indexOrgChain, type OrgChainIndex } from "./org-chain";
import type { Item, OrgNode, Person } from "./types";
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
  /**
   * Whoever currently answers for the physical place a borrowed item sits — the
   * custodian of its current container, resolved server-side (the pure domain layer
   * has no DB access to walk containment) and handed in as `ChainContext.hostReleaserId`,
   * the same way `targetCustodianId` names a person rather than an office. Return
   * flow only (2026-09-20 fix for F-039 of the 2026-09-15 campaign): the host's
   * consent to let something go, before it travels back to its own owning unit.
   */
  | { type: "HOST_RELEASE" }
  /**
   * The item's own custodian (never re-derived — see ITEM_CUSTODIAN's own precedent
   * for why a receipt-type step is frozen at request time), confirming a returned
   * resource has come home. Never skipped, deliberately unlike ITEM_CUSTODIAN: a
   * return may be INITIATED by the host, not the lender, so "whoever asked" (which
   * REQUESTER_RECEIPT means) is the wrong person to confirm arrival — it must
   * always be the item's own custodian, receiving it back, regardless of which side
   * raised the request.
   */
  | { type: "OWNER_RECEIPT" }
  /** Back to the person who asked: "I have received it." Never skipped. */
  | { type: "REQUESTER_RECEIPT" };

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
  /** HOST_RELEASE only — who currently answers for where the item physically sits. */
  hostReleaserId?: string | null;
  requesterId: string;
  nodes: OrgNode[];
  orgIndex: OrgChainIndex;
}

// ── Who may ask ──────────────────────────────────────────────────────────

/** The people who move resources: a custodian, a department head, the store keeper,
 *  and the administrator. Anyone else is refused before any chain is built. */
const TRANSFER_REQUESTER_ROLES: RoleKind[] = ["CUSTODIAN", "MANAGER", "STORE_KEEPER", "SYS_ADMIN"];

export function mayRequestTransfer(person: Person | undefined): boolean {
  return !!person && (person.roles ?? []).some((r) => TRANSFER_REQUESTER_ROLES.includes(r));
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
          // Inclusive: stopping "at the college" means the college decides and the
          // walk ends there rather than carrying on to the university. EVERY ancestor
          // at that level is on the route — a department under two colleges needs
          // both deans, which stopping at the first college found silently dropped.
          if (stopLevel !== undefined && node.level < stopLevel) break;
          push("HIERARCHY", `${KIND_LABEL[node.kind]} — ${node.name}`, node.id, node.occupantId);
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
      case "HOST_RELEASE": {
        push("HOST_RELEASE", "Host releases it", null, ctx.hostReleaserId ?? null);
        break;
      }
      case "OWNER_RECEIPT": {
        push("OWNER_RECEIPT", "Confirm receipt", null, ctx.item?.custodianId ?? null, { receipt: true });
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

// ── Movements between units ──────────────────────────────────────────────

/**
 * What kind of movement a transfer is, read off its shape by the server — never taken
 * from the client:
 *  - LOAN: a pull that keeps the owner (borrowing).
 *  - PERMANENT: a pull that moves ownership and custody to the receiving side.
 *  - STORE_OUT: the store keeper handing stock over to a lab or a person.
 *  - FROM_STORE: a lab pulling stock out of the Main Store.
 *  - TO_STORE: sending something back into the Main Store.
 *  - RETURN: a loan going home to its owning unit.
 */
export type MovementShape = "LOAN" | "PERMANENT" | "STORE_OUT" | "FROM_STORE" | "TO_STORE" | "RETURN";

export interface MovementContext {
  /** The College Managing Director's office — every PERMANENT transfer. */
  cmdNodeId?: string | null;
  /** Property Administration — every Main Store movement, and a PERMANENT transfer
   *  between colleges. */
  propertyNodeId?: string | null;
  /** The owning and receiving units share no college. */
  crossesColleges?: boolean;
  /** The destination's own custodian is someone other than the requester, so they
   *  are asked (a pull) or accept (a store movement). */
  askReceivingCustodian?: boolean;
  /** The requester isn't the item's own custodian (a store keeper asking for
   *  something back into the store). */
  askItemCustodian?: boolean;
}

/**
 * The university's line for each movement. Local consent first (whoever holds it, the
 * unit that owns it, the room it lands in, the unit receiving it), then the central
 * office that answers for it, then whoever ends up holding it confirms:
 *  - a PERMANENT transfer always goes to the College Managing Director, and on to
 *    Property Administration when it leaves its college;
 *  - anything in or out of the Main Store goes to Property Administration;
 *  - a LOAN keeps its departmental chain — ownership never changes hands.
 * Procurement is never on a movement: it only buys.
 */
export function movementChain(shape: MovementShape, ctx: MovementContext): StepSelector[] {
  const cmd: StepSelector[] = ctx.cmdNodeId ? [{ type: "NODE_OCCUPANT", nodeId: ctx.cmdNodeId }] : [];
  const property: StepSelector[] = ctx.propertyNodeId ? [{ type: "NODE_OCCUPANT", nodeId: ctx.propertyNodeId }] : [];
  const receivingCustodian: StepSelector[] = ctx.askReceivingCustodian ? [{ type: "TARGET_CUSTODIAN" }] : [];
  switch (shape) {
    case "LOAN":
      return [{ type: "ITEM_CUSTODIAN" }, { type: "OWNER_HEAD" }, ...receivingCustodian, { type: "TARGET_HEAD" }, { type: "REQUESTER_RECEIPT" }];
    case "PERMANENT":
      return [
        { type: "ITEM_CUSTODIAN" },
        { type: "OWNER_HEAD" },
        ...receivingCustodian,
        { type: "TARGET_HEAD" },
        ...cmd,
        ...(ctx.crossesColleges ? property : []),
        { type: "REQUESTER_RECEIPT" },
      ];
    case "FROM_STORE":
      return [{ type: "ITEM_CUSTODIAN" }, ...receivingCustodian, { type: "TARGET_HEAD" }, ...property, { type: "REQUESTER_RECEIPT" }];
    case "STORE_OUT":
      return [{ type: "TARGET_HEAD" }, ...property, { type: "TARGET_CUSTODIAN" }];
    case "TO_STORE":
      return [...(ctx.askItemCustodian ? [{ type: "ITEM_CUSTODIAN" as const }] : []), { type: "OWNER_HEAD" }, ...property, { type: "TARGET_CUSTODIAN" }];
    case "RETURN":
      return [{ type: "HOST_RELEASE" }, { type: "OWNER_RECEIPT" }];
  }
}

/** Steps that ask for consent — as opposed to taking something on or confirming it arrived. */
const CONSENT_SELECTORS: ReadonlySet<StepSelector["type"]> = new Set(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "NODE_OCCUPANT", "HOST_RELEASE", "HIERARCHY", "OWNER_ANCESTOR"]);

/**
 * One person, one signature: when the same person holds two consent steps on a route
 * (the owning and the receiving head of a move inside one department), the later one
 * is skipped rather than asking them twice. Taking custody or confirming receipt is
 * never collapsed — that is a different act from agreeing to it.
 */
export function collapseRepeatedApprovers(steps: ChainStep[]): ChainStep[] {
  const seen = new Set<string>();
  const out = steps.map((s) => {
    if (s.status === "SKIPPED" || s.receipt || !s.approverId || !CONSENT_SELECTORS.has(s.selector)) return s;
    if (seen.has(s.approverId)) return { ...s, status: "SKIPPED" as StepStatus, skipReason: "Already approved at an earlier step" };
    seen.add(s.approverId);
    return s;
  });
  return activate(out);
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
  HOST_RELEASE: "Host releases it",
  OWNER_RECEIPT: "Owner confirms receipt",
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

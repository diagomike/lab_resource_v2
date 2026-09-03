/**
 * Asking for things the university does not own yet — ported from
 * temp_works/src/lib/purchasing.ts, verbatim.
 *
 * DELIBERATELY NOT a ChangeRequest. Everything in approvals.ts governs a change to a
 * resource that already exists, and stores the exact ChangeInput that will be
 * applied to it. A purchase has no resource to point at — that is the whole point of
 * raising one. The two systems meet at exactly one place, and only there: when goods
 * land in the main store, the store keeper REGISTERS them, and from that moment they
 * are ordinary resources that move by the ordinary transfer scheme.
 *
 * Three separate things, kept separate:
 *   1. A NEED. "We could use another balance." Never becomes a request automatically
 *      — a head reads open needs while writing their own and decides what to carry
 *      forward. A silent auto-conversion would put a department's name on a purchase
 *      nobody senior ever chose to ask for.
 *   2. A PURCHASE REQUEST. The department's formal ask, compiled by the head, which
 *      walks Head → Dean → College Managing Directorate → Academic Vice President →
 *      Procurement Office.
 *   3. A PROCUREMENT PIPELINE. What the purchasing team does afterwards, which is
 *      reporting rather than deciding: order placed, buyer found, on delivery, in
 *      store. Nobody approves these; they are recorded as they happen.
 *
 * `PurchaseStage`/`NeedStatus` are reused from lib/shared rather than redefined —
 * temp_works' own vocabulary is exactly what lib/shared/resources/enums.ts's
 * purchaseStages/needStatuses were ported from.
 */
import type { StepSelector } from "./approvals";
import type { Person } from "./types";
import type { NeedStatus, PurchaseStage, RoleKind } from "@/lib/shared";

/** What procurement reports, in order. Advancing is a record, not a decision. */
export const PIPELINE: PurchaseStage[] = ["ORDER_PLACED", "BUYER_FOUND", "ON_DELIVERY", "IN_STORE"];

export const STAGE_LABEL: Record<PurchaseStage, string> = {
  DRAFT: "Draft",
  APPROVING: "Awaiting approval",
  REVISING: "Sent back for revision",
  ORDER_PLACED: "Order placed on EGP",
  BUYER_FOUND: "Buyer found",
  ON_DELIVERY: "On delivery",
  IN_STORE: "Arrived at the main store",
  CLOSED: "Registered and closed",
  REJECTED: "Rejected",
  CANCELLED: "Withdrawn",
};

export const STAGE_HELP: Record<PurchaseStage, string> = {
  DRAFT: "Only the raising unit can see and change this.",
  APPROVING: "With an approver. Nothing is ordered yet.",
  REVISING: "An approver asked for changes. Edit it and send it up again.",
  ORDER_PLACED: "Procurement has placed the order on the government portal.",
  BUYER_FOUND: "A supplier has been awarded the tender.",
  ON_DELIVERY: "Bought and on its way.",
  IN_STORE: "At the main store, waiting to be registered onto the system.",
  CLOSED: "Registered. The resources now live in the register like any other.",
  REJECTED: "Turned down. The reason is on the request.",
  CANCELLED: "Withdrawn by the unit that raised it.",
};

/** A stage that no longer moves on its own. */
export function isFinished(stage: PurchaseStage): boolean {
  return stage === "CLOSED" || stage === "REJECTED" || stage === "CANCELLED";
}

/**
 * "We could use one of these." Raised by whoever actually feels the shortage. It
 * carries a reason because a head compiling a department request has to be able to
 * defend each line upward, and "someone asked for it" is not a defence.
 */
export interface NeedLine {
  id: string;
  raisedById: string;
  /** The unit that feels the need — where the head who reads it sits. */
  orgNodeId: string;
  name: string;
  qty: number;
  unit?: string;
  /** Optional: what kind of thing, when it is something the register already knows. */
  categoryId?: string;
  reason: string;
  createdAt: string;
  status: NeedStatus;
  /** Set when a head carries it into a request, or declines it, always with a note. */
  handledById?: string;
  handledAt?: string;
  note?: string;
  purchaseId?: string;
}

export interface PurchaseLine {
  id: string;
  name: string;
  qty: number;
  unit?: string;
  categoryId?: string;
  estimatedUnitCost?: number;
  justification?: string;
  /** Which needs this line answers, so a line can be traced back to who felt it. */
  fromNeedIds: string[];
  /** Filled in by the store keeper as goods are registered. */
  receivedQty?: number;
  receivedAt?: string;
  receivedById?: string;
}

export interface PurchaseEvent {
  at: string;
  byId: string;
  stage: PurchaseStage;
  note?: string;
}

export interface PurchaseRequest {
  id: string;
  reference: string;
  /** The department asking. Its head owns the request. */
  orgNodeId: string;
  raisedById: string;
  createdAt: string;
  title: string;
  lines: PurchaseLine[];
  stage: PurchaseStage;
  /** The approval ladder — the same ChainStep the change layer uses. */
  steps: import("./approvals").ChainStep[];
  history: PurchaseEvent[];
  /** The last feedback from an approver who sent it back. */
  feedback?: string;
}

/**
 * The ladder: Department Head → Dean of College → CMD → AVP → Procurement Office.
 * The first two come out of the org chart; the last three are named offices, which
 * is exactly why NODE_OCCUPANT exists — the Managing Directorate, the Vice
 * President and Procurement are not ancestors of any department, so no walk would
 * reach them. The head's own step is skipped automatically when the head is the one
 * raising it, which is the normal case: they compiled it.
 */
export const PURCHASE_LADDER: StepSelector[] = [
  { type: "OWNER_HEAD" },
  { type: "HIERARCHY", stopAtKind: "COLLEGE" },
  { type: "NODE_OCCUPANT", nodeId: "cmd-office" },
  { type: "NODE_OCCUPANT", nodeId: "astu" },
  { type: "NODE_OCCUPANT", nodeId: "proc-office" },
];

// ── Who may do what ──────────────────────────────────────────────────────

const has = (person: Person | undefined, role: RoleKind) => (person?.roles ?? []).includes(role);

/** Anybody attached to a unit can say they need something. */
export function canRaiseNeed(person: Person | undefined): boolean {
  return !!person && !!person.homeOrgNodeId && !has(person, "STUDENT");
}

/** Compiling a department's ask is the head's job, and nobody else's. */
export function canCompile(person: Person | undefined): boolean {
  return has(person, "MANAGER") || has(person, "SYS_ADMIN");
}

/** The purchasing team reports progress; they do not approve it. */
export function canRunPipeline(person: Person | undefined): boolean {
  return has(person, "PROCUREMENT") || has(person, "SYS_ADMIN");
}

/** Booking goods onto the system is the store keeper's job, and theirs alone. */
export function canReceive(person: Person | undefined): boolean {
  return has(person, "STORE_KEEPER") || has(person, "SYS_ADMIN");
}

/** The next thing procurement can report, or null at the end of the pipeline. */
export function nextStage(stage: PurchaseStage): PurchaseStage | null {
  if (stage === "APPROVING") return null;
  const at = PIPELINE.indexOf(stage);
  if (at === -1) return null;
  return PIPELINE[at + 1] ?? null;
}

/** The stage an approved request enters. */
export const FIRST_PIPELINE_STAGE: PurchaseStage = "ORDER_PLACED";

export function isEditable(stage: PurchaseStage): boolean {
  return stage === "DRAFT" || stage === "REVISING";
}

// ── Sums ─────────────────────────────────────────────────────────────────

export function lineTotal(line: PurchaseLine): number | undefined {
  return line.estimatedUnitCost === undefined ? undefined : line.estimatedUnitCost * line.qty;
}

export function requestTotal(request: PurchaseRequest): number | undefined {
  const costed = request.lines.filter((l) => l.estimatedUnitCost !== undefined);
  if (!costed.length) return undefined;
  return costed.reduce((sum, l) => sum + (lineTotal(l) ?? 0), 0);
}

/** How much of a request has actually been booked in. */
export function receivedProgress(request: PurchaseRequest): { received: number; ordered: number; complete: boolean } {
  const ordered = request.lines.reduce((n, l) => n + l.qty, 0);
  const received = request.lines.reduce((n, l) => n + (l.receivedQty ?? 0), 0);
  return { received, ordered, complete: ordered > 0 && received >= ordered };
}

export function emptyLine(id: string): PurchaseLine {
  return { id, name: "", qty: 1, fromNeedIds: [] };
}

/**
 * Units the register offers when somebody is asking for something it does not hold
 * yet. Free text would be the easy choice and the wrong one: "pcs", "Pcs", "pieces"
 * and "PCS" arriving as four different units is how a store's totals stop adding up.
 */
export const PURCHASE_UNITS = [
  "pcs", "Unit", "Set", "Pair", "Pack", "Box", "Carton", "Roll", "Sheet", "Bundle",
  "mg", "g", "kg", "t", "mL", "L", "m³", "mm", "cm", "m", "km", "cm²", "m²",
  "Bag", "Bottle", "Vial", "Tube", "Plate", "Flask",
] as const;

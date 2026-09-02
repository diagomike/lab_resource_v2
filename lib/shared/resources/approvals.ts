/**
 * One idea, and it is the institution's own: THE ORG CHART IS THE APPROVAL ROUTE. There
 * is no "is this an approval office" flag — being a parent in the hierarchy is what
 * makes an office an approver. Policies key off ItemChangeKind; there is deliberately
 * no second operation vocabulary.
 *
 * Two invariants (temp_works' code, not its README — see
 * ~/.claude/plans/wait-i-want-gentle-haven.md §5 for the discrepancy this corrects):
 * a headless office BLOCKS a request (a vacant post holds it, never routes around it),
 * and no matching policy means DENY, never a silent allow.
 */
import { z } from "zod";
import { RoleKindSchema } from "../enums";
import { CountingModeSchema, ItemChangeKindSchema, PolicyOutcomeSchema, RequestStatusSchema, StepSelectorTypeSchema, StepStatusSchema } from "./enums";

// ── Selectors ────────────────────────────────────────────────────────────

const OrgNodeKindForSelector = z.enum(["UNIVERSITY", "COLLEGE", "DEPARTMENT", "OFFICE"]);

export const StepSelector = z.discriminatedUnion("type", [
  /** Walk up the org chart from the owning unit, stopping at this kind inclusive. */
  z.object({ type: z.literal("HIERARCHY"), stopAtKind: OrgNodeKindForSelector }),
  /** A named office — Procurement and Property are not ancestors of anything. */
  z.object({ type: z.literal("NODE_OCCUPANT"), nodeId: z.string() }),
  /** The owning unit's nearest ancestor of a NAMED level, rather than the next step
   *  up — an external request runs this way (VP, then dean, then head) because it
   *  arrives at the institution rather than from inside a department. */
  z.object({ type: z.literal("OWNER_ANCESTOR"), kind: OrgNodeKindForSelector }),
  /** The head of the unit that owns the resource. */
  z.object({ type: z.literal("OWNER_HEAD") }),
  /** The head of the unit receiving it. Transfers only. */
  z.object({ type: z.literal("TARGET_HEAD") }),
  /** Whoever is answerable for the resource today. */
  z.object({ type: z.literal("ITEM_CUSTODIAN") }),
  /** Whoever will be answerable for it once it lands. */
  z.object({ type: z.literal("TARGET_CUSTODIAN") }),
  /** Back to the person who asked: "I have received it." Never skipped. */
  z.object({ type: z.literal("REQUESTER_RECEIPT") }),
]);
export type StepSelector = z.infer<typeof StepSelector>;

export const ObjectSelector = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ANY") }),
  z.object({ type: z.literal("GROUP"), group: z.string() }),
  z.object({ type: z.literal("CATEGORY"), categoryId: z.string() }),
  z.object({ type: z.literal("COUNTING_MODE"), mode: CountingModeSchema }),
]);
export type ObjectSelector = z.infer<typeof ObjectSelector>;

// ── Policies ─────────────────────────────────────────────────────────────

export const ApprovalPolicyDto = z.object({
  id: z.string(),
  name: z.string(),
  operation: ItemChangeKindSchema,
  appliesTo: ObjectSelector,
  /** null = matches every role. */
  actorRole: RoleKindSchema.nullable(),
  outcome: PolicyOutcomeSchema,
  /** CHAIN only. An empty chain is treated as DENY — it routes to nobody. */
  chain: z.array(StepSelector).nullable(),
  enabled: z.boolean(),
});
export type ApprovalPolicyDto = z.infer<typeof ApprovalPolicyDto>;

export const UpsertApprovalPolicyInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  operation: ItemChangeKindSchema,
  appliesTo: ObjectSelector,
  actorRole: RoleKindSchema.nullable(),
  outcome: PolicyOutcomeSchema,
  chain: z.array(StepSelector).optional(),
  enabled: z.boolean().default(true),
});
export type UpsertApprovalPolicyInput = z.infer<typeof UpsertApprovalPolicyInput>;

// ── Requests and their chains ───────────────────────────────────────────

export const ChainStepDto = z.object({
  id: z.string(),
  order: z.number().int(),
  selector: StepSelectorTypeSchema,
  label: z.string(),
  /** The office this step belongs to. Null for a custodian/receipt step. */
  nodeId: z.string().nullable(),
  /** Who may decide it, resolved at build time and re-checked live at decision time.
   *  Null means the post is VACANT, which HOLDS the request rather than skipping it. */
  approverId: z.string().nullable(),
  approverName: z.string().nullable(),
  status: StepStatusSchema,
  skipReason: z.string().nullable(),
  /** A receipt is the requester confirming delivery, not an approval. */
  receipt: z.boolean(),
  decidedById: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type ChainStepDto = z.infer<typeof ChainStepDto>;

/**
 * `payload` is the exact ItemChangeInput a direct edit would carry — see item.ts's own
 * note on this seam. Never rendered directly; the UI reads `summary` instead.
 */
export const ChangeRequestDto = z.object({
  id: z.string(),
  requesterId: z.string(),
  requesterName: z.string(),
  createdAt: z.string(),
  status: RequestStatusSchema,
  steps: z.array(ChainStepDto),
  summary: z.string(),
  note: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolution: z.string().nullable(),
});
export type ChangeRequestDto = z.infer<typeof ChangeRequestDto>;

export const DecideStepInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().optional(),
});
export type DecideStepInput = z.infer<typeof DecideStepInput>;

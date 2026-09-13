/**
 * Procurement. Deliberately separate from ChangeRequest — a purchase has no resource to
 * point at yet, which is the whole point of raising one. The two systems meet at
 * exactly one place: when goods land in the main store, the store keeper registers
 * them (receivePurchaseLine, a later phase), and from that moment they are ordinary
 * Items moving through the ordinary applyChange path.
 *
 * Three separate things, kept separate: a NEED (informal, never auto-converted), a
 * PURCHASE REQUEST (the department's formal ask, walking the org chart itself —
 * owning unit's head, then every ancestor up to the university root, then
 * Procurement — see Track 4's plan for why this is dynamic rather than a fixed
 * named sequence), and the PROCUREMENT PIPELINE (what purchasing reports
 * afterward — recorded, not decided).
 */
import { z } from "zod";
import { NeedStatusSchema, PurchaseStageSchema } from "./enums";
import { ChainStepDto } from "./approvals";

export const NeedLineDto = z.object({
  id: z.string(),
  raisedById: z.string(),
  raisedByName: z.string(),
  orgNodeId: z.string(),
  orgNodeName: z.string(),
  name: z.string(),
  qty: z.number(),
  unit: z.string().nullable(),
  categoryId: z.string().nullable(),
  reason: z.string(),
  createdAt: z.string(),
  status: NeedStatusSchema,
  handledById: z.string().nullable(),
  handledByName: z.string().nullable(),
  handledAt: z.string().nullable(),
  note: z.string().nullable(),
  purchaseLineId: z.string().nullable(),
});
export type NeedLineDto = z.infer<typeof NeedLineDto>;

export const RaiseNeedInput = z.object({
  name: z.string().min(1),
  qty: z.number().min(0.0001),
  unit: z.string().optional(),
  categoryId: z.string().optional(),
  reason: z.string().min(1),
});
export type RaiseNeedInput = z.infer<typeof RaiseNeedInput>;

export const DeclineNeedInput = z.object({
  note: z.string().min(1),
});
export type DeclineNeedInput = z.infer<typeof DeclineNeedInput>;

export const PurchaseLineDto = z.object({
  id: z.string(),
  name: z.string(),
  qty: z.number(),
  unit: z.string().nullable(),
  categoryId: z.string().nullable(),
  estimatedUnitCost: z.number().nullable(),
  justification: z.string().nullable(),
  /** Which needs this line answers, so a line can be traced back to who felt it. */
  fromNeedIds: z.array(z.string()),
  receivedQty: z.number().nullable(),
  receivedAt: z.string().nullable(),
  receivedById: z.string().nullable(),
});
export type PurchaseLineDto = z.infer<typeof PurchaseLineDto>;

export const PurchaseEventDto = z.object({
  at: z.string(),
  byId: z.string(),
  byName: z.string(),
  stage: PurchaseStageSchema,
  note: z.string().nullable(),
});
export type PurchaseEventDto = z.infer<typeof PurchaseEventDto>;

export const PurchaseRequestDto = z.object({
  id: z.string(),
  reference: z.string(),
  orgNodeId: z.string(),
  orgNodeName: z.string(),
  raisedById: z.string(),
  raisedByName: z.string(),
  createdAt: z.string(),
  title: z.string(),
  lines: z.array(PurchaseLineDto),
  stage: PurchaseStageSchema,
  history: z.array(PurchaseEventDto),
  /** The last feedback from an approver who sent it back. */
  feedback: z.string().nullable(),
  /** The chain this request is walking — the owning unit's head, then every
   *  ancestor up to the university root, then the Procurement Office. Empty
   *  outside APPROVING (a request that never left DRAFT, or one already
   *  settled/rejected/revised, has no live chain to show). */
  steps: z.array(ChainStepDto),
});
export type PurchaseRequestDto = z.infer<typeof PurchaseRequestDto>;

const PurchaseLineInput = z.object({
  name: z.string().min(1),
  qty: z.number().min(0.0001),
  unit: z.string().optional(),
  categoryId: z.string().optional(),
  estimatedUnitCost: z.number().min(0).optional(),
  justification: z.string().optional(),
  fromNeedIds: z.array(z.string()).default([]),
});

export const CompilePurchaseInput = z.object({
  title: z.string().min(1),
  orgNodeId: z.string(),
  lines: z.array(PurchaseLineInput).min(1),
});
export type CompilePurchaseInput = z.infer<typeof CompilePurchaseInput>;

export const DecidePurchaseInput = z.object({
  decision: z.enum(["APPROVE", "REJECT", "REVISE"]),
  note: z.string().optional(),
});
export type DecidePurchaseInput = z.infer<typeof DecidePurchaseInput>;

export const AdvancePurchaseInput = z.object({
  note: z.string().optional(),
});
export type AdvancePurchaseInput = z.infer<typeof AdvancePurchaseInput>;

/** The one seam with the register: booking an arrived line in as a real Item, through
 *  the ordinary applyChange createItem path. */
export const ReceivePurchaseLineInput = z.object({
  lineId: z.string(),
  qty: z.number().min(0.0001),
  categoryId: z.string(),
  storeParentId: z.string(),
});
export type ReceivePurchaseLineInput = z.infer<typeof ReceivePurchaseLineInput>;

/** Units the register offers when somebody asks for something it does not hold yet.
 *  Managed rather than free text — "pcs", "Pcs" and "PCS" arriving as three different
 *  units is how a store's totals stop adding up. */
export const PURCHASE_UNITS = [
  "pcs", "Unit", "Set", "Pair", "Pack", "Box", "Carton", "Roll", "Sheet", "Bundle",
  "mg", "g", "kg", "t", "mL", "L", "m³", "mm", "cm", "m", "km", "cm²", "m²",
  "Bag", "Bottle", "Vial", "Tube", "Plate", "Flask",
] as const;

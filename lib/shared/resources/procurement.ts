import { z } from "zod";

/**
 * Procurements (2026-10-02): what the procurement office actually buys — one EGP
 * purchase covering any number of approved purchase requests (or none). See
 * lib/domain/procurement.ts for the rules and lib/server/resources/procurements.ts.
 */

export const ProcurementStageSchema = z.enum(["PREPARING", "PLACED_ON_EGP", "BUYER_FOUND", "ON_DELIVERY", "ARRIVED", "CLOSED", "CANCELLED"]);
export type ProcurementStageDto = z.infer<typeof ProcurementStageSchema>;

export const ProcurementLineDto = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  qty: z.number(),
  unit: z.string().nullable(),
  unitCost: z.number().nullable(),
  spec: z.string().nullable(),
  purchaseLineId: z.string().nullable(),
  /** The request it was asked for in, and how many were asked for there. */
  purchaseReference: z.string().nullable(),
  requestedQty: z.number().nullable(),
  arrivedQty: z.number().nullable(),
});
export type ProcurementLineDto = z.infer<typeof ProcurementLineDto>;

export const ProcurementDto = z.object({
  id: z.string(),
  reference: z.string(),
  title: z.string(),
  egpReference: z.string().nullable(),
  supplier: z.string().nullable(),
  stage: ProcurementStageSchema,
  createdByName: z.string(),
  createdAt: z.string(),
  requests: z.array(z.object({ id: z.string(), reference: z.string(), title: z.string(), orgNodeName: z.string(), raisedByName: z.string() })),
  lines: z.array(ProcurementLineDto),
  events: z.array(z.object({ at: z.string(), byName: z.string(), stage: ProcurementStageSchema, note: z.string().nullable(), lineChanges: z.array(z.string()) })),
  /** Property Administration's import record of what arrived, once made. */
  importRecord: z.object({ id: z.string(), reference: z.string(), status: z.enum(["OPEN", "LOADED", "CANCELLED"]) }).nullable(),
  /** The estimated total of what is bought, when every line has a unit cost. */
  total: z.number().nullable(),
  /** What the viewer may do. */
  can: z.object({ move: z.boolean(), editLines: z.boolean(), addRequests: z.boolean(), cancel: z.boolean() }),
});
export type ProcurementDto = z.infer<typeof ProcurementDto>;

/** An approved request waiting for procurement to buy it. */
export const WaitingRequestDto = z.object({
  id: z.string(),
  reference: z.string(),
  title: z.string(),
  orgNodeName: z.string(),
  raisedByName: z.string(),
  lineCount: z.number().int(),
  approvedAt: z.string(),
});
export type WaitingRequestDto = z.infer<typeof WaitingRequestDto>;

export const ProcurementLineInput = z.object({
  /** An existing line keeps its id; a new one has none. */
  id: z.string().optional(),
  name: z.string().trim().min(1, "Every line needs a name.").max(160),
  categoryId: z.string().nullable().optional(),
  qty: z.number().positive("A quantity must be more than zero."),
  unit: z.string().trim().max(40).nullable().optional(),
  unitCost: z.number().min(0).nullable().optional(),
  spec: z.string().trim().max(2000).nullable().optional(),
  purchaseLineId: z.string().nullable().optional(),
});
export type ProcurementLineInput = z.infer<typeof ProcurementLineInput>;

export const StartProcurementInput = z.object({
  /** None: a standalone EGP purchase. */
  requestIds: z.array(z.string()).max(30).default([]),
  title: z.string().trim().max(200).optional(),
  egpReference: z.string().trim().max(120).optional(),
  supplier: z.string().trim().max(200).optional(),
  /** A standalone purchase lists what it buys; one from requests starts from theirs. */
  lines: z.array(ProcurementLineInput).max(300).optional(),
  note: z.string().trim().max(2000).optional(),
});
export type StartProcurementInput = z.infer<typeof StartProcurementInput>;

export const EditProcurementLinesInput = z.object({
  lines: z.array(ProcurementLineInput).min(1, "Keep at least one line, or cancel the procurement.").max(300),
  reason: z.string().trim().min(3, "Say why: everyone following it reads this.").max(2000),
});
export type EditProcurementLinesInput = z.infer<typeof EditProcurementLinesInput>;

export const MoveProcurementInput = z.object({
  stage: ProcurementStageSchema,
  note: z.string().trim().max(2000).optional(),
  egpReference: z.string().trim().max(120).optional(),
  supplier: z.string().trim().max(200).optional(),
  /** Arriving: how many of each line came (each defaults to what was bought). */
  arrived: z.array(z.object({ lineId: z.string(), qty: z.number().min(0) })).optional(),
});
export type MoveProcurementInput = z.infer<typeof MoveProcurementInput>;

export const AddProcurementRequestsInput = z.object({ requestIds: z.array(z.string()).min(1).max(30) });
export type AddProcurementRequestsInput = z.infer<typeof AddProcurementRequestsInput>;

export const CancelProcurementInput = z.object({ note: z.string().trim().min(3, "Say why it is cancelled.").max(2000) });
export type CancelProcurementInput = z.infer<typeof CancelProcurementInput>;

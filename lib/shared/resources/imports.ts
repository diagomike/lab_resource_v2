import { z } from "zod";

/**
 * Import records (2026-09-28) — how bought goods enter the Main Store. Property
 * Administration records what actually arrived, from an LRMS purchase request at
 * "Arrived at the main store" or standalone for an EGP purchase that never went through
 * LRMS; the store keeper then loads the store from the record, line by line. See
 * lib/server/resources/imports.ts.
 */

export const ImportSourceSchema = z.enum(["PURCHASE_REQUEST", "EGP"]);
export type ImportSource = z.infer<typeof ImportSourceSchema>;

export const ImportStatusSchema = z.enum(["OPEN", "LOADED", "CANCELLED"]);
export type ImportStatus = z.infer<typeof ImportStatusSchema>;

export const ImportLineInput = z.object({
  name: z.string().trim().min(1).max(160),
  categoryId: z.string(),
  qty: z.number().min(0.0001),
  unit: z.string().trim().max(40).optional(),
  /** Model, specification or serial numbers from the delivery documents. */
  spec: z.string().trim().max(2000).optional(),
  /** The purchase-request line this answers — PURCHASE_REQUEST records only. */
  purchaseLineId: z.string().optional(),
});
export type ImportLineInput = z.infer<typeof ImportLineInput>;

export const CreateImportInput = z
  .object({
    source: ImportSourceSchema,
    purchaseRequestId: z.string().optional(),
    egpReference: z.string().trim().max(120).optional(),
    supplier: z.string().trim().max(200).optional(),
    note: z.string().trim().max(2000).optional(),
    lines: z.array(ImportLineInput).min(1).max(200),
  })
  .refine((v) => v.source !== "PURCHASE_REQUEST" || !!v.purchaseRequestId, { message: "Choose the purchase request these goods arrived for.", path: ["purchaseRequestId"] })
  .refine((v) => v.source !== "EGP" || !!v.egpReference, { message: "Give the EGP purchase or contract number.", path: ["egpReference"] });
export type CreateImportInput = z.infer<typeof CreateImportInput>;

export const LoadImportLineInput = z.object({
  lineId: z.string(),
  qty: z.number().min(0.0001),
  /** Where in the store it goes — the Main Store itself, or a shelf inside it. */
  storeParentId: z.string(),
});
export type LoadImportLineInput = z.infer<typeof LoadImportLineInput>;

export const CancelImportInput = z.object({ note: z.string().trim().min(1).max(2000) });
export type CancelImportInput = z.infer<typeof CancelImportInput>;

export const ImportLineDto = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  countingMode: z.enum(["SERIALIZED", "BULK"]),
  qty: z.number(),
  unit: z.string().nullable(),
  spec: z.string().nullable(),
  purchaseLineId: z.string().nullable(),
  loadedQty: z.number(),
  loadedAt: z.string().nullable(),
  loadedByName: z.string().nullable(),
});
export type ImportLineDto = z.infer<typeof ImportLineDto>;

export const ImportRecordDto = z.object({
  id: z.string(),
  reference: z.string(),
  source: ImportSourceSchema,
  purchaseRequestId: z.string().nullable(),
  purchaseReference: z.string().nullable(),
  purchaseOrgNodeName: z.string().nullable(),
  egpReference: z.string().nullable(),
  supplier: z.string().nullable(),
  note: z.string().nullable(),
  status: ImportStatusSchema,
  createdByName: z.string(),
  createdAt: z.string(),
  lines: z.array(ImportLineDto),
});
export type ImportRecordDto = z.infer<typeof ImportRecordDto>;

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
import { NeedKindSchema, NeedPrioritySchema, NeedStatusSchema, PurchaseStageSchema } from "./enums";
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
  categoryName: z.string().nullable(),
  /** The lab it is for (custodians raise needs for the labs they run). */
  labItemId: z.string().nullable(),
  labName: z.string().nullable(),
  priority: NeedPrioritySchema,
  kind: NeedKindSchema,
  /** For a replacement: the items that broke or went missing. */
  replacesItems: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Model, specification, a supplier's quote reference. */
  spec: z.string().nullable(),
  reason: z.string(),
  createdAt: z.string(),
  status: NeedStatusSchema,
  handledById: z.string().nullable(),
  handledByName: z.string().nullable(),
  handledAt: z.string().nullable(),
  note: z.string().nullable(),
  purchaseLineId: z.string().nullable(),
  /** The request this need was carried into, so whoever raised it can follow it. */
  purchaseReference: z.string().nullable(),
  purchaseStage: PurchaseStageSchema.nullable(),
});
export type NeedLineDto = z.infer<typeof NeedLineDto>;

export const RaiseNeedInput = z.object({
  /** The lab it is for — one the custodian runs. */
  labItemId: z.string().min(1),
  name: z.string().trim().min(1, "Say what is needed").max(160),
  qty: z.number().min(0.0001),
  unit: z.string().optional(),
  categoryId: z.string().optional(),
  priority: NeedPrioritySchema.default("IMPORTANT"),
  kind: NeedKindSchema.default("NEW"),
  /** REPLACEMENT only: the broken or lost items in that lab, all of one kind. */
  replacesItemIds: z.array(z.string()).max(500).default([]),
  spec: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(1, "Say why the lab needs it").max(1000),
});
export type RaiseNeedInput = z.infer<typeof RaiseNeedInput>;
/** What a caller may send — the defaults (priority, kind, no replaced items) filled in later. */
export type RaiseNeedFields = z.input<typeof RaiseNeedInput>;

export const DeclineNeedInput = z.object({
  note: z.string().min(1),
});
export type DeclineNeedInput = z.infer<typeof DeclineNeedInput>;

/** Things of one kind in one lab that broke or went missing, with no replacement asked
 *  for yet — what the custodian can ask for in one step, and the head can see while
 *  building a request. */
export const ReplacementSuggestionDto = z.object({
  labItemId: z.string(),
  labName: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  items: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(["BROKEN", "LOST"]) })),
});
export type ReplacementSuggestionDto = z.infer<typeof ReplacementSuggestionDto>;

/** `note` is optional for the raiser's own withdrawal (while APPROVING/REVISING) but
 *  required once procurement is cancelling an order already placed (F-047 of the
 *  2026-09-15 campaign) — enforced server-side, not by this schema, since which one
 *  applies depends on who's asking and the request's own stage. */
export const CancelPurchaseRequestInput = z
  .object({
    note: z.string().min(1).optional(),
    attachmentIds: z.array(z.string()).max(5).default([]),
  })
  .default({}); // the raiser's own withdrawal sends no body at all
export type CancelPurchaseRequestInput = z.infer<typeof CancelPurchaseRequestInput>;

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

/**
 * Documents on a purchase request — the minutes and stamped letters of authority that
 * go with a submission, and the letter an approver cites when approving, rejecting or
 * sending it back. One set of numbers for the browser (which checks before uploading)
 * and the server (which enforces them):
 *
 *  - `fileBytes`: 4 MB a file. The hosting platform refuses a request body over 4.5 MB
 *    before the app sees it. Photos and scans are shrunk in the browser first, so
 *    only a PDF or workbook can really reach it; a letter scanned at 150–200 dpi is
 *    well under 1 MB a page.
 *  - `perAction`: 5 files sent with one submission or decision.
 *  - `perRequest` / `requestBytes`: 20 files and 25 MB across the request's whole life.
 *  - `stagedFiles` / `stagedBytes`: what one person may have uploaded but not yet sent
 *    (a form they closed without sending); unsent files are removed after 12 hours.
 */
export const ATTACHMENT_LIMITS = {
  fileBytes: 4 * 1024 * 1024,
  perAction: 5,
  perRequest: 20,
  requestBytes: 25 * 1024 * 1024,
  stagedFiles: 10,
  stagedBytes: 20 * 1024 * 1024,
} as const;

/** What the file picker offers; the server decides from the bytes, not this list. */
export const ATTACHMENT_ACCEPT = ".pdf,.xlsx,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

export const AttachmentKindSchema = z.enum(["PDF", "IMAGE", "SPREADSHEET"]);

export const PurchaseAttachmentDto = z.object({
  id: z.string(),
  fileName: z.string(),
  kind: AttachmentKindSchema,
  contentType: z.string(),
  byteSize: z.number(),
  uploadedById: z.string(),
  uploadedByName: z.string(),
  createdAt: z.string(),
  /** Opens (PDF, image) or downloads (workbook) the file, after the same read check as the request. */
  url: z.string(),
});
export type PurchaseAttachmentDto = z.infer<typeof PurchaseAttachmentDto>;

export const PurchaseEventDto = z.object({
  at: z.string(),
  byId: z.string(),
  byName: z.string(),
  stage: PurchaseStageSchema,
  note: z.string().nullable(),
  /** Documents sent with this action. */
  attachments: z.array(PurchaseAttachmentDto),
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
  /** The procurement buying it (the live one, else the latest), once procurement started it. */
  procurement: z.object({ id: z.string(), reference: z.string(), stage: z.string() }).nullable(),
});
export type PurchaseRequestDto = z.infer<typeof PurchaseRequestDto>;

/** What an approver reads before deciding a purchase: for every line, its kind and
 *  the lab needs it answers — who raised them, for which lab, how urgent, and why. */
export const PurchaseDetailsDto = z.object({
  lines: z.array(z.object({ lineId: z.string(), categoryName: z.string().nullable(), needs: z.array(NeedLineDto) })),
});
export type PurchaseDetailsDto = z.infer<typeof PurchaseDetailsDto>;

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
  /** Staged uploads (POST /api/resources/purchase-attachments) sent with this submission. */
  attachmentIds: z.array(z.string()).max(5).default([]),
});
export type CompilePurchaseInput = z.infer<typeof CompilePurchaseInput>;

export const DecidePurchaseInput = z.object({
  decision: z.enum(["APPROVE", "REJECT", "REVISE"]),
  note: z.string().optional(),
  /** A letter or minutes the approver cites; kept on the request's history. */
  attachmentIds: z.array(z.string()).max(5).default([]),
  /** Procurement starting the purchase: add it to this procurement (still being
   *  prepared) instead of starting a new one. */
  procurementId: z.string().optional(),
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

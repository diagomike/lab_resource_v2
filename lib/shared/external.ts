/**
 * External booking requests — Track 7 of
 * ~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md.
 *
 * Two audiences share these contracts: the public (no account — the catalog, the request
 * form, a tracking page reached by an emailed link) and staff (the AVP, department
 * heads, custodians). Public shapes carry counts and the requester's own request only;
 * nothing here ever exposes the item tree, a location or a person outside the request.
 *
 * Money is integer santim (1 ETB = 100 santim), never a float.
 */
import { z } from "zod";
import { BookingModeSchema } from "./resources/enums";
import { ReservationDto } from "./scheduling";

export const externalRequestStatuses = ["SUBMITTED", "UNDER_REVIEW", "QUOTED", "PAYMENT_SUBMITTED", "PAID", "SCHEDULED", "DECLINED", "CANCELLED", "EXPIRED"] as const;
export const ExternalRequestStatusSchema = z.enum(externalRequestStatuses);
export type ExternalRequestStatus = (typeof externalRequestStatuses)[number];

export const externalAssignmentStatuses = ["PENDING", "ACCEPTED", "DECLINED"] as const;
export const ExternalAssignmentStatusSchema = z.enum(externalAssignmentStatuses);
export type ExternalAssignmentStatus = (typeof externalAssignmentStatuses)[number];

const CivilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-14.");
const CivilTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00.");

// ── Public catalog ───────────────────────────────────────────────────────

export const PublicCatalogDto = z.object({
  groups: z.array(
    z.object({
      name: z.string(),
      categories: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          iconKey: z.string(),
          bookingMode: BookingModeSchema,
          /** Working units (or, for stock, the working quantity) across the university. */
          count: z.number(),
          unit: z.string().nullable(),
        }),
      ),
    }),
  ),
  generatedAt: z.string(),
});
export type PublicCatalogDto = z.infer<typeof PublicCatalogDto>;

// ── Public request form ──────────────────────────────────────────────────

export const ExternalRequestLineInput = z.object({
  description: z.string().trim().min(2, "Describe what you need.").max(300),
  quantity: z.number().int().min(1).max(100_000),
  /** Optional pointer to a catalog category the line relates to. */
  categoryId: z.string().optional(),
});
export type ExternalRequestLineInput = z.infer<typeof ExternalRequestLineInput>;

export const ExternalWindowInput = z.object({ date: CivilDate, start: CivilTime, end: CivilTime });
export type ExternalWindowInput = z.infer<typeof ExternalWindowInput>;

/** Sent as the `payload` field of a multipart form, alongside the `letter` PDF. */
export const SubmitExternalRequestInput = z.object({
  organizationName: z.string().trim().min(2, "Name your institution or company.").max(200),
  contactName: z.string().trim().min(2, "Give a contact person.").max(120),
  contactEmail: z.string().trim().email("Give a valid email address.").max(200),
  contactPhone: z.string().trim().min(6, "Give a phone number.").max(30),
  purpose: z.string().trim().min(10, "Say what the workshop or training is.").max(3000),
  windows: z.array(ExternalWindowInput).min(1, "Add at least one date.").max(10),
  lines: z.array(ExternalRequestLineInput).min(1, "List at least one thing you need.").max(30),
  /** Honeypot — a real person never fills this in. */
  website: z.string().optional(),
});
export type SubmitExternalRequestInput = z.infer<typeof SubmitExternalRequestInput>;

export const SubmitExternalRequestResultDto = z.object({
  reference: z.string(),
  /** The raw tracking token — returned once, here and in the confirmation email. */
  trackingToken: z.string(),
});
export type SubmitExternalRequestResultDto = z.infer<typeof SubmitExternalRequestResultDto>;

const WindowDto = z.object({ date: z.string(), start: z.string(), end: z.string() });
const LineDto = z.object({ description: z.string(), quantity: z.number(), categoryName: z.string().nullable() });

export const BankDetailsDto = z.object({ bankName: z.string(), accountName: z.string(), accountNumber: z.string() });
export type BankDetailsDto = z.infer<typeof BankDetailsDto>;

// ── Payments (Track 8) ───────────────────────────────────────────────────

export const paymentProviders = ["CBE", "TELEBIRR", "DASHEN", "ABYSSINIA", "CBEBIRR"] as const;
export const PaymentProviderSchema = z.enum(paymentProviders);
export type PaymentProvider = (typeof paymentProviders)[number];

export const paymentVerificationStatuses = ["VERIFIED", "REJECTED", "PENDING_REVIEW", "MANUAL_VERIFIED", "MANUAL_REJECTED"] as const;
export const PaymentVerificationStatusSchema = z.enum(paymentVerificationStatuses);
export type PaymentVerificationStatus = (typeof paymentVerificationStatuses)[number];

/** The requester confirming a payment from their tracking page. `manualReview` skips the
 *  automatic check and asks a person, stating the amount paid. */
export const SubmitPaymentInput = z.object({
  provider: PaymentProviderSchema,
  reference: z.string().trim().min(4, "Give the transaction reference from your receipt.").max(60),
  accountSuffix: z.string().trim().regex(/^\d{5,8}$/, "Give the last digits of the account you paid from.").optional(),
  phoneNumber: z.string().trim().regex(/^2519\d{8}$/, "Give the phone number as 2519XXXXXXXX.").optional(),
  manualReview: z.boolean().optional(),
  amountSantim: z.number().int().min(1).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type SubmitPaymentInput = z.infer<typeof SubmitPaymentInput>;

export const ReviewPaymentInput = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  /** Approving: the amount actually received, when it differs from what was claimed. */
  amountSantim: z.number().int().min(1).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type ReviewPaymentInput = z.infer<typeof ReviewPaymentInput>;

const ProviderOptionDto = z.object({
  id: PaymentProviderSchema,
  label: z.string(),
  referenceLabel: z.string(),
  extra: z.union([z.null(), z.object({ kind: z.literal("SUFFIX"), digits: z.number().int(), label: z.string() }), z.object({ kind: z.literal("PHONE"), label: z.string() })]),
});

export const PublicPaymentDto = z.object({
  provider: PaymentProviderSchema,
  reference: z.string(),
  status: PaymentVerificationStatusSchema,
  amountSantim: z.number().int().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type PublicPaymentDto = z.infer<typeof PublicPaymentDto>;

/** What the requester sees on their tracking page. */
export const PublicTrackingDto = z.object({
  reference: z.string(),
  status: ExternalRequestStatusSchema,
  organizationName: z.string(),
  contactName: z.string(),
  createdAt: z.string(),
  purpose: z.string(),
  windows: z.array(WindowDto),
  lines: z.array(LineDto),
  quote: z
    .object({
      amountSantim: z.number().int(),
      note: z.string().nullable(),
      sheetUrls: z.array(z.string()),
      paymentDeadline: z.string().nullable(),
      bank: BankDetailsDto.nullable(),
    })
    .nullable(),
  timeline: z.array(z.object({ at: z.string(), label: z.string(), note: z.string().nullable() })),
  closingNote: z.string().nullable(),
  canCancel: z.boolean(),
  /** Present once quoted. `canSubmit` — still payable, before the deadline. */
  payment: z
    .object({
      providers: z.array(ProviderOptionDto),
      paidSantim: z.number().int(),
      pendingCount: z.number().int(),
      canSubmit: z.boolean(),
      attempts: z.array(PublicPaymentDto),
    })
    .nullable(),
});
export type PublicTrackingDto = z.infer<typeof PublicTrackingDto>;

export const SubmitPaymentResultDto = z.object({
  outcome: z.enum(["VERIFIED", "REJECTED", "PENDING_REVIEW"]),
  reason: z.string().nullable(),
  /** The verifier couldn't be reached — nothing was decided about the receipt itself. */
  unavailable: z.boolean(),
  tracking: PublicTrackingDto,
});
export type SubmitPaymentResultDto = z.infer<typeof SubmitPaymentResultDto>;

// ── Staff workflow ───────────────────────────────────────────────────────

export const ForwardExternalRequestInput = z.object({
  orgNodeIds: z.array(z.string()).min(1, "Choose at least one department."),
  note: z.string().trim().max(2000).optional(),
});
export type ForwardExternalRequestInput = z.infer<typeof ForwardExternalRequestInput>;

export const DecideAssignmentInput = z.object({
  decision: z.enum(["ACCEPT", "DECLINE"]),
  sheetUrl: z.string().trim().url("Paste the full link to the pricing sheet.").optional(),
  amountSantim: z.number().int().min(0).optional(),
  noCalendarNeeded: z.boolean().optional(),
  note: z.string().trim().max(2000).optional(),
});
export type DecideAssignmentInput = z.infer<typeof DecideAssignmentInput>;

export const SendQuoteInput = z.object({
  amountSantim: z.number().int().min(1, "A quote must be more than zero."),
  paymentDeadline: CivilDate,
  note: z.string().trim().max(2000).optional(),
});
export type SendQuoteInput = z.infer<typeof SendQuoteInput>;

export const CloseExternalRequestInput = z.object({ note: z.string().trim().min(3, "Say why.").max(2000) });
export type CloseExternalRequestInput = z.infer<typeof CloseExternalRequestInput>;

export const PlaceHoldInput = z.object({
  itemIds: z.array(z.string()).min(1).max(100),
  date: CivilDate,
  start: CivilTime,
  end: CivilTime,
});
export type PlaceHoldInput = z.infer<typeof PlaceHoldInput>;

export const ExtendHoldsInput = z.object({ until: CivilDate });
export type ExtendHoldsInput = z.infer<typeof ExtendHoldsInput>;

export const ExternalAssignmentDto = z.object({
  id: z.string(),
  orgNodeId: z.string(),
  orgNodeName: z.string(),
  headName: z.string().nullable(),
  status: ExternalAssignmentStatusSchema,
  sheetUrl: z.string().nullable(),
  amountSantim: z.number().int().nullable(),
  noCalendarNeeded: z.boolean(),
  note: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  holdCount: z.number().int(),
  canDecide: z.boolean(),
});
export type ExternalAssignmentDto = z.infer<typeof ExternalAssignmentDto>;

export const ExternalRequestSummaryDto = z.object({
  id: z.string(),
  reference: z.string(),
  status: ExternalRequestStatusSchema,
  organizationName: z.string(),
  createdAt: z.string(),
  firstWindow: WindowDto.nullable(),
  windowCount: z.number().int(),
  assignmentCount: z.number().int(),
  acceptedCount: z.number().int(),
  /** Why this row is in the viewer's list. */
  role: z.enum(["AVP", "HEAD", "CUSTODIAN"]),
});
export type ExternalRequestSummaryDto = z.infer<typeof ExternalRequestSummaryDto>;

export const ExternalRequestDto = z.object({
  id: z.string(),
  reference: z.string(),
  status: ExternalRequestStatusSchema,
  organizationName: z.string(),
  contactName: z.string(),
  contactEmail: z.string(),
  contactPhone: z.string(),
  purpose: z.string(),
  createdAt: z.string(),
  windows: z.array(WindowDto),
  lines: z.array(LineDto),
  letter: z.object({ fileName: z.string(), byteSize: z.number().int(), url: z.string() }),
  quoteAmountSantim: z.number().int().nullable(),
  quoteNote: z.string().nullable(),
  quoteSentAt: z.string().nullable(),
  paymentDeadline: z.string().nullable(),
  closingNote: z.string().nullable(),
  assignments: z.array(ExternalAssignmentDto),
  holds: z.array(ReservationDto),
  events: z.array(z.object({ at: z.string(), actorLabel: z.string(), kind: z.string(), note: z.string().nullable() })),
  /** Departments the AVP may forward to. Empty for anyone else. */
  departments: z.array(z.object({ id: z.string(), name: z.string(), headName: z.string().nullable() })),
  /** Rooms the viewer keeps that belong to an assigned department — where they may place holds. */
  holdRooms: z.array(z.object({ id: z.string(), name: z.string(), equipment: z.array(z.object({ id: z.string(), name: z.string(), place: z.string().optional() })) })),
  payments: z.array(
    z.object({
      id: z.string(),
      provider: PaymentProviderSchema,
      reference: z.string(),
      status: PaymentVerificationStatusSchema,
      amountSantim: z.number().int().nullable(),
      payerName: z.string().nullable(),
      receiverName: z.string().nullable(),
      receiverAccount: z.string().nullable(),
      paidAt: z.string().nullable(),
      reason: z.string().nullable(),
      requesterNote: z.string().nullable(),
      reviewedByName: z.string().nullable(),
      createdAt: z.string(),
      canReview: z.boolean(),
    }),
  ),
  /** Verified (automatically or by hand) so far. */
  paidSantim: z.number().int(),
  can: z.object({ forward: z.boolean(), quote: z.boolean(), close: z.boolean(), placeHold: z.boolean(), extendHolds: z.boolean(), confirm: z.boolean() }),
});
export type ExternalRequestDto = z.infer<typeof ExternalRequestDto>;

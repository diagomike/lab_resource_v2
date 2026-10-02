/**
 * External booking requests — Track 7, reworked 2026-09-28 to the university's own line
 * of communication (AVP → Dean → Head → custodians, and back up).
 *
 * Two audiences share these contracts: outside requesters (the public catalog, then an
 * EXTERNAL account: the request form and their own requests) and staff (the AVP, deans,
 * heads, custodians). Requester shapes carry counts and their own request only; nothing
 * here ever exposes the item tree or a person outside the request — the contact persons
 * a department names are shown to the requester only once the AVP confirms payment.
 *
 * Money is integer santim (1 ETB = 100 santim), never a float.
 */
import { z } from "zod";
import { BookingModeSchema } from "./resources/enums";
import { ReservationDto } from "./scheduling";

export const externalRequestStatuses = ["SUBMITTED", "UNDER_REVIEW", "QUOTED", "PAYMENT_SUBMITTED", "PAID", "SCHEDULED", "DECLINED", "CANCELLED", "EXPIRED"] as const;
export const ExternalRequestStatusSchema = z.enum(externalRequestStatuses);
export type ExternalRequestStatus = (typeof externalRequestStatuses)[number];

export const externalAssignmentStatuses = ["PENDING", "ACCEPTED", "DECLINED", "FORWARDED", "SUBMITTED", "APPROVED", "RETURNED"] as const;
export const ExternalAssignmentStatusSchema = z.enum(externalAssignmentStatuses);
export type ExternalAssignmentStatus = (typeof externalAssignmentStatuses)[number];

export const ExternalRequestKindSchema = z.enum(["FACILITY", "SAMPLE_ANALYSIS"]);
export type ExternalRequestKind = z.infer<typeof ExternalRequestKindSchema>;

export const ExternalTaskStatusSchema = z.enum(["PENDING", "DONE", "DECLINED"]);
export type ExternalTaskStatus = z.infer<typeof ExternalTaskStatusSchema>;

// ── Accounts for outside requesters ──────────────────────────────────────

export const ExternalSignupInput = z.object({
  organisation: z.string().trim().min(2, "Name your institution or company.").max(200),
  name: z.string().trim().min(2, "Give your name.").max(120),
  email: z.string().trim().email("Give a valid email address.").max(200),
  phone: z.string().trim().min(6, "Give a phone number.").max(30),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  /** Honeypot — a real person never fills this in. */
  website: z.string().optional(),
});
export type ExternalSignupInput = z.infer<typeof ExternalSignupInput>;

export const VerifyEmailInput = z.object({ token: z.string().min(20) });
export type VerifyEmailInput = z.infer<typeof VerifyEmailInput>;

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

export const SampleAnalysisInput = z.object({
  /** The kind of machine, from the public catalog (an EQUIPMENT category). */
  categoryId: z.string().optional(),
  sampleCount: z.number().int().min(1).max(10_000),
  analysis: z.string().trim().min(3, "Say what analysis you need.").max(2000),
});
export type SampleAnalysisInput = z.infer<typeof SampleAnalysisInput>;

/** Sent as the `payload` field of a multipart form, alongside the `letter` PDF. */
export const SubmitExternalRequestInput = z.object({
  kind: ExternalRequestKindSchema.default("FACILITY"),
  sample: SampleAnalysisInput.optional(),
  organizationName: z.string().trim().min(2, "Name your institution or company.").max(200),
  contactName: z.string().trim().min(2, "Give a contact person.").max(120),
  contactEmail: z.string().trim().email("Give a valid email address.").max(200),
  contactPhone: z.string().trim().min(6, "Give a phone number.").max(30),
  purpose: z.string().trim().min(10, "Say what the workshop or training is.").max(3000),
  windows: z.array(ExternalWindowInput).min(1, "Add at least one date.").max(10),
  // At least one for a FACILITY request (checked by the service); a sample analysis may list none.
  lines: z.array(ExternalRequestLineInput).max(30),
  /** Honeypot — a real person never fills this in. */
  website: z.string().optional(),
});
export type SubmitExternalRequestInput = z.infer<typeof SubmitExternalRequestInput>;

export const SubmitExternalRequestResultDto = z.object({
  id: z.string(),
  reference: z.string(),
});
export type SubmitExternalRequestResultDto = z.infer<typeof SubmitExternalRequestResultDto>;

const WindowDto = z.object({ date: z.string(), start: z.string(), end: z.string() });
const SampleDto = z.object({ sampleCount: z.number().int(), analysis: z.string(), categoryName: z.string().nullable() });

/** A contact person a department names for the requester. */
export const ExternalContactDto = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().email().max(200).optional(),
});
export type ExternalContactDto = z.infer<typeof ExternalContactDto>;
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
  /** The bank's own receipt page, so the AVP's office can open it in one click. */
  receiptLink: z
    .string()
    .trim()
    .max(500)
    .regex(/^https:\/\/\S+$/, "Paste the full receipt link from your bank, starting with https://")
    .optional()
    .or(z.literal("").transform(() => undefined)),
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

/** What the requester sees of their own request, signed in to the portal. */
export const PublicTrackingDto = z.object({
  id: z.string(),
  reference: z.string(),
  status: ExternalRequestStatusSchema,
  kind: ExternalRequestKindSchema,
  sample: SampleDto.nullable(),
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
      /** Each department's part of the total. */
      breakdown: z.array(z.object({ departmentName: z.string(), amountSantim: z.number().int(), sheetUrl: z.string().nullable() })),
      paymentDeadline: z.string().nullable(),
      bank: BankDetailsDto.nullable(),
    })
    .nullable(),
  timeline: z.array(z.object({ at: z.string(), label: z.string(), note: z.string().nullable() })),
  closingNote: z.string().nullable(),
  canCancel: z.boolean(),
  /** The rooms or machines held (then booked) for them, and when. */
  bookings: z.array(z.object({ place: z.string(), date: z.string(), start: z.string(), end: z.string(), confirmed: z.boolean() })),
  /** Once the AVP has confirmed payment: who to call, per department. Empty before. */
  contacts: z.array(z.object({ departmentName: z.string(), people: z.array(ExternalContactDto) })),
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

export const RequesterRequestSummaryDto = z.object({
  id: z.string(),
  reference: z.string(),
  status: ExternalRequestStatusSchema,
  kind: ExternalRequestKindSchema,
  createdAt: z.string(),
  purpose: z.string(),
  firstWindow: WindowDto.nullable(),
});
export type RequesterRequestSummaryDto = z.infer<typeof RequesterRequestSummaryDto>;

// ── Staff workflow ───────────────────────────────────────────────────────

/** The AVP forwarding to colleges, or a dean to departments of their college. */
export const ForwardExternalRequestInput = z.object({
  orgNodeIds: z.array(z.string()).min(1, "Choose at least one unit."),
  note: z.string().trim().max(2000).optional(),
});
export type ForwardExternalRequestInput = z.infer<typeof ForwardExternalRequestInput>;

/** A head asking custodians to hold rooms or machines. */
export const AssignCustodiansInput = z.object({
  tasks: z.array(z.object({ custodianId: z.string(), want: z.string().trim().min(2, "Say what they should hold.").max(300) })).min(1).max(30),
  note: z.string().trim().max(2000).optional(),
});
export type AssignCustodiansInput = z.infer<typeof AssignCustodiansInput>;

/** A custodian reporting back: held what was asked (DONE), or can't (DECLINED). */
export const FinishTaskInput = z.object({ outcome: z.enum(["DONE", "DECLINED"]), note: z.string().trim().max(2000).optional() });
export type FinishTaskInput = z.infer<typeof FinishTaskInput>;

/** A head sending the department's answer up to the dean. */
export const SubmitDepartmentInput = z.object({
  sheetUrl: z.string().trim().url("Paste the full link to the cost breakdown."),
  amountSantim: z.number().int().min(0),
  contacts: z.array(ExternalContactDto).min(1, "Name at least one contact person for the requester.").max(10),
  /** Answering with nothing held on a calendar needs this said out loud (e.g. consumables only). */
  noCalendarNeeded: z.boolean().optional(),
  note: z.string().trim().max(2000).optional(),
});
export type SubmitDepartmentInput = z.infer<typeof SubmitDepartmentInput>;

/** A dean on a department's answer, or the AVP on a college's. */
export const ReviewAssignmentInput = z.object({ decision: z.enum(["APPROVE", "RETURN"]), note: z.string().trim().max(2000).optional() });
export type ReviewAssignmentInput = z.infer<typeof ReviewAssignmentInput>;

/** A dean sending the college's answer up to the AVP. */
export const SubmitCollegeInput = z.object({ note: z.string().trim().max(2000).optional() });
export type SubmitCollegeInput = z.infer<typeof SubmitCollegeInput>;

/** A dean or head declining their unit's part. */
export const DeclineAssignmentInput = z.object({ note: z.string().trim().min(3, "Say why.").max(2000) });
export type DeclineAssignmentInput = z.infer<typeof DeclineAssignmentInput>;

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

export const ExternalTaskDto = z.object({
  id: z.string(),
  custodianId: z.string(),
  custodianName: z.string(),
  want: z.string(),
  status: ExternalTaskStatusSchema,
  note: z.string().nullable(),
  holdCount: z.number().int(),
  /** The viewer is this task's custodian and may still report on it. */
  mine: z.boolean(),
});
export type ExternalTaskDto = z.infer<typeof ExternalTaskDto>;

export const ExternalAssignmentDto = z.object({
  id: z.string(),
  level: z.enum(["COLLEGE", "DEPARTMENT"]),
  parentId: z.string().nullable(),
  orgNodeId: z.string(),
  orgNodeName: z.string(),
  /** The dean or head. */
  headName: z.string().nullable(),
  status: ExternalAssignmentStatusSchema,
  sheetUrl: z.string().nullable(),
  amountSantim: z.number().int().nullable(),
  noCalendarNeeded: z.boolean(),
  contacts: z.array(ExternalContactDto),
  note: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  holdCount: z.number().int(),
  tasks: z.array(ExternalTaskDto),
  /** What the viewer may do on this unit's part. */
  can: z.object({
    forward: z.boolean(),
    assign: z.boolean(),
    submit: z.boolean(),
    review: z.boolean(),
    decline: z.boolean(),
  }),
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
  kind: ExternalRequestKindSchema,
  /** Why this row is in the viewer's list. */
  role: z.enum(["AVP", "DEAN", "HEAD", "CUSTODIAN"]),
  /** Something here is waiting on the viewer. */
  waitingOnMe: z.boolean(),
});
export type ExternalRequestSummaryDto = z.infer<typeof ExternalRequestSummaryDto>;

export const ExternalRequestDto = z.object({
  id: z.string(),
  reference: z.string(),
  status: ExternalRequestStatusSchema,
  kind: ExternalRequestKindSchema,
  sample: SampleDto.nullable(),
  role: z.enum(["AVP", "DEAN", "HEAD", "CUSTODIAN"]),
  contactsRevealedAt: z.string().nullable(),
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
  /** Units the viewer may forward to: colleges for the AVP, a dean's own departments. */
  forwardTargets: z.array(z.object({ id: z.string(), name: z.string(), headName: z.string().nullable(), parentAssignmentId: z.string().nullable() })),
  /** Custodians a head may ask, per department assignment they head. */
  custodians: z.array(z.object({ assignmentId: z.string(), id: z.string(), name: z.string() })),
  /** The sum of the departments' approved amounts — the quote's starting point. */
  suggestedQuoteSantim: z.number().int().nullable(),
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
      /** The bank's own receipt page, when the verifier's response gave one — for the
       *  AVP's office to check by hand before confirming the payment. */
      receiptUrl: z.string().nullable(),
      /** The link the requester pasted to their receipt. */
      receiptLink: z.string().nullable(),
    }),
  ),
  /** Where the university is paid, per accepted provider: what to check a receipt
   *  against. */
  payTo: z.array(z.object({ provider: PaymentProviderSchema, label: z.string(), account: z.string().nullable(), name: z.string().nullable() })),
  /** Verified (automatically or by hand) so far. */
  paidSantim: z.number().int(),
  can: z.object({ forward: z.boolean(), quote: z.boolean(), close: z.boolean(), placeHold: z.boolean(), extendHolds: z.boolean(), confirm: z.boolean() }),
});
export type ExternalRequestDto = z.infer<typeof ExternalRequestDto>;

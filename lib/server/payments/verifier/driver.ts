import "server-only";
import type { PaymentProviderId } from "@/lib/domain/payment-receipt";

/**
 * Track 8 — the one seam every payment check passes through
 * (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md).
 *
 * A driver asks someone who can read the bank's own receipt — in production the
 * self-hosted verifier-api (`http-driver.ts`), in tests and local dev `fake-driver.ts` —
 * and hands back what the receipt says, normalised. It judges nothing: whether the
 * receipt paid the university, enough, in time, is `payments/verify.ts`'s job.
 */

export interface VerifyQuery {
  provider: PaymentProviderId;
  /** Transaction reference, or CBE Birr's receipt number. */
  reference: string;
  /** CBE (8 digits) and Bank of Abyssinia (5 digits). */
  accountSuffix?: string;
  /** CBE Birr, as 2519XXXXXXXX. */
  phoneNumber?: string;
}

export interface Receipt {
  reference: string;
  payerName: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
  /** The amount credited to the receiver, as the receipt states it (not yet parsed). */
  amount: unknown;
  /** The payment date, as the receipt states it (not yet parsed). */
  date: unknown;
  /** The receipt's own status line, when the bank gives one. */
  status: unknown;
  /** The verifier's response as received, kept for audit. */
  raw: unknown;
}

export type VerifyResult =
  | { ok: true; receipt: Receipt }
  /** `unavailable` — the verifier or the bank could not be reached; nothing was decided
   *  about the receipt itself, so manual review is the honest next step. */
  | { ok: false; reason: string; unavailable: boolean; raw?: unknown };

export interface VerifierDriver {
  verify(query: VerifyQuery): Promise<VerifyResult>;
}

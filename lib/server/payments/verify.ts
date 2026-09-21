import "server-only";
import { Prisma, type ExternalRequestStatus } from "@prisma/client";
import type { ExternalRequestDto, ReviewPaymentInput, SubmitPaymentInput, SubmitPaymentResultDto } from "@/lib/shared";
import { findClashes } from "@/lib/domain/availability";
import { instantToCivil } from "@/lib/domain/civil-time";
import { PROVIDER_INPUT, paidAfter, parseAmountToSantim, parseReceiptTime, receiverMatches, statusSaysPaid } from "@/lib/domain/payment-receipt";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { expireHolds, lineageRows, loadClaims, lockTree, rootOf, subtreeRows } from "../scheduling/context";
import { parentLookup } from "../scheduling/reservations";
import { PAYABLE, actorOf, avpUserId, event, getForActor, isAvp, loadByToken, paidSantimOf, trackByToken } from "../external/requests";
import { esc, etb, mailRequester, mailStaff } from "../external/mail";
import { enabledProviders, receiverConfig } from "./config";
import { verifier, type Receipt } from "./verifier";

/**
 * Track 8 — payment verification and confirmation
 * (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md).
 *
 *   requester gives a transaction reference ─▶ the verifier reads the bank's receipt ─▶
 *   it must have paid the university's account, after the quote went out, before the
 *   deadline ─▶ verified amounts add up (split payments are fine) ─▶ once they reach the
 *   quote the request is PAID ─▶ its held slots turn CONFIRMED and it is SCHEDULED.
 *
 * A bank receipt pays once: `claimKey` ("PROVIDER:REFERENCE") is unique while a receipt
 * counts or awaits review. When the verifier can't help, the requester asks for manual
 * review and the AVP's office decides. The verifier call happens outside any transaction;
 * recording it happens under a row lock on the request, so two receipts arriving at
 * once can't both push it to PAID twice.
 */

const MAX_REJECTIONS_PER_DAY = 10;
const TX = { timeout: 20_000 };
type Tx = Prisma.TransactionClient;

function normaliseReference(reference: string): string {
  return reference.trim().toUpperCase().replace(/\s+/g, "");
}

async function lockRequest(tx: Tx, requestId: string): Promise<{ status: ExternalRequestStatus; quoteAmountSantim: number | null }> {
  const rows = await tx.$queryRaw<Array<{ status: ExternalRequestStatus; quoteAmountSantim: number | null }>>`
    SELECT status, "quoteAmountSantim" FROM "ExternalRequest" WHERE id = ${requestId} FOR UPDATE
  `;
  if (!rows[0]) throw new HttpError(404, "Request not found");
  return rows[0];
}

/** Where the money stands: PAID once verified amounts reach the quote, PAYMENT_SUBMITTED
 *  while a person still has a receipt to check, QUOTED otherwise. Call under the lock. */
async function settle(tx: Tx, requestId: string): Promise<ExternalRequestStatus> {
  const request = await lockRequest(tx, requestId);
  if (!PAYABLE.includes(request.status)) return request.status;
  const payments = await tx.paymentVerification.findMany({ where: { requestId }, select: { status: true, amountSantim: true } });
  const paid = paidSantimOf(payments);
  const next: ExternalRequestStatus = paid >= (request.quoteAmountSantim ?? Infinity) ? "PAID" : payments.some((p) => p.status === "PENDING_REVIEW") ? "PAYMENT_SUBMITTED" : "QUOTED";
  if (next !== request.status) await tx.externalRequest.update({ where: { id: requestId }, data: { status: next } });
  return next;
}

function isClaimCollision(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target).includes("claimKey");
}

const USED = "This payment reference has already been used.";

// ── The requester ─────────────────────────────────────────────────────────────

export async function submitPayment(token: string, input: SubmitPaymentInput): Promise<SubmitPaymentResultDto> {
  const row = await loadByToken(token);
  if (!PAYABLE.includes(row.status) || row.quoteAmountSantim === null || !row.quoteSentAt) throw new HttpError(409, "This request is not awaiting payment.");
  if (row.paymentDeadline && row.paymentDeadline.getTime() < Date.now()) throw new HttpError(409, "The payment deadline has passed — please contact the university.");
  if (!enabledProviders().includes(input.provider)) throw new HttpError(400, `Payments through ${PROVIDER_INPUT[input.provider].label} are not accepted here.`);

  const extra = PROVIDER_INPUT[input.provider].extra;
  if (extra?.kind === "SUFFIX" && !(input.accountSuffix && input.accountSuffix.length === extra.digits)) throw new HttpError(400, `${extra.label} — exactly ${extra.digits} digits.`);
  if (extra?.kind === "PHONE" && !input.phoneNumber) throw new HttpError(400, extra.label);

  const reference = normaliseReference(input.reference);
  const claimKey = `${input.provider}:${reference}`;
  const existing = await prisma.paymentVerification.findUnique({ where: { claimKey }, select: { requestId: true } });
  if (existing) throw new HttpError(409, existing.requestId === row.id ? "You have already submitted this payment." : USED);

  const since = new Date(Date.now() - 86_400_000);
  const rejectedToday = row.payments.filter((p) => p.status === "REJECTED" && p.createdAt >= since).length;
  if (rejectedToday >= MAX_REJECTIONS_PER_DAY) throw new HttpError(429, "Too many payment attempts could not be verified today. Ask for a manual review, or try again tomorrow.");

  if (input.manualReview) return submitForReview(token, row.id, row.reference, claimKey, reference, input);

  const quoteSentAt = row.quoteSentAt;
  const result = await verifier().verify({ provider: input.provider, reference, accountSuffix: input.accountSuffix, phoneNumber: input.phoneNumber });
  if (!result.ok) return reject(token, row.id, input, reference, result.reason, result.unavailable, result.raw);

  const receipt = result.receipt;
  const amountSantim = parseAmountToSantim(receipt.amount);
  const paidAt = parseReceiptTime(receipt.date);
  const problem = !statusSaysPaid(receipt.status)
    ? "The bank does not show this payment as completed."
    : !amountSantim
      ? "The amount on this receipt could not be read."
      : !receiverMatches({ account: receipt.receiverAccount, name: receipt.receiverName }, receiverConfig(input.provider))
        ? "This payment was not made to the university's account."
        : !paidAt
          ? "The payment date on this receipt could not be read."
          : !paidAfter(paidAt, quoteSentAt)
            ? "This payment was made before the quote was sent."
            : null;
  if (problem) return reject(token, row.id, input, reference, problem, false, receipt.raw, receipt, amountSantim, paidAt?.at ?? null);

  let status: ExternalRequestStatus;
  try {
    status = await prisma.$transaction(async (tx) => {
      const current = await lockRequest(tx, row.id);
      if (!PAYABLE.includes(current.status)) throw new HttpError(409, "This request is no longer awaiting payment.");
      await tx.paymentVerification.create({
        data: { requestId: row.id, provider: input.provider, reference, claimKey, status: "VERIFIED", ...receiptFields(receipt, amountSantim!, paidAt!.at) },
      });
      await event(tx, row.id, { id: null, label: "Requester" }, "PAYMENT_VERIFIED", `${etb(amountSantim!)} via ${PROVIDER_INPUT[input.provider].label} (${reference})`);
      return settle(tx, row.id);
    }, TX);
  } catch (err) {
    if (isClaimCollision(err)) throw new HttpError(409, USED);
    throw err;
  }
  await afterPayment(row.id, status, amountSantim!);
  return { outcome: "VERIFIED", reason: null, unavailable: false, tracking: await trackByToken(token) };
}

function receiptFields(receipt: Receipt, amountSantim: number | null, paidAt: Date | null) {
  return {
    amountSantim,
    payerName: receipt.payerName?.slice(0, 200) ?? null,
    receiverName: receipt.receiverName?.slice(0, 200) ?? null,
    receiverAccount: receipt.receiverAccount?.slice(0, 100) ?? null,
    paidAt,
    raw: (receipt.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  };
}

async function reject(
  token: string,
  requestId: string,
  input: SubmitPaymentInput,
  reference: string,
  reason: string,
  unavailable: boolean,
  raw: unknown,
  receipt?: Receipt,
  amountSantim: number | null = null,
  paidAt: Date | null = null,
): Promise<SubmitPaymentResultDto> {
  await prisma.$transaction(async (tx) => {
    await tx.paymentVerification.create({
      data: {
        requestId,
        provider: input.provider,
        reference,
        status: "REJECTED",
        reason,
        ...(receipt ? receiptFields(receipt, amountSantim, paidAt) : { raw: (raw ?? Prisma.JsonNull) as Prisma.InputJsonValue }),
      },
    });
    await event(tx, requestId, { id: null, label: "Requester" }, "PAYMENT_REJECTED", `${reference}: ${reason}`);
  });
  return { outcome: "REJECTED", reason, unavailable, tracking: await trackByToken(token) };
}

async function submitForReview(token: string, requestId: string, requestRef: string, claimKey: string, reference: string, input: SubmitPaymentInput): Promise<SubmitPaymentResultDto> {
  if (!input.amountSantim) throw new HttpError(400, "Say how much you paid, so the office can check it.");
  try {
    await prisma.$transaction(async (tx) => {
      const current = await lockRequest(tx, requestId);
      if (!PAYABLE.includes(current.status)) throw new HttpError(409, "This request is no longer awaiting payment.");
      await tx.paymentVerification.create({
        data: { requestId, provider: input.provider, reference, claimKey, status: "PENDING_REVIEW", amountSantim: input.amountSantim, requesterNote: input.note || null },
      });
      await event(tx, requestId, { id: null, label: "Requester" }, "PAYMENT_SUBMITTED", `${etb(input.amountSantim!)} via ${PROVIDER_INPUT[input.provider].label} (${reference}) — for manual review`);
      await settle(tx, requestId);
    }, TX);
  } catch (err) {
    if (isClaimCollision(err)) throw new HttpError(409, USED);
    throw err;
  }
  const avp = await avpUserId();
  if (avp) {
    const to = await prisma.user.findUnique({ where: { id: avp }, select: { email: true } });
    await mailStaff(to?.email, `Payment to check for ${requestRef}`, [`The requester says they paid ${esc(etb(input.amountSantim))} through ${esc(PROVIDER_INPUT[input.provider].label)}, reference ${esc(reference)}, and asked for it to be checked by hand.`], "/external-requests");
  }
  return { outcome: "PENDING_REVIEW", reason: null, unavailable: false, tracking: await trackByToken(token) };
}

// ── The AVP's office ──────────────────────────────────────────────────────────

export async function reviewPayment(userId: string, paymentId: string, input: ReviewPaymentInput): Promise<ExternalRequestDto> {
  if (!(await isAvp(userId))) throw new HttpError(403, "Only the Academic Vice President's office reviews payments.");
  const payment = await prisma.paymentVerification.findUnique({ where: { id: paymentId }, include: { request: { select: { id: true, reference: true, contactEmail: true, contactName: true } } } });
  if (!payment) throw new HttpError(404, "Payment not found");
  if (input.decision === "REJECT" && !input.note) throw new HttpError(400, "Say why the payment could not be accepted — the requester sees it.");
  const amountSantim = input.amountSantim ?? payment.amountSantim;
  if (input.decision === "APPROVE" && !amountSantim) throw new HttpError(400, "Give the amount actually received.");

  const actor = await actorOf(userId);
  const status = await prisma.$transaction(async (tx) => {
    const current = await lockRequest(tx, payment.requestId);
    const fresh = await tx.paymentVerification.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } });
    if (fresh.status !== "PENDING_REVIEW") throw new HttpError(409, "This payment has already been reviewed.");
    if (!PAYABLE.includes(current.status)) throw new HttpError(409, "This request is no longer awaiting payment.");
    const approve = input.decision === "APPROVE";
    await tx.paymentVerification.update({
      where: { id: paymentId },
      data: {
        status: approve ? "MANUAL_VERIFIED" : "MANUAL_REJECTED",
        amountSantim: approve ? amountSantim : payment.amountSantim,
        claimKey: approve ? payment.claimKey : null,
        reason: input.note || null,
        reviewedById: userId,
        reviewedAt: new Date(),
      },
    });
    await event(tx, payment.requestId, actor, approve ? "PAYMENT_VERIFIED" : "PAYMENT_REJECTED", approve ? `${etb(amountSantim!)} via ${PROVIDER_INPUT[payment.provider].label} (${payment.reference}) — checked by hand` : `${payment.reference}: ${input.note}`);
    return settle(tx, payment.requestId);
  }, TX);

  if (input.decision === "REJECT") {
    await mailRequester(payment.request.contactEmail, `Payment for ${payment.request.reference} not accepted`, [
      `Dear ${esc(payment.request.contactName)},`,
      `We could not accept the payment with reference ${esc(payment.reference)}: ${esc(input.note)}`,
      "You can submit another payment reference from your tracking page.",
    ]);
  } else {
    await afterPayment(payment.requestId, status, amountSantim!);
  }
  return getForActor(userId, payment.requestId);
}

/** The AVP retrying confirmation of a PAID request — after a lost slot was re-held. */
export async function confirmBooking(userId: string, requestId: string): Promise<ExternalRequestDto> {
  if (!(await isAvp(userId))) throw new HttpError(403, "Only the Academic Vice President's office confirms bookings.");
  const outcome = await confirmPaidRequest(requestId, await actorOf(userId));
  if (!outcome) throw new HttpError(409, "Only a paid request waiting for its calendar can be confirmed.");
  return getForActor(userId, requestId);
}

/** A verified amount landed: tell the requester where they stand, and book it if paid. */
async function afterPayment(requestId: string, status: ExternalRequestStatus, amountSantim: number): Promise<void> {
  if (status === "PAID") {
    await confirmPaidRequest(requestId, { id: null, label: "System" });
    return;
  }
  const row = await prisma.externalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { payments: { select: { status: true, amountSantim: true } } } });
  const paid = paidSantimOf(row.payments);
  await mailRequester(row.contactEmail, `Payment received for ${row.reference}`, [
    `Dear ${esc(row.contactName)},`,
    `We have confirmed a payment of ${esc(etb(amountSantim))}. So far ${esc(etb(paid))} of ${esc(etb(row.quoteAmountSantim ?? 0))} has been received; the booking is confirmed once the full amount is paid.`,
  ]);
}

// ── Confirmation ──────────────────────────────────────────────────────────────

interface Confirmation {
  scheduled: boolean;
  conflicts: string[];
  confirmed: Array<{ labItemId: string; labName: string; when: string }>;
}

function whenOf(startsAt: Date, endsAt: Date): string {
  const s = instantToCivil(startsAt);
  return `${s.date} ${s.time}–${instantToCivil(endsAt).time}`;
}

/**
 * Turn a PAID request's held slots into confirmed bookings, and the request SCHEDULED.
 * Idempotent — a request that isn't PAID is left alone (returns null).
 *
 * Every lab tree the request touches is locked in a stable order. Holds still HELD were
 * blocking all along, so nothing can have taken their slot: they confirm outright. A hold
 * that lapsed meanwhile (a manual review that ran past the deadline) is re-checked: free,
 * it is revived as confirmed; taken by someone else, or already in the past, it is
 * released and named in a CONFIRMATION_CONFLICT event, and the request stays PAID for the
 * AVP — a custodian can hold a replacement slot and the AVP confirms again. A lapsed hold
 * that only collides with this request's own bookings was superseded by a re-hold and is
 * left as it is.
 */
export async function confirmPaidRequest(requestId: string, actor: { id: string | null; label: string }): Promise<Confirmation | null> {
  const candidates = await prisma.reservation.findMany({ where: { externalRequestId: requestId, state: { in: ["HELD", "EXPIRED"] } }, select: { labItemId: true } });
  const labIds = [...new Set(candidates.map((c) => c.labItemId))];
  const lineage = labIds.length ? await lineageRows(prisma, labIds) : new Map();
  const roots = [...new Set(labIds.map((id) => rootOf(lineage, id)))].sort();

  const outcome = await prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, requestId);
    if (request.status !== "PAID") return null;
    for (const root of roots) await lockTree(tx, root);

    const holds = await tx.reservation.findMany({
      where: { externalRequestId: requestId, state: { in: ["HELD", "EXPIRED"] } },
      include: { resources: { select: { itemId: true } }, lab: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
    });
    const now = new Date();
    const confirmed: Confirmation["confirmed"] = [];
    const conflicts: string[] = [];

    const held = holds.filter((h) => h.state === "HELD");
    if (held.length) {
      const ids = held.map((h) => h.id);
      await tx.reservation.updateMany({ where: { id: { in: ids } }, data: { state: "CONFIRMED", holdExpiresAt: null, decidedAt: now } });
      await tx.reservationResource.updateMany({ where: { reservationId: { in: ids } }, data: { blocking: true } });
      confirmed.push(...held.map((h) => ({ labItemId: h.labItemId, labName: h.lab.name, when: whenOf(h.startsAt, h.endsAt) })));
    }

    const ownIds = new Set((await tx.reservation.findMany({ where: { externalRequestId: requestId }, select: { id: true } })).map((r) => r.id));
    for (const lapsed of holds.filter((h) => h.state === "EXPIRED")) {
      const when = whenOf(lapsed.startsAt, lapsed.endsAt);
      if (lapsed.startsAt <= now) {
        conflicts.push(`${lapsed.lab.name} ${when} — the hold lapsed and the time has passed`);
        await tx.reservation.update({ where: { id: lapsed.id }, data: { state: "CANCELLED", note: "Hold lapsed before payment was confirmed." } });
        continue;
      }
      const root = rootOf(lineage, lapsed.labItemId);
      const tree = await subtreeRows(tx, root);
      const treeIds = tree.map((r) => r.id);
      await expireHolds(tx, treeIds);
      const { claims } = await loadClaims(tx, treeIds, lapsed.startsAt, lapsed.endsAt);
      const clashes = findClashes({ itemIds: lapsed.resources.map((r) => r.itemId), startsAt: lapsed.startsAt, endsAt: lapsed.endsAt }, claims, parentLookup(tree), [lapsed.id]).filter((c) => c.blocking);
      if (!clashes.length) {
        await tx.reservation.update({ where: { id: lapsed.id }, data: { state: "CONFIRMED", holdExpiresAt: null, decidedAt: now } });
        await tx.reservationResource.updateMany({ where: { reservationId: lapsed.id }, data: { blocking: true } });
        confirmed.push({ labItemId: lapsed.labItemId, labName: lapsed.lab.name, when });
      } else if (clashes.every((c) => ownIds.has(c.reservationId))) {
        // Superseded by a replacement hold for this same request — nothing to do.
      } else {
        const takenBy = [...new Set(clashes.filter((c) => !ownIds.has(c.reservationId)).map((c) => c.title))].join(", ");
        conflicts.push(`${lapsed.lab.name} ${when} — now taken by ${takenBy}`);
        await tx.reservation.update({ where: { id: lapsed.id }, data: { state: "CANCELLED", note: "Slot was taken before payment was confirmed." } });
      }
    }

    if (conflicts.length) {
      await event(tx, requestId, actor, "CONFIRMATION_CONFLICT", conflicts.join("; "));
    } else {
      await tx.externalRequest.update({ where: { id: requestId }, data: { status: "SCHEDULED" } });
      await event(tx, requestId, actor, "SCHEDULED", confirmed.length ? `${confirmed.length} booking${confirmed.length === 1 ? "" : "s"} confirmed` : null);
    }
    return { scheduled: conflicts.length === 0, conflicts, confirmed };
  }, TX);

  if (outcome) await mailConfirmation(requestId, outcome, lineage);
  return outcome;
}

async function mailConfirmation(requestId: string, outcome: Confirmation, lineage: Map<string, { parentId: string | null; custodianId: string | null }>): Promise<void> {
  const row = await prisma.externalRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { assignments: { where: { status: "ACCEPTED" }, include: { orgNode: { select: { user: { select: { email: true } } } } } } },
  });
  const slots = outcome.confirmed.map((c) => `${esc(c.labName)} · ${esc(c.when)}`);

  if (outcome.scheduled) {
    await mailRequester(row.contactEmail, `Booking confirmed — ${row.reference}`, [
      `Dear ${esc(row.contactName)},`,
      `Your payment is complete and ${esc(row.organizationName)}'s booking is confirmed.`,
      slots.length ? `Booked: ${slots.join("<br>")}` : "",
      "The departments concerned will be in touch with any arrangements for the day.",
    ].filter(Boolean));
  } else {
    await mailRequester(row.contactEmail, `Payment complete — ${row.reference}`, [
      `Dear ${esc(row.contactName)},`,
      "Your payment is complete. One or more of the requested slots needs to be re-arranged; the university's office will contact you shortly.",
    ]);
    const avp = await avpUserId();
    const to = avp ? await prisma.user.findUnique({ where: { id: avp }, select: { email: true } }) : null;
    await mailStaff(to?.email, `${row.reference} is paid but a slot was lost`, [outcome.conflicts.map(esc).join("<br>"), "Have a custodian hold a replacement slot, then confirm the booking again — or decline and arrange a refund."], "/external-requests");
  }

  // Each lab's custodian (the nearest one up the tree), once, with that lab's slots.
  const custodianOf = (labItemId: string): string | null => {
    let current: string | null = labItemId;
    for (let guard = 0; current && guard < 50; guard++) {
      const node = lineage.get(current);
      if (!node) return null;
      if (node.custodianId) return node.custodianId;
      current = node.parentId;
    }
    return null;
  };
  const byCustodian = new Map<string, string[]>();
  for (const c of outcome.confirmed) {
    const custodian = custodianOf(c.labItemId);
    if (custodian) byCustodian.set(custodian, [...(byCustodian.get(custodian) ?? []), `${esc(c.labName)} · ${esc(c.when)}`]);
  }
  for (const [custodianId, lines] of byCustodian) {
    const user = await prisma.user.findUnique({ where: { id: custodianId }, select: { email: true } });
    await mailStaff(user?.email, `Booking confirmed on your calendar — ${row.reference}`, [`${esc(row.organizationName)} has paid. These slots are now confirmed bookings:`, lines.join("<br>")], "/schedule");
  }
  if (outcome.scheduled) {
    for (const a of row.assignments) {
      await mailStaff(a.orgNode.user?.email, `${row.reference} is paid and booked`, [`${esc(row.organizationName)} has paid ${esc(etb(row.quoteAmountSantim ?? 0))}; the held slots are now confirmed bookings.`], "/external-requests");
    }
  }
}

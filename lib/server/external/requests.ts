import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type ExternalRequestStatus } from "@prisma/client";
import type {
  CloseExternalRequestInput,
  DecideAssignmentInput,
  ExternalRequestDto,
  ExternalRequestSummaryDto,
  ForwardExternalRequestInput,
  PlaceHoldInput,
  PublicTrackingDto,
  ReservationDto,
  SendQuoteInput,
  SubmitExternalRequestInput,
  SubmitExternalRequestResultDto,
} from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { generateToken, hashToken } from "../auth/token";
import { storage } from "../resources/storage";
import * as scope from "../resources/scope";
import { DEFAULT_TIME_ZONE, addDays, civilToInstant, instantToCivil, isCivilDate, minutesOf } from "@/lib/domain/civil-time";
import { RESERVATION_INCLUDE, civilDateOf, dateColumn, decidesFor, resolveBookingTarget, subtreeRows, toReservationDto, viewerOf } from "../scheduling/context";
import { equipmentOf, writeReservation } from "../scheduling/reservations";
import { esc, etb, mailRequester, mailStaff, trackingUrl } from "./mail";
import { PROVIDER_INPUT } from "@/lib/domain/payment-receipt";
import { enabledProviders } from "../payments/config";

/**
 * Track 7 — external booking requests
 * (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md).
 *
 *   public request ─▶ AVP forwards to departments ─▶ custodians place HELD reservations
 *   ─▶ each head accepts (pricing sheet link + amount) or declines ─▶ AVP sends one
 *   quote ─▶ (Track 8) verified payment confirms the holds.
 *
 * The AVP is the live occupant of the UNIVERSITY-kind root (the same reading Track 4's
 * purchase ladder uses), plus SYS_ADMIN. A department head is resolved live from
 * `OrgNode.userId`, never frozen onto the assignment. Holds are ordinary reservations
 * written through the scheduling write path, so they genuinely block the calendar.
 */

export const MAX_LETTER_BYTES = 4 * 1024 * 1024;
const HOLD_DAYS_BEFORE_QUOTE = 14;
const PER_EMAIL_PER_DAY = 3;
const PER_IP_PER_DAY = 10;
const OPEN_STATUSES: ExternalRequestStatus[] = ["SUBMITTED", "UNDER_REVIEW", "QUOTED", "PAYMENT_SUBMITTED", "PAID"];
/** A custodian may (re)hold slots while the request is live and not yet on the calendar. */
const HOLDABLE: ExternalRequestStatus[] = ["UNDER_REVIEW", "QUOTED", "PAYMENT_SUBMITTED", "PAID"];
export const PAYABLE: ExternalRequestStatus[] = ["QUOTED", "PAYMENT_SUBMITTED"];
export const COUNTED_PAYMENTS = ["VERIFIED", "MANUAL_VERIFIED"] as const;

type Line = { description: string; quantity: number; categoryName: string | null };

function bankDetails() {
  const bankName = process.env.UNIVERSITY_BANK_NAME;
  const accountName = process.env.UNIVERSITY_BANK_ACCOUNT_NAME;
  const accountNumber = process.env.UNIVERSITY_BANK_ACCOUNT_NUMBER;
  return bankName && accountName && accountNumber ? { bankName, accountName, accountNumber } : null;
}

/** The year's highest number plus one — not a row count, which a deleted request would
 *  push back onto a number already taken. */
async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const prefix = `EXT-${new Date().getFullYear()}-`;
  const [{ max }] = await tx.$queryRaw<[{ max: number | null }]>`
    SELECT MAX(CAST(substring(reference FROM ${prefix.length + 1}::int) AS integer)) AS max
    FROM "ExternalRequest" WHERE reference LIKE ${prefix + "%"} AND substring(reference FROM ${prefix.length + 1}::int) ~ '^[0-9]+$'
  `;
  return `${prefix}${String((max ?? 0) + 1).padStart(3, "0")}`;
}

export async function event(tx: Prisma.TransactionClient | typeof prisma, requestId: string, actor: { id: string | null; label: string }, kind: string, note?: string | null, data?: Prisma.InputJsonValue) {
  await tx.externalRequest.update({ where: { id: requestId }, data: { updatedAt: new Date() } });
  await tx.externalRequestEvent.create({ data: { requestId, actorId: actor.id, actorLabel: actor.label, kind, note: note || null, data } });
}

export async function actorOf(userId: string): Promise<{ id: string; label: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return { id: userId, label: user?.name ?? "Staff" };
}

/** A PDF is a PDF by its bytes, never by its name or declared type. */
export function isPdf(bytes: Buffer): boolean {
  return bytes.length > 8 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

// ── Who is who ────────────────────────────────────────────────────────────────

export async function avpUserId(): Promise<string | null> {
  const root = await prisma.orgNode.findFirst({ where: { kind: "UNIVERSITY", active: true, userId: { not: null } }, select: { userId: true } });
  return root?.userId ?? null;
}

export async function isAvp(userId: string): Promise<boolean> {
  if (await scope.isSysAdmin(userId)) return true;
  const occupied = await prisma.orgNode.findFirst({ where: { kind: "UNIVERSITY", active: true, userId } });
  return occupied !== null;
}

/** Departments a person answers for as a custodian: the units owning or holding the
 *  rooms they keep, plus their home unit. */
async function custodianUnits(userId: string): Promise<Set<string>> {
  const custody = await scope.custodyItemIdsOf(userId);
  const rooms = custody.length
    ? await prisma.item.findMany({ where: { id: { in: custody }, deletedAt: null, category: { bookingMode: "ROOM" } }, select: { ownerOrgNodeId: true, currentOrgNodeId: true } })
    : [];
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { homeNodeId: true } });
  return new Set([...rooms.flatMap((r) => [r.ownerOrgNodeId, r.currentOrgNodeId]), ...(user?.homeNodeId ? [user.homeNodeId] : [])]);
}

interface Access {
  avp: boolean;
  headOf: Set<string>;
  custodianOf: Set<string>;
}

async function accessFor(userId: string): Promise<Access> {
  const [avp, headed, units] = await Promise.all([isAvp(userId), prisma.orgNode.findMany({ where: { userId, active: true }, select: { id: true } }), custodianUnits(userId)]);
  return { avp, headOf: new Set(headed.map((n) => n.id)), custodianOf: units };
}

function roleOn(access: Access, assignedNodeIds: string[]): "AVP" | "HEAD" | "CUSTODIAN" | null {
  if (access.avp) return "AVP";
  if (assignedNodeIds.some((id) => access.headOf.has(id))) return "HEAD";
  if (assignedNodeIds.some((id) => access.custodianOf.has(id))) return "CUSTODIAN";
  return null;
}

// ── Public: submit, track, cancel ────────────────────────────────────────────

export async function submitRequest(
  input: SubmitExternalRequestInput,
  letter: { bytes: Buffer; fileName: string },
  ipHash: string | null,
): Promise<SubmitExternalRequestResultDto> {
  if (input.website) throw new HttpError(400, "Your request could not be accepted.");
  if (letter.bytes.length > MAX_LETTER_BYTES) throw new HttpError(400, "The letter must be a PDF of at most 4 MB.");
  if (!isPdf(letter.bytes)) throw new HttpError(400, "The official letter must be a PDF file.");

  const since = new Date(Date.now() - 86_400_000);
  const email = input.contactEmail.toLowerCase();
  const [byEmail, byIp] = await Promise.all([
    prisma.externalRequest.count({ where: { contactEmail: email, createdAt: { gte: since } } }),
    ipHash ? prisma.externalRequest.count({ where: { submitterIpHash: ipHash, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  if (byEmail >= PER_EMAIL_PER_DAY || byIp >= PER_IP_PER_DAY) {
    throw new HttpError(429, "Too many requests have been sent from here today. Please try again tomorrow, or contact the university directly.");
  }

  const now = Date.now();
  const windows = input.windows.map((w, i) => {
    if (!isCivilDate(w.date)) throw new HttpError(400, "One of the dates is not a real date.");
    if (minutesOf(w.end) <= minutesOf(w.start)) throw new HttpError(400, `On ${w.date}, the end time must be after the start time.`);
    const startsAt = civilToInstant(w.date, w.start, DEFAULT_TIME_ZONE);
    if (startsAt.getTime() < now + 86_400_000) throw new HttpError(400, `${w.date} is too soon — ask for dates at least a day ahead.`);
    return { date: dateColumn(w.date), startTimeLocal: w.start, endTimeLocal: w.end, startsAt, endsAt: civilToInstant(w.date, w.end, DEFAULT_TIME_ZONE), sortOrder: i };
  });

  const categoryIds = input.lines.map((l) => l.categoryId).filter((id): id is string => Boolean(id));
  const categories = categoryIds.length ? await prisma.resourceCategory.findMany({ where: { id: { in: categoryIds }, publicListed: true }, select: { id: true, name: true } }) : [];
  const lines: Line[] = input.lines.map((l) => ({ description: l.description, quantity: l.quantity, categoryName: categories.find((c) => c.id === l.categoryId)?.name ?? null }));

  const storageKey = `ext-letter-${randomUUID()}`;
  await storage.write(storageKey, letter.bytes);
  const token = generateToken();

  let reference = "";
  try {
    // Two submissions in the same instant can compute the same next reference; the
    // unique index refuses the second, which simply takes the next number.
    for (let attempt = 0; ; attempt++) {
      try {
        reference = await createRow();
        break;
      } catch (err) {
        const collided = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && String(err.meta?.target).includes("reference");
        if (!collided || attempt >= 4) throw err;
      }
    }
  } catch (err) {
    await storage.remove(storageKey).catch(() => undefined);
    throw err;
  }

  async function createRow(): Promise<string> {
    return prisma.$transaction(async (tx) => {
      const ref = await nextReference(tx);
      const row = await tx.externalRequest.create({
        data: {
          reference: ref,
          organizationName: input.organizationName,
          contactName: input.contactName,
          contactEmail: email,
          contactPhone: input.contactPhone,
          purpose: input.purpose,
          lines: lines as unknown as Prisma.InputJsonValue,
          letterStorageKey: storageKey,
          letterFileName: letter.fileName.slice(0, 200) || "letter.pdf",
          letterByteSize: letter.bytes.length,
          trackingTokenHash: hashToken(token),
          submitterIpHash: ipHash,
          windows: { create: windows },
        },
      });
      await tx.externalRequestEvent.create({ data: { requestId: row.id, actorLabel: "Requester", kind: "SUBMITTED" } });
      return ref;
    });
  }

  await mailRequester(
    email,
    `Request ${reference} received`,
    [
      `Dear ${esc(input.contactName)},`,
      `We have received ${esc(input.organizationName)}'s request (${esc(reference)}). The Academic Vice President's office will review it with the departments concerned and send you a quote.`,
      "Keep this email — the link below is how you follow your request, receive the quote and confirm payment.",
    ],
    { href: trackingUrl(token), label: `Track request ${reference}` },
  );
  const avp = await avpUserId();
  if (avp) {
    const to = await prisma.user.findUnique({ where: { id: avp }, select: { email: true } });
    await mailStaff(to?.email, `New external request ${reference}`, [`${esc(input.organizationName)} has asked for university resources: ${esc(input.purpose.slice(0, 300))}`], "/external-requests");
  }
  return { reference, trackingToken: token };
}

export async function loadByToken(token: string) {
  if (!token || token.length < 20) throw new HttpError(404, "Request not found");
  const row = await prisma.externalRequest.findUnique({
    where: { trackingTokenHash: hashToken(token) },
    include: { windows: { orderBy: { sortOrder: "asc" } }, events: { orderBy: { at: "asc" } }, assignments: true, payments: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) throw new HttpError(404, "Request not found");
  return row;
}

const PUBLIC_EVENT_LABEL: Record<string, string> = {
  SUBMITTED: "Request received",
  FORWARDED: "Sent to the departments concerned",
  QUOTED: "Quote sent",
  PAYMENT_SUBMITTED: "Payment submitted for verification",
  PAYMENT_VERIFIED: "Payment confirmed",
  PAYMENT_REJECTED: "Payment could not be verified",
  SCHEDULED: "Booking confirmed",
  DECLINED: "Request declined",
  CANCELLED: "Request cancelled",
  EXPIRED: "Quote expired unpaid",
};

function windowsOf(rows: Array<{ date: Date; startTimeLocal: string; endTimeLocal: string }>) {
  return rows.map((w) => ({ date: civilDateOf(w.date), start: w.startTimeLocal, end: w.endTimeLocal }));
}

export async function trackByToken(token: string): Promise<PublicTrackingDto> {
  const row = await loadByToken(token);
  const quoted = row.quoteAmountSantim !== null && row.quoteSentAt !== null;
  return {
    reference: row.reference,
    status: row.status,
    organizationName: row.organizationName,
    contactName: row.contactName,
    createdAt: row.createdAt.toISOString(),
    purpose: row.purpose,
    windows: windowsOf(row.windows),
    lines: row.lines as unknown as Line[],
    quote: quoted
      ? {
          amountSantim: row.quoteAmountSantim!,
          note: row.quoteNote,
          sheetUrls: row.assignments.filter((a) => a.status === "ACCEPTED" && a.sheetUrl).map((a) => a.sheetUrl!),
          paymentDeadline: row.paymentDeadline?.toISOString() ?? null,
          bank: bankDetails(),
        }
      : null,
    timeline: row.events.filter((e) => PUBLIC_EVENT_LABEL[e.kind]).map((e) => ({ at: e.at.toISOString(), label: PUBLIC_EVENT_LABEL[e.kind], note: ["DECLINED", "PAYMENT_REJECTED", "PAYMENT_VERIFIED", "PAYMENT_SUBMITTED", "QUOTED"].includes(e.kind) ? e.note : null })),
    closingNote: row.closingNote,
    canCancel: cancellable(row),
    payment: quoted
      ? {
          providers: enabledProviders().map((id) => ({ id, ...PROVIDER_INPUT[id] })),
          paidSantim: paidSantimOf(row.payments),
          pendingCount: row.payments.filter((p) => p.status === "PENDING_REVIEW").length,
          canSubmit: PAYABLE.includes(row.status) && (!row.paymentDeadline || row.paymentDeadline.getTime() > Date.now()),
          attempts: row.payments.map((p) => ({ provider: p.provider, reference: p.reference, status: p.status, amountSantim: p.amountSantim, reason: p.reason, createdAt: p.createdAt.toISOString() })),
        }
      : null,
  };
}

/** Before any money has been accepted — after that, withdrawing is a conversation with the office. */
function cancellable(row: { status: ExternalRequestStatus; payments: Array<{ status: string; amountSantim: number | null }> }): boolean {
  return ["SUBMITTED", "UNDER_REVIEW", "QUOTED"].includes(row.status) && !row.payments.some((p) => (COUNTED_PAYMENTS as readonly string[]).includes(p.status));
}

export function paidSantimOf(payments: Array<{ status: string; amountSantim: number | null }>): number {
  return payments.filter((p) => (COUNTED_PAYMENTS as readonly string[]).includes(p.status)).reduce((sum, p) => sum + (p.amountSantim ?? 0), 0);
}

async function releaseHolds(tx: Prisma.TransactionClient, requestId: string, state: "CANCELLED" | "EXPIRED", onlyNodeIds?: string[]) {
  const holds = await tx.reservation.findMany({
    where: {
      externalRequestId: requestId,
      state: { in: ["HELD", "CONFIRMED", "REQUESTED"] },
      ...(onlyNodeIds ? { lab: { OR: [{ ownerOrgNodeId: { in: onlyNodeIds } }, { currentOrgNodeId: { in: onlyNodeIds } }] } } : {}),
    },
    select: { id: true },
  });
  const ids = holds.map((h) => h.id);
  if (!ids.length) return 0;
  await tx.reservation.updateMany({ where: { id: { in: ids } }, data: { state } });
  await tx.reservationResource.updateMany({ where: { reservationId: { in: ids } }, data: { blocking: false } });
  return ids.length;
}

export async function cancelByToken(token: string): Promise<PublicTrackingDto> {
  const row = await loadByToken(token);
  if (!cancellable(row)) throw new HttpError(409, "This request can no longer be cancelled here — contact the university.");
  await prisma.$transaction(async (tx) => {
    await releaseHolds(tx, row.id, "CANCELLED");
    await tx.externalRequest.update({ where: { id: row.id }, data: { status: "CANCELLED", closingNote: "Cancelled by the requester." } });
    await event(tx, row.id, { id: null, label: "Requester" }, "CANCELLED");
  });
  return trackByToken(token);
}

// ── Staff: list and detail ────────────────────────────────────────────────────

export async function listForActor(userId: string): Promise<ExternalRequestSummaryDto[]> {
  const access = await accessFor(userId);
  const nodeIds = [...access.headOf, ...access.custodianOf];
  if (!access.avp && !nodeIds.length) return [];
  const rows = await prisma.externalRequest.findMany({
    where: access.avp ? {} : { assignments: { some: { orgNodeId: { in: nodeIds } } } },
    include: { windows: { orderBy: { sortOrder: "asc" } }, assignments: { select: { orgNodeId: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    organizationName: r.organizationName,
    createdAt: r.createdAt.toISOString(),
    firstWindow: r.windows[0] ? windowsOf([r.windows[0]])[0] : null,
    windowCount: r.windows.length,
    assignmentCount: r.assignments.length,
    acceptedCount: r.assignments.filter((a) => a.status === "ACCEPTED").length,
    role: roleOn(access, r.assignments.map((a) => a.orgNodeId)) ?? "AVP",
  }));
}

async function loadForActor(userId: string, id: string) {
  const row = await prisma.externalRequest.findUnique({
    where: { id },
    include: {
      windows: { orderBy: { sortOrder: "asc" } },
      events: { orderBy: { at: "asc" } },
      assignments: { include: { orgNode: { select: { name: true, userId: true, user: { select: { name: true } } } }, decidedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      payments: { include: { reviewedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!row) throw new HttpError(404, "Request not found");
  const access = await accessFor(userId);
  const role = roleOn(access, row.assignments.map((a) => a.orgNodeId));
  if (!role) throw new HttpError(404, "Request not found");
  return { row, access, role };
}

export async function getForActor(userId: string, id: string): Promise<ExternalRequestDto> {
  const { row, access } = await loadForActor(userId, id);
  const assignedIds = row.assignments.filter((a) => a.status !== "DECLINED").map((a) => a.orgNodeId);
  const [holdRows, viewer, departments] = await Promise.all([
    prisma.reservation.findMany({ where: { externalRequestId: id }, include: { ...RESERVATION_INCLUDE, lab: { select: { name: true, ownerOrgNodeId: true, currentOrgNodeId: true } } }, orderBy: { startsAt: "asc" } }),
    viewerOf(userId),
    access.avp ? prisma.orgNode.findMany({ where: { kind: "DEPARTMENT", active: true }, select: { id: true, name: true, user: { select: { name: true } } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  // Rooms this viewer keeps that belong to a department the request was sent to.
  const custodyRooms = viewer.custody.size
    ? await prisma.item.findMany({
        where: { id: { in: [...viewer.custody] }, deletedAt: null, category: { bookingMode: "ROOM" }, OR: [{ ownerOrgNodeId: { in: assignedIds } }, { currentOrgNodeId: { in: assignedIds } }] },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];
  const holdRooms = [];
  for (const room of custodyRooms) {
    // Same list (and "Workstation 01 › Computer" places) as booking uses — working machines only.
    const equipment = equipmentOf(await subtreeRows(prisma, room.id), room.id).map((m) => ({ id: m.id, name: m.name, place: m.place }));
    holdRooms.push({ ...room, equipment });
  }

  const open = OPEN_STATUSES.includes(row.status);
  const holds: ReservationDto[] = holdRows.map((h) => toReservationDto(h as never, viewer));
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    organizationName: row.organizationName,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    purpose: row.purpose,
    createdAt: row.createdAt.toISOString(),
    windows: windowsOf(row.windows),
    lines: row.lines as unknown as Line[],
    letter: { fileName: row.letterFileName, byteSize: row.letterByteSize, url: `/api/external-requests/${row.id}/letter` },
    quoteAmountSantim: row.quoteAmountSantim,
    quoteNote: row.quoteNote,
    quoteSentAt: row.quoteSentAt?.toISOString() ?? null,
    paymentDeadline: row.paymentDeadline?.toISOString() ?? null,
    closingNote: row.closingNote,
    assignments: row.assignments.map((a) => ({
      id: a.id,
      orgNodeId: a.orgNodeId,
      orgNodeName: a.orgNode.name,
      headName: a.orgNode.user?.name ?? null,
      status: a.status,
      sheetUrl: a.sheetUrl,
      amountSantim: a.amountSantim,
      noCalendarNeeded: a.noCalendarNeeded,
      note: a.note,
      decidedByName: a.decidedBy?.name ?? null,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      holdCount: holdRows.filter((h) => ["HELD", "CONFIRMED"].includes(h.state) && (h.lab.ownerOrgNodeId === a.orgNodeId || h.lab.currentOrgNodeId === a.orgNodeId)).length,
      canDecide: row.status === "UNDER_REVIEW" && a.status === "PENDING" && (access.headOf.has(a.orgNodeId) || viewer.sysAdmin),
    })),
    holds,
    // Payment receipts are the AVP's business; heads and custodians see the total only.
    payments: access.avp
      ? row.payments.map((p) => ({
          id: p.id,
          provider: p.provider,
          reference: p.reference,
          status: p.status,
          amountSantim: p.amountSantim,
          payerName: p.payerName,
          receiverName: p.receiverName,
          receiverAccount: p.receiverAccount,
          paidAt: p.paidAt?.toISOString() ?? null,
          reason: p.reason,
          requesterNote: p.requesterNote,
          reviewedByName: p.reviewedBy?.name ?? null,
          createdAt: p.createdAt.toISOString(),
          canReview: p.status === "PENDING_REVIEW" && PAYABLE.includes(row.status),
        }))
      : [],
    paidSantim: paidSantimOf(row.payments),
    events: row.events.map((e) => ({ at: e.at.toISOString(), actorLabel: e.actorLabel, kind: e.kind, note: e.note })),
    departments: departments.map((d) => ({ id: d.id, name: d.name, headName: d.user?.name ?? null })),
    holdRooms,
    can: {
      forward: access.avp && ["SUBMITTED", "UNDER_REVIEW"].includes(row.status),
      quote: access.avp && row.status === "UNDER_REVIEW" && row.assignments.length > 0 && row.assignments.every((a) => a.status !== "PENDING") && row.assignments.some((a) => a.status === "ACCEPTED"),
      close: access.avp && open,
      placeHold: holdRooms.length > 0 && HOLDABLE.includes(row.status),
      extendHolds: (access.avp || row.assignments.some((a) => access.headOf.has(a.orgNodeId))) && HOLDABLE.includes(row.status),
      confirm: access.avp && row.status === "PAID",
    },
  };
}

export async function letterFor(userId: string, id: string): Promise<{ bytes: Buffer; fileName: string }> {
  const { row } = await loadForActor(userId, id);
  const bytes = await storage.read(row.letterStorageKey);
  if (!bytes) throw new HttpError(404, "The letter file is missing.");
  return { bytes, fileName: row.letterFileName };
}

// ── Staff: the workflow ───────────────────────────────────────────────────────

export async function forward(userId: string, id: string, input: ForwardExternalRequestInput): Promise<ExternalRequestDto> {
  if (!(await isAvp(userId))) throw new HttpError(403, "Only the Academic Vice President's office forwards external requests.");
  const row = await prisma.externalRequest.findUnique({ where: { id }, include: { assignments: true } });
  if (!row) throw new HttpError(404, "Request not found");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(row.status)) throw new HttpError(409, "This request is past review.");
  const nodes = await prisma.orgNode.findMany({ where: { id: { in: [...new Set(input.orgNodeIds)] }, active: true }, include: { user: { select: { email: true } } } });
  if (nodes.length !== new Set(input.orgNodeIds).size) throw new HttpError(400, "Choose active departments.");
  const fresh = nodes.filter((n) => !row.assignments.some((a) => a.orgNodeId === n.id));
  if (!fresh.length) throw new HttpError(400, "It has already been sent to every department chosen.");

  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequestAssignment.createMany({ data: fresh.map((n) => ({ requestId: id, orgNodeId: n.id })) });
    await tx.externalRequest.update({ where: { id }, data: { status: "UNDER_REVIEW" } });
    await event(tx, id, actor, "FORWARDED", input.note, { departments: fresh.map((n) => n.name) });
  });
  for (const n of fresh) {
    await mailStaff(
      n.user?.email,
      `External request ${row.reference} needs ${n.name}`,
      [`${esc(row.organizationName)} has asked for resources. Please check feasibility with your lab custodians, have them hold the slots on their calendars, and accept with a pricing sheet link — or decline.`, input.note ? `Note: ${esc(input.note)}` : ""].filter(Boolean),
      "/external-requests",
    );
  }
  return getForActor(userId, id);
}

/** A custodian holding a slot for this request on a room they keep. The room must
 *  belong to a department the request was sent to (and didn't decline). */
export async function placeHold(userId: string, id: string, input: PlaceHoldInput): Promise<ExternalRequestDto> {
  const row = await prisma.externalRequest.findUnique({ where: { id }, include: { assignments: true, windows: true } });
  if (!row) throw new HttpError(404, "Request not found");
  if (!HOLDABLE.includes(row.status)) throw new HttpError(409, "Slots can only be held while a request is under review, quoted or paid but not yet confirmed.");
  // F-055 of the 2026-09-15 campaign: placeHold never checked the slot against the
  // request's own ExternalRequestWindow rows — a custodian could hold any date at
  // all, unrelated to anything the requester actually asked for (the campaign's own
  // example: a hold on a date four months later, for a request whose only window
  // was a single hour on a specific day). Checked by DATE, not by exact time range:
  // a REPLACEMENT hold (this request's original slot was lost to a conflict, see
  // the PAYABLE branch just below) legitimately needs a different hour on the same
  // day the request actually asked about, which this must keep allowing.
  const onARequestedDate = row.windows.some((w) => civilDateOf(w.date) === input.date);
  if (!onARequestedDate) {
    throw new HttpError(400, "That date isn't one this request asked for.");
  }
  const target = await resolveBookingTarget(prisma, input.itemIds);
  const viewer = await viewerOf(userId);
  if (!decidesFor(viewer, target.lab.id)) throw new HttpError(403, "Only the room's custodian holds slots on its calendar.");
  const lab = await prisma.item.findUniqueOrThrow({ where: { id: target.lab.id }, select: { ownerOrgNodeId: true, currentOrgNodeId: true } });
  const assigned = row.assignments.filter((a) => a.status !== "DECLINED").map((a) => a.orgNodeId);
  if (!assigned.includes(lab.ownerOrgNodeId) && !assigned.includes(lab.currentOrgNodeId)) throw new HttpError(403, "This room's department was not asked to handle this request.");

  // Before a quote, a hold lasts two weeks (the head or AVP can extend it); once quoted,
  // it lasts exactly as long as the payment deadline. A replacement hold on a paid
  // request (its first slot was lost) gets the two weeks the AVP needs to confirm it.
  const twoWeeks = civilToInstant(addDays(todayCivil(), HOLD_DAYS_BEFORE_QUOTE), "23:59");
  const holdExpiresAt = PAYABLE.includes(row.status) && row.paymentDeadline && row.paymentDeadline > new Date() ? row.paymentDeadline : twoWeeks;
  await writeReservation(target, input, {
    source: "EXTERNAL",
    state: "HELD",
    title: `${row.reference} · ${row.organizationName}`,
    requestedById: userId,
    decidedById: userId,
    externalRequestId: id,
    holdExpiresAt,
  });
  await event(prisma, id, await actorOf(userId), "HOLD_PLACED", `${target.lab.name} · ${input.date} ${input.start}–${input.end}`);
  return getForActor(userId, id);
}

function todayCivil(): string {
  return instantToCivil(new Date(), DEFAULT_TIME_ZONE).date;
}

export async function extendHolds(userId: string, id: string, until: string): Promise<ExternalRequestDto> {
  const { row, access } = await loadForActor(userId, id);
  if (!access.avp && !row.assignments.some((a) => access.headOf.has(a.orgNodeId))) throw new HttpError(403, "Only the AVP's office or an assigned head may extend holds.");
  if (!HOLDABLE.includes(row.status)) throw new HttpError(409, "This request has no holds to extend.");
  if (!isCivilDate(until) || until <= todayCivil()) throw new HttpError(400, "Choose a future date.");
  const at = civilToInstant(until, "23:59");

  // F-056 of the 2026-09-15 campaign: extendHolds only checked the date was in the
  // future, not that it was bounded by anything — a slot could be tied up
  // indefinitely against a quote that will expire. The ceiling mirrors placeHold's
  // own (the same rule, not a second one): a payment deadline still ahead of us
  // caps it there; otherwise the same two-week horizon a fresh hold gets.
  const twoWeeks = civilToInstant(addDays(todayCivil(), HOLD_DAYS_BEFORE_QUOTE), "23:59");
  const ceiling = PAYABLE.includes(row.status) && row.paymentDeadline && row.paymentDeadline > new Date() ? row.paymentDeadline : twoWeeks;
  if (at.getTime() > ceiling.getTime()) {
    throw new HttpError(400, `Holds cannot be extended past ${instantToCivil(ceiling, DEFAULT_TIME_ZONE).date} for this request.`);
  }
  const updated = await prisma.reservation.updateMany({ where: { externalRequestId: id, state: "HELD" }, data: { holdExpiresAt: at } });
  await event(prisma, id, await actorOf(userId), "HOLDS_EXTENDED", `${updated.count} hold${updated.count === 1 ? "" : "s"} until ${until}`);
  return getForActor(userId, id);
}

export async function decideAssignment(userId: string, assignmentId: string, input: DecideAssignmentInput): Promise<ExternalRequestDto> {
  const assignment = await prisma.externalRequestAssignment.findUnique({ where: { id: assignmentId }, include: { orgNode: true, request: true } });
  if (!assignment) throw new HttpError(404, "Assignment not found");
  const sysAdmin = await scope.isSysAdmin(userId);
  if (assignment.orgNode.userId !== userId && !sysAdmin) throw new HttpError(403, `Only the head of ${assignment.orgNode.name} answers for it.`);
  if (assignment.request.status !== "UNDER_REVIEW") throw new HttpError(409, "This request is no longer under review.");
  if (assignment.status !== "PENDING") throw new HttpError(409, "This department has already answered.");

  if (input.decision === "ACCEPT") {
    if (!input.sheetUrl) throw new HttpError(400, "Accepting needs the link to your pricing breakdown sheet.");
    if (!/^https:\/\//i.test(input.sheetUrl)) throw new HttpError(400, "The pricing sheet link must start with https://");
    if (input.amountSantim === undefined) throw new HttpError(400, "Accepting needs your department's amount.");
    const holds = await prisma.reservation.count({
      where: { externalRequestId: assignment.requestId, state: "HELD", lab: { OR: [{ ownerOrgNodeId: assignment.orgNodeId }, { currentOrgNodeId: assignment.orgNodeId }] } },
    });
    if (!holds && !input.noCalendarNeeded) throw new HttpError(400, "No slot is held on any of your department's calendars yet. Have a custodian hold the slots first, or confirm nothing needs a calendar (e.g. consumables only).");
  }

  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequestAssignment.update({
      where: { id: assignmentId },
      data: {
        status: input.decision === "ACCEPT" ? "ACCEPTED" : "DECLINED",
        sheetUrl: input.decision === "ACCEPT" ? input.sheetUrl : null,
        amountSantim: input.decision === "ACCEPT" ? input.amountSantim : null,
        noCalendarNeeded: input.decision === "ACCEPT" ? Boolean(input.noCalendarNeeded) : false,
        note: input.note || null,
        decidedById: userId,
        decidedAt: new Date(),
      },
    });
    if (input.decision === "DECLINE") await releaseHolds(tx, assignment.requestId, "CANCELLED", [assignment.orgNodeId]);
    await event(tx, assignment.requestId, actor, input.decision === "ACCEPT" ? "DEPARTMENT_ACCEPTED" : "DEPARTMENT_DECLINED", [assignment.orgNode.name, input.amountSantim !== undefined && input.decision === "ACCEPT" ? etb(input.amountSantim) : null, input.note].filter(Boolean).join(" · "));
  });

  const avp = await avpUserId();
  if (avp && avp !== userId) {
    const to = await prisma.user.findUnique({ where: { id: avp }, select: { email: true } });
    await mailStaff(to?.email, `${assignment.orgNode.name} ${input.decision === "ACCEPT" ? "accepted" : "declined"} ${assignment.request.reference}`, [input.note ? esc(input.note) : "No note."], "/external-requests");
  }
  return getForActor(userId, assignment.requestId);
}

export async function sendQuote(userId: string, id: string, input: SendQuoteInput): Promise<ExternalRequestDto> {
  if (!(await isAvp(userId))) throw new HttpError(403, "Only the Academic Vice President's office sends quotes.");
  const row = await prisma.externalRequest.findUnique({ where: { id }, include: { assignments: true } });
  if (!row) throw new HttpError(404, "Request not found");
  if (row.status !== "UNDER_REVIEW") throw new HttpError(409, "Only a request under review can be quoted.");
  if (!row.assignments.length || row.assignments.some((a) => a.status === "PENDING")) throw new HttpError(409, "Every department it was sent to must answer first.");
  if (!row.assignments.some((a) => a.status === "ACCEPTED")) throw new HttpError(409, "No department accepted — decline the request instead.");
  if (!isCivilDate(input.paymentDeadline) || input.paymentDeadline <= todayCivil()) throw new HttpError(400, "The payment deadline must be a future date.");

  const deadline = civilToInstant(input.paymentDeadline, "23:59");
  const token = generateToken();
  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequest.update({
      where: { id },
      data: { status: "QUOTED", quoteAmountSantim: input.amountSantim, quoteNote: input.note || null, quoteSentAt: new Date(), paymentDeadline: deadline, trackingTokenHash: hashToken(token) },
    });
    await tx.reservation.updateMany({ where: { externalRequestId: id, state: "HELD" }, data: { holdExpiresAt: deadline } });
    await event(tx, id, actor, "QUOTED", `${etb(input.amountSantim)}, payable by ${input.paymentDeadline}${input.note ? ` — ${input.note}` : ""}`);
  });

  const bank = bankDetails();
  const sheets = row.assignments.filter((a) => a.status === "ACCEPTED" && a.sheetUrl).map((a) => `<a href="${esc(a.sheetUrl)}">${esc(a.sheetUrl)}</a>`);
  await mailRequester(
    row.contactEmail,
    `Quote for request ${row.reference}`,
    [
      `Dear ${esc(row.contactName)},`,
      `The university can provide what ${esc(row.organizationName)} asked for. The total is <strong>${esc(etb(input.amountSantim))}</strong>, payable by ${esc(input.paymentDeadline)}. The requested slots are held for you until then.`,
      sheets.length ? `Pricing breakdown: ${sheets.join(", ")}` : "",
      bank ? `Pay into ${esc(bank.bankName)}, account ${esc(bank.accountNumber)} (${esc(bank.accountName)}), then confirm your payment reference on the tracking page.` : "The payment account details will be given on the tracking page.",
      input.note ? esc(input.note) : "",
      "This link replaces any earlier one we sent you.",
    ].filter(Boolean),
    { href: trackingUrl(token), label: `View the quote and confirm payment` },
  );
  return getForActor(userId, id);
}

export async function closeRequest(userId: string, id: string, input: CloseExternalRequestInput): Promise<ExternalRequestDto> {
  if (!(await isAvp(userId))) throw new HttpError(403, "Only the Academic Vice President's office declines external requests.");
  const row = await prisma.externalRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Request not found");
  if (!OPEN_STATUSES.includes(row.status)) throw new HttpError(409, "This request is already closed.");
  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await releaseHolds(tx, id, "CANCELLED");
    await tx.externalRequest.update({ where: { id }, data: { status: "DECLINED", closingNote: input.note } });
    await event(tx, id, actor, "DECLINED", input.note);
  });
  const refundNote = row.status === "PAID" || row.status === "PAYMENT_SUBMITTED" ? "The university's office will contact you about returning your payment." : "";
  await mailRequester(row.contactEmail, `Request ${row.reference}`, [`Dear ${esc(row.contactName)},`, `We are unable to provide what ${esc(row.organizationName)} asked for.`, esc(input.note), refundNote].filter(Boolean));
  return getForActor(userId, id);
}

/** Quotes past their payment deadline expire, releasing their holds. Run by the cron
 *  route; idempotent. Returns how many requests it closed. */
export async function expireOverdueQuotes(): Promise<number> {
  // PAYMENT_SUBMITTED is left alone: a person still owes the requester a decision.
  const overdue = await prisma.externalRequest.findMany({
    where: { status: "QUOTED", paymentDeadline: { lt: new Date() } },
    select: { id: true, reference: true, contactEmail: true, contactName: true, payments: { select: { status: true, amountSantim: true } } },
  });
  for (const r of overdue) {
    await prisma.$transaction(async (tx) => {
      await releaseHolds(tx, r.id, "EXPIRED");
      await tx.externalRequest.update({ where: { id: r.id }, data: { status: "EXPIRED", closingNote: "The quote expired unpaid." } });
      await event(tx, r.id, { id: null, label: "System" }, "EXPIRED");
    });
    await mailRequester(r.contactEmail, `Request ${r.reference} expired`, [`Dear ${esc(r.contactName)},`, "The payment deadline for this quote has passed, so the held slots have been released. You are welcome to submit a new request.", paidSantimOf(r.payments) > 0 ? `We received ${esc(etb(paidSantimOf(r.payments)))} towards it; the university's office will contact you about returning it.` : ""].filter(Boolean));
  }
  return overdue.length;
}

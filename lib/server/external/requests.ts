import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type ExternalAssignmentStatus, type ExternalRequestStatus } from "@prisma/client";
import type {
  AssignCustodiansInput,
  CloseExternalRequestInput,
  DeclineAssignmentInput,
  ExternalContactDto,
  ExternalRequestDto,
  ExternalRequestSummaryDto,
  FinishTaskInput,
  ForwardExternalRequestInput,
  PlaceHoldInput,
  PublicTrackingDto,
  RequesterRequestSummaryDto,
  ReservationDto,
  ReviewAssignmentInput,
  SendQuoteInput,
  SubmitCollegeInput,
  SubmitDepartmentInput,
  SubmitExternalRequestInput,
  SubmitExternalRequestResultDto,
} from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { storage } from "../resources/storage";
import * as scope from "../resources/scope";
import { DEFAULT_TIME_ZONE, addDays, civilToInstant, instantToCivil, isCivilDate, minutesOf } from "@/lib/domain/civil-time";
import { RESERVATION_INCLUDE, civilDateOf, dateColumn, decidesFor, resolveBookingTarget, subtreeRows, toReservationDto, viewerOf } from "../scheduling/context";
import { equipmentOf, writeReservation } from "../scheduling/reservations";
import { esc, etb, mailRequester, mailStaff, portalUrl } from "./mail";
import { PROVIDER_INPUT } from "@/lib/domain/payment-receipt";
import { enabledProviders } from "../payments/config";
import { paths } from "@/lib/paths";

/**
 * External requests — Track 7, reworked 2026-09-28 to the university's own line of
 * communication:
 *
 *   an outside requester (an EXTERNAL account) asks ─▶ the AVP forwards it to colleges
 *   ─▶ each dean forwards it to departments ─▶ each head asks custodians (tasks) ─▶ the
 *   custodians hold rooms or machines and report back ─▶ the head submits the booked
 *   rooms, the cost breakdown and the contact persons ─▶ the dean approves each
 *   department and submits the college ─▶ the AVP approves each college and sends one
 *   quote with the university's bank details ─▶ the requester pays (verify-api, or a
 *   person checks it) ─▶ the AVP confirms the payment, which confirms the bookings and
 *   shows the requester the contact persons. Everything after that is offline.
 *
 * A request is FACILITY (rooms or labs) or SAMPLE_ANALYSIS (samples run on a machine,
 * for a report) — the same line; a custodian holds a machine instead of a room.
 *
 * The AVP is the live occupant of the UNIVERSITY-kind root, plus SYS_ADMIN; a dean or
 * head is the live occupant of their node, never frozen onto the assignment. Holds are
 * ordinary reservations written through the scheduling write path, so they genuinely
 * block the calendar.
 */

export const MAX_LETTER_BYTES = 4 * 1024 * 1024;
const HOLD_DAYS_BEFORE_QUOTE = 14;
const PER_REQUESTER_PER_DAY = 3;
const PER_IP_PER_DAY = 10;
const OPEN_STATUSES: ExternalRequestStatus[] = ["SUBMITTED", "UNDER_REVIEW", "QUOTED", "PAYMENT_SUBMITTED", "PAID"];
/** A custodian may (re)hold slots while the request is live and not yet on the calendar. */
const HOLDABLE: ExternalRequestStatus[] = ["UNDER_REVIEW", "QUOTED", "PAYMENT_SUBMITTED", "PAID"];
export const PAYABLE: ExternalRequestStatus[] = ["QUOTED", "PAYMENT_SUBMITTED"];
export const COUNTED_PAYMENTS = ["VERIFIED", "MANUAL_VERIFIED"] as const;
/** A unit still working on its answer. */
const WORKING: ExternalAssignmentStatus[] = ["PENDING", "FORWARDED", "RETURNED"];
/** A unit's answer the level above has accepted (ACCEPTED: a pre-2026-09-28 department). */
const APPROVED: ExternalAssignmentStatus[] = ["APPROVED", "ACCEPTED"];

type Line = { description: string; quantity: number; categoryName: string | null };
type Sample = { sampleCount: number; analysis: string; categoryId: string | null; categoryName: string | null };

export function bankDetails() {
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

function todayCivil(): string {
  return instantToCivil(new Date(), DEFAULT_TIME_ZONE).date;
}

async function emailOf(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  return (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null;
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

interface Access {
  userId: string;
  avp: boolean;
  sysAdmin: boolean;
  /** Nodes the viewer occupies — the colleges they are dean of, the departments they head. */
  occupies: Set<string>;
}

async function accessFor(userId: string): Promise<Access> {
  const [avp, sysAdmin, occupied] = await Promise.all([isAvp(userId), scope.isSysAdmin(userId), prisma.orgNode.findMany({ where: { userId, active: true }, select: { id: true } })]);
  return { userId, avp, sysAdmin, occupies: new Set(occupied.map((n) => n.id)) };
}

const leads = (access: Access, nodeId: string) => access.sysAdmin || access.occupies.has(nodeId);

const requestInclude = {
  windows: { orderBy: { sortOrder: "asc" } },
  events: { orderBy: { at: "asc" } },
  assignments: {
    include: {
      orgNode: { select: { name: true, userId: true, user: { select: { name: true, email: true } } } },
      decidedBy: { select: { name: true } },
      tasks: { include: { custodian: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  },
  payments: { include: { reviewedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.ExternalRequestInclude;

type RequestRow = Prisma.ExternalRequestGetPayload<{ include: typeof requestInclude }>;
type AssignmentRow = RequestRow["assignments"][number];

type Role = "AVP" | "DEAN" | "HEAD" | "CUSTODIAN";

function roleOn(access: Access, row: { assignments: Array<{ orgNodeId: string; level: string; parentId: string | null; tasks: Array<{ custodianId: string }> }> }): Role | null {
  if (access.avp) return "AVP";
  if (row.assignments.some((a) => a.level === "COLLEGE" && access.occupies.has(a.orgNodeId))) return "DEAN";
  if (row.assignments.some((a) => a.level === "DEPARTMENT" && access.occupies.has(a.orgNodeId))) return "HEAD";
  if (row.assignments.some((a) => a.tasks.some((t) => t.custodianId === access.userId))) return "CUSTODIAN";
  return null;
}

async function loadRow(id: string): Promise<RequestRow> {
  const row = await prisma.externalRequest.findUnique({ where: { id }, include: requestInclude });
  if (!row) throw new HttpError(404, "Request not found");
  return row;
}

async function loadForActor(userId: string, id: string) {
  const row = await loadRow(id);
  const access = await accessFor(userId);
  const role = roleOn(access, row);
  if (!role) throw new HttpError(404, "Request not found");
  return { row, access, role };
}

function assertUnderReview(row: { status: ExternalRequestStatus }) {
  if (row.status !== "UNDER_REVIEW") throw new HttpError(409, "This request is no longer being reviewed.");
}

async function loadAssignment(id: string) {
  const assignment = await prisma.externalRequestAssignment.findUnique({
    where: { id },
    include: { orgNode: { select: { name: true, userId: true } }, request: true, parent: { include: { orgNode: { select: { name: true, userId: true } } } }, children: true, tasks: true },
  });
  if (!assignment) throw new HttpError(404, "Assignment not found");
  return assignment;
}

// ── The requester: submit, follow, cancel ────────────────────────────────────

export async function submitRequest(
  requesterId: string,
  input: SubmitExternalRequestInput,
  letter: { bytes: Buffer; fileName: string },
  ipHash: string | null,
): Promise<SubmitExternalRequestResultDto> {
  if (input.website) throw new HttpError(400, "Your request could not be accepted.");
  const requester = await prisma.user.findUnique({ where: { id: requesterId }, include: { roles: true } });
  if (!requester || requester.status !== "ACTIVE" || !requester.roles.some((r) => r.kind === "EXTERNAL")) throw new HttpError(403, "Sign in with your requester account to send a request.");
  if (letter.bytes.length > MAX_LETTER_BYTES) throw new HttpError(400, "The letter must be a PDF of at most 4 MB.");
  if (!isPdf(letter.bytes)) throw new HttpError(400, "The official letter must be a PDF file.");
  if (input.kind === "FACILITY" && !input.lines.length) throw new HttpError(400, "List at least one thing you need.");
  if (input.kind === "SAMPLE_ANALYSIS" && !input.sample) throw new HttpError(400, "Describe your samples and the analysis you need.");

  const since = new Date(Date.now() - 86_400_000);
  const [mine, byIp] = await Promise.all([
    prisma.externalRequest.count({ where: { requesterId, createdAt: { gte: since } } }),
    ipHash ? prisma.externalRequest.count({ where: { submitterIpHash: ipHash, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  if (mine >= PER_REQUESTER_PER_DAY || byIp >= PER_IP_PER_DAY) {
    throw new HttpError(429, "Too many requests have been sent from here today. Please try again tomorrow, or contact the university directly.");
  }

  const now = Date.now();
  const windows = input.windows.map((w, i) => {
    if (!isCivilDate(w.date)) throw new HttpError(400, "One of the dates is not a real date.");
    if (minutesOf(w.end) <= minutesOf(w.start)) throw new HttpError(400, `On ${w.date}, the end time must be after the start time.`);
    const startsAt = civilToInstant(w.date, w.start, DEFAULT_TIME_ZONE);
    if (startsAt.getTime() < now + 86_400_000) throw new HttpError(400, `${w.date} is too soon. Ask for dates at least a day ahead.`);
    return { date: dateColumn(w.date), startTimeLocal: w.start, endTimeLocal: w.end, startsAt, endsAt: civilToInstant(w.date, w.end, DEFAULT_TIME_ZONE), sortOrder: i };
  });

  const categoryIds = [...input.lines.map((l) => l.categoryId), input.sample?.categoryId].filter((id): id is string => Boolean(id));
  const categories = categoryIds.length ? await prisma.resourceCategory.findMany({ where: { id: { in: categoryIds }, publicListed: true }, select: { id: true, name: true } }) : [];
  const nameOf = (id: string | undefined) => categories.find((c) => c.id === id)?.name ?? null;
  const lines: Line[] = input.lines.map((l) => ({ description: l.description, quantity: l.quantity, categoryName: nameOf(l.categoryId) }));
  const sample: Sample | null =
    input.kind === "SAMPLE_ANALYSIS" && input.sample
      ? { sampleCount: input.sample.sampleCount, analysis: input.sample.analysis, categoryId: nameOf(input.sample.categoryId) ? input.sample.categoryId! : null, categoryName: nameOf(input.sample.categoryId) }
      : null;

  const storageKey = `ext-letter-${randomUUID()}`;
  await storage.write(storageKey, letter.bytes);

  let created = { id: "", reference: "" };
  try {
    // Two submissions in the same instant can compute the same next reference; the
    // unique index refuses the second, which simply takes the next number.
    for (let attempt = 0; ; attempt++) {
      try {
        created = await prisma.$transaction(async (tx) => {
          const reference = await nextReference(tx);
          const row = await tx.externalRequest.create({
            data: {
              reference,
              kind: input.kind,
              requesterId,
              sample: sample ? (sample as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
              organizationName: input.organizationName,
              contactName: input.contactName,
              contactEmail: input.contactEmail.toLowerCase(),
              contactPhone: input.contactPhone,
              purpose: input.purpose,
              lines: lines as unknown as Prisma.InputJsonValue,
              letterStorageKey: storageKey,
              letterFileName: letter.fileName.slice(0, 200) || "letter.pdf",
              letterByteSize: letter.bytes.length,
              submitterIpHash: ipHash,
              windows: { create: windows },
            },
          });
          await tx.externalRequestEvent.create({ data: { requestId: row.id, actorLabel: "Requester", kind: "SUBMITTED" } });
          return { id: row.id, reference };
        });
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

  await mailRequester(
    requester.email,
    `Request ${created.reference} received`,
    [
      `Dear ${esc(requester.name)},`,
      `We have received ${esc(input.organizationName)}'s request (${esc(created.reference)}). The Academic Vice President's office will review it with the colleges and departments concerned and send you a quote.`,
      "Sign in to the portal to follow it, see the quote and confirm your payment.",
    ],
    { href: portalUrl(created.id), label: `Follow request ${created.reference}` },
  );
  await mailStaff(await emailOf(await avpUserId()), `New external request ${created.reference}`, [`${esc(input.organizationName)} has asked for ${input.kind === "SAMPLE_ANALYSIS" ? "a sample analysis" : "university resources"}: ${esc(input.purpose.slice(0, 300))}`], paths.outside(created.id));
  return created;
}

const PUBLIC_EVENT_LABEL: Record<string, string> = {
  SUBMITTED: "Request received",
  FORWARDED: "Sent to the colleges concerned",
  QUOTED: "Quote sent",
  PAYMENT_SUBMITTED: "Payment submitted for checking",
  PAYMENT_VERIFIED: "Payment received",
  PAYMENT_REJECTED: "Payment could not be verified",
  SCHEDULED: "Payment confirmed: booking confirmed",
  DECLINED: "Request declined",
  CANCELLED: "Request cancelled",
  EXPIRED: "Quote expired unpaid",
};

function windowsOf(rows: Array<{ date: Date; startTimeLocal: string; endTimeLocal: string }>) {
  return rows.map((w) => ({ date: civilDateOf(w.date), start: w.startTimeLocal, end: w.endTimeLocal }));
}

function sampleOf(row: { sample: Prisma.JsonValue }): { sampleCount: number; analysis: string; categoryName: string | null } | null {
  const s = row.sample as Sample | null;
  return s ? { sampleCount: s.sampleCount, analysis: s.analysis, categoryName: s.categoryName } : null;
}

function contactsOf(a: { contacts: Prisma.JsonValue }): ExternalContactDto[] {
  return Array.isArray(a.contacts) ? (a.contacts as unknown as ExternalContactDto[]) : [];
}

/** Departments whose answer made it into the quote: approved by their dean, whose
 *  college the AVP approved — or a pre-2026-09-28 department the AVP forwarded to directly. */
function quotedDepartments(row: { assignments: Array<{ id: string; level: string; parentId: string | null; status: ExternalAssignmentStatus }> }) {
  const byId = new Map(row.assignments.map((a) => [a.id, a]));
  return row.assignments.filter((a) => {
    if (a.level !== "DEPARTMENT" || !APPROVED.includes(a.status)) return false;
    if (!a.parentId) return true;
    const parent = byId.get(a.parentId);
    return !!parent && APPROVED.includes(parent.status);
  });
}

/** What the requester sees of their own request. */
export async function requesterView(id: string): Promise<PublicTrackingDto> {
  const row = await loadRow(id);
  const quoted = row.quoteAmountSantim !== null && row.quoteSentAt !== null;
  const departments = quotedDepartments(row) as AssignmentRow[];
  const bookings = await prisma.reservation.findMany({
    where: { externalRequestId: id, state: { in: ["HELD", "CONFIRMED"] } },
    include: { lab: { select: { name: true } }, resources: { include: { item: { select: { name: true, id: true } } } } },
    orderBy: { startsAt: "asc" },
  });
  const revealed = row.contactsRevealedAt !== null;
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    kind: row.kind,
    sample: sampleOf(row),
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
          sheetUrls: departments.filter((a) => a.sheetUrl).map((a) => a.sheetUrl!),
          breakdown: departments.map((a) => ({ departmentName: a.orgNode.name, amountSantim: a.amountSantim ?? 0, sheetUrl: a.sheetUrl })),
          paymentDeadline: row.paymentDeadline?.toISOString() ?? null,
          bank: bankDetails(),
        }
      : null,
    timeline: row.events.filter((e) => PUBLIC_EVENT_LABEL[e.kind]).map((e) => ({ at: e.at.toISOString(), label: PUBLIC_EVENT_LABEL[e.kind], note: ["DECLINED", "PAYMENT_REJECTED", "PAYMENT_VERIFIED", "PAYMENT_SUBMITTED", "QUOTED"].includes(e.kind) ? e.note : null })),
    closingNote: row.closingNote,
    canCancel: cancellable(row),
    // Held slots are shown once there is a quote to pay for; before that they may still change.
    bookings: quoted
      ? bookings.map((b) => {
          const s = instantToCivil(b.startsAt, DEFAULT_TIME_ZONE);
          const machines = b.resources.filter((r) => r.item.id !== b.labItemId).map((r) => r.item.name);
          return { place: machines.length ? `${machines.join(", ")}: ${b.lab.name}` : b.lab.name, date: s.date, start: s.time, end: instantToCivil(b.endsAt, DEFAULT_TIME_ZONE).time, confirmed: b.state === "CONFIRMED" };
        })
      : [],
    contacts: revealed ? departments.map((a) => ({ departmentName: a.orgNode.name, people: contactsOf(a) })).filter((c) => c.people.length) : [],
    payment: quoted
      ? {
          providers: enabledProviders().map((pid) => ({ id: pid, ...PROVIDER_INPUT[pid] })),
          paidSantim: paidSantimOf(row.payments),
          pendingCount: row.payments.filter((p) => p.status === "PENDING_REVIEW").length,
          canSubmit: PAYABLE.includes(row.status) && (!row.paymentDeadline || row.paymentDeadline.getTime() > Date.now()),
          attempts: row.payments.map((p) => ({ provider: p.provider, reference: p.reference, status: p.status, amountSantim: p.amountSantim, reason: p.reason, createdAt: p.createdAt.toISOString() })),
        }
      : null,
  };
}

/** 404 unless it is the requester's own. */
export async function assertOwnRequest(userId: string, id: string): Promise<void> {
  const row = await prisma.externalRequest.findUnique({ where: { id }, select: { requesterId: true } });
  if (!row || row.requesterId !== userId) throw new HttpError(404, "Request not found");
}

export async function listForRequester(userId: string): Promise<RequesterRequestSummaryDto[]> {
  const rows = await prisma.externalRequest.findMany({ where: { requesterId: userId }, include: { windows: { orderBy: { sortOrder: "asc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => ({ id: r.id, reference: r.reference, status: r.status, kind: r.kind, createdAt: r.createdAt.toISOString(), purpose: r.purpose, firstWindow: r.windows[0] ? windowsOf([r.windows[0]])[0] : null }));
}

export async function viewForRequester(userId: string, id: string): Promise<PublicTrackingDto> {
  await assertOwnRequest(userId, id);
  return requesterView(id);
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

export async function cancelForRequester(userId: string, id: string): Promise<PublicTrackingDto> {
  await assertOwnRequest(userId, id);
  const row = await loadRow(id);
  if (!cancellable(row)) throw new HttpError(409, "This request can no longer be cancelled here. Contact the university.");
  await prisma.$transaction(async (tx) => {
    await releaseHolds(tx, row.id, "CANCELLED");
    await tx.externalRequest.update({ where: { id: row.id }, data: { status: "CANCELLED", closingNote: "Cancelled by the requester." } });
    await event(tx, row.id, { id: null, label: "Requester" }, "CANCELLED");
  });
  return requesterView(id);
}

// ── Staff: list and detail ────────────────────────────────────────────────────

/** Is something on this request waiting on the viewer right now? */
function waitingOn(access: Access, row: RequestRow): boolean {
  if (access.avp) {
    if (row.status === "SUBMITTED" || row.status === "PAID" || row.payments.some((p) => p.status === "PENDING_REVIEW")) return true;
    return row.assignments.some((a) => a.level === "COLLEGE" && a.status === "SUBMITTED") || (row.status === "UNDER_REVIEW" && canQuote(row));
  }
  if (row.status !== "UNDER_REVIEW") return false;
  return row.assignments.some((a) => {
    if (a.level === "COLLEGE" && access.occupies.has(a.orgNodeId)) {
      return a.status === "PENDING" || row.assignments.some((d) => d.parentId === a.id && d.status === "SUBMITTED") || (WORKING.includes(a.status) && collegeReady(row, a));
    }
    if (a.level === "DEPARTMENT" && access.occupies.has(a.orgNodeId)) return a.status === "PENDING" || a.status === "RETURNED" || (a.status === "FORWARDED" && a.tasks.every((t) => t.status !== "PENDING"));
    return a.tasks.some((t) => t.custodianId === access.userId && t.status === "PENDING" && WORKING.includes(a.status));
  });
}

export async function listForActor(userId: string): Promise<ExternalRequestSummaryDto[]> {
  const access = await accessFor(userId);
  const nodeIds = [...access.occupies];
  const rows = await prisma.externalRequest.findMany({
    where: access.avp ? {} : { assignments: { some: { OR: [{ orgNodeId: { in: nodeIds } }, { tasks: { some: { custodianId: userId } } }] } } },
    include: requestInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => {
    const departments = r.assignments.filter((a) => a.level === "DEPARTMENT");
    return {
      id: r.id,
      reference: r.reference,
      status: r.status,
      kind: r.kind,
      organizationName: r.organizationName,
      createdAt: r.createdAt.toISOString(),
      firstWindow: r.windows[0] ? windowsOf([r.windows[0]])[0] : null,
      windowCount: r.windows.length,
      assignmentCount: departments.length,
      acceptedCount: departments.filter((a) => APPROVED.includes(a.status) || a.status === "SUBMITTED").length,
      role: roleOn(access, r) ?? "AVP",
      waitingOnMe: waitingOn(access, r),
    };
  });
}

/** Every department of this college has answered and been decided, at least one approved. */
function collegeReady(row: { assignments: Array<{ parentId: string | null; status: ExternalAssignmentStatus }> }, college: { id: string }): boolean {
  const children = row.assignments.filter((a) => a.parentId === college.id);
  return children.length > 0 && children.every((a) => APPROVED.includes(a.status) || a.status === "DECLINED") && children.some((a) => APPROVED.includes(a.status));
}

/** Every unit the AVP sent it to has answered and been decided, at least one approved. */
function canQuote(row: { assignments: Array<{ parentId: string | null; status: ExternalAssignmentStatus }> }): boolean {
  const top = row.assignments.filter((a) => a.parentId === null);
  return top.length > 0 && top.every((a) => APPROVED.includes(a.status) || a.status === "DECLINED") && top.some((a) => APPROVED.includes(a.status));
}

function assignmentCan(access: Access, row: RequestRow, a: AssignmentRow): ExternalRequestDto["assignments"][number]["can"] {
  const reviewing = row.status === "UNDER_REVIEW";
  const mine = leads(access, a.orgNodeId);
  if (a.level === "COLLEGE") {
    return {
      forward: reviewing && mine && WORKING.includes(a.status),
      assign: false,
      submit: reviewing && mine && WORKING.includes(a.status) && collegeReady(row, a),
      review: reviewing && access.avp && a.status === "SUBMITTED",
      decline: reviewing && mine && WORKING.includes(a.status),
    };
  }
  const parent = a.parentId ? row.assignments.find((p) => p.id === a.parentId) : null;
  return {
    forward: false,
    assign: reviewing && mine && WORKING.includes(a.status),
    submit: reviewing && mine && WORKING.includes(a.status) && a.tasks.every((t) => t.status !== "PENDING"),
    review: reviewing && !!parent && leads(access, parent.orgNodeId) && WORKING.includes(parent.status) && (a.status === "SUBMITTED" || a.status === "APPROVED"),
    decline: reviewing && mine && WORKING.includes(a.status),
  };
}

export async function getForActor(userId: string, id: string): Promise<ExternalRequestDto> {
  const { row, access, role } = await loadForActor(userId, id);
  const [holdRows, viewer] = await Promise.all([
    prisma.reservation.findMany({ where: { externalRequestId: id }, include: { ...RESERVATION_INCLUDE, lab: { select: { name: true, ownerOrgNodeId: true, currentOrgNodeId: true } } }, orderBy: { startsAt: "asc" } }),
    viewerOf(userId),
  ]);
  const liveHold = (h: (typeof holdRows)[number]) => h.state === "HELD" || h.state === "CONFIRMED";
  const inUnit = (h: (typeof holdRows)[number], nodeId: string) => h.lab.ownerOrgNodeId === nodeId || h.lab.currentOrgNodeId === nodeId;

  // Where the viewer may hold: rooms they keep in a department that asked them to.
  const taskUnits = row.assignments.filter((a) => a.level === "DEPARTMENT" && WORKING.includes(a.status) && a.tasks.some((t) => t.custodianId === userId && t.status !== "DECLINED")).map((a) => a.orgNodeId);
  const holdUnits = viewer.sysAdmin ? row.assignments.filter((a) => a.level === "DEPARTMENT" && a.status !== "DECLINED").map((a) => a.orgNodeId) : taskUnits;
  const custodyRooms =
    holdUnits.length && viewer.custody.size
      ? await prisma.item.findMany({
          where: { id: { in: [...viewer.custody] }, deletedAt: null, category: { bookingMode: "ROOM" }, OR: [{ ownerOrgNodeId: { in: holdUnits } }, { currentOrgNodeId: { in: holdUnits } }] },
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

  // Who the viewer may forward to: colleges (AVP), or the departments of a college they lead.
  const assigned = new Set(row.assignments.map((a) => a.orgNodeId));
  const forwardTargets: ExternalRequestDto["forwardTargets"] = [];
  if (access.avp && ["SUBMITTED", "UNDER_REVIEW"].includes(row.status)) {
    const colleges = await prisma.orgNode.findMany({ where: { kind: "COLLEGE", active: true }, select: { id: true, name: true, user: { select: { name: true } } }, orderBy: { name: "asc" } });
    forwardTargets.push(...colleges.filter((c) => !assigned.has(c.id)).map((c) => ({ id: c.id, name: c.name, headName: c.user?.name ?? null, parentAssignmentId: null })));
  }
  for (const college of row.assignments.filter((a) => a.level === "COLLEGE" && assignmentCan(access, row, a).forward)) {
    const departments = await prisma.orgNode.findMany({
      where: { kind: "DEPARTMENT", active: true, incomingEdges: { some: { parentId: college.orgNodeId } } },
      select: { id: true, name: true, user: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    forwardTargets.push(...departments.filter((d) => !assigned.has(d.id)).map((d) => ({ id: d.id, name: d.name, headName: d.user?.name ?? null, parentAssignmentId: college.id })));
  }

  // Custodians a head may ask: their department's own, and whoever keeps a bookable room
  // or machine the department owns.
  const custodians: ExternalRequestDto["custodians"] = [];
  for (const dept of row.assignments.filter((a) => a.level === "DEPARTMENT" && assignmentCan(access, row, a).assign)) {
    const keepers = await prisma.item.findMany({ where: { deletedAt: null, ownerOrgNodeId: dept.orgNodeId, category: { bookingMode: { in: ["ROOM", "EQUIPMENT"] } } }, select: { custodianId: true }, distinct: ["custodianId"] });
    const people = await prisma.user.findMany({
      where: { status: "ACTIVE", roles: { some: { kind: "CUSTODIAN" } }, OR: [{ homeNodeId: dept.orgNodeId }, { id: { in: keepers.map((k) => k.custodianId) } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    custodians.push(...people.filter((p) => !dept.tasks.some((t) => t.custodianId === p.id)).map((p) => ({ assignmentId: dept.id, id: p.id, name: p.name })));
  }

  const suggested = quotedDepartments(row).reduce((sum, a) => sum + ((a as AssignmentRow).amountSantim ?? 0), 0);
  const open = OPEN_STATUSES.includes(row.status);
  const holds: ReservationDto[] = holdRows.map((h) => toReservationDto(h as never, viewer));
  const leadsAny = row.assignments.some((a) => leads(access, a.orgNodeId));
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    kind: row.kind,
    sample: sampleOf(row),
    role,
    contactsRevealedAt: row.contactsRevealedAt?.toISOString() ?? null,
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
      level: a.level,
      parentId: a.parentId,
      orgNodeId: a.orgNodeId,
      orgNodeName: a.orgNode.name,
      headName: a.orgNode.user?.name ?? null,
      status: a.status,
      sheetUrl: a.sheetUrl,
      amountSantim: a.amountSantim,
      noCalendarNeeded: a.noCalendarNeeded,
      contacts: contactsOf(a),
      note: a.note,
      decidedByName: a.decidedBy?.name ?? null,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      holdCount: holdRows.filter((h) => liveHold(h) && (a.level === "DEPARTMENT" ? inUnit(h, a.orgNodeId) : row.assignments.some((d) => d.parentId === a.id && inUnit(h, d.orgNodeId)))).length,
      tasks: a.tasks.map((t) => ({
        id: t.id,
        custodianId: t.custodianId,
        custodianName: t.custodian.name,
        want: t.want,
        status: t.status,
        note: t.note,
        holdCount: holdRows.filter((h) => liveHold(h) && h.requestedById === t.custodianId && inUnit(h, a.orgNodeId)).length,
        mine: t.custodianId === userId && WORKING.includes(a.status) && row.status === "UNDER_REVIEW",
      })),
      can: assignmentCan(access, row, a),
    })),
    holds,
    // Payment receipts are the AVP's business; deans, heads and custodians see the total only.
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
          receiptUrl: receiptUrlOf(p.raw),
        }))
      : [],
    paidSantim: paidSantimOf(row.payments),
    events: row.events.map((e) => ({ at: e.at.toISOString(), actorLabel: e.actorLabel, kind: e.kind, note: e.note })),
    forwardTargets,
    custodians,
    suggestedQuoteSantim: suggested || null,
    holdRooms,
    can: {
      forward: access.avp && ["SUBMITTED", "UNDER_REVIEW"].includes(row.status),
      quote: access.avp && row.status === "UNDER_REVIEW" && canQuote(row),
      close: access.avp && open,
      placeHold: holdRooms.length > 0 && HOLDABLE.includes(row.status),
      extendHolds: (access.avp || leadsAny) && HOLDABLE.includes(row.status),
      confirm: access.avp && row.status === "PAID",
    },
  };
}

/** A link to the bank's own receipt, if the verifier's response carried one (any https
 *  URL among its top-level or `data` fields) — never built from a guessed template. */
function receiptUrlOf(raw: Prisma.JsonValue): string | null {
  const scan = (v: unknown): string | null => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    for (const value of Object.values(v as Record<string, unknown>)) if (typeof value === "string" && /^https:\/\/\S+$/i.test(value)) return value;
    return null;
  };
  return scan(raw) ?? scan((raw as Record<string, unknown> | null)?.data);
}

export async function letterFor(userId: string, id: string): Promise<{ bytes: Buffer; fileName: string }> {
  const { row } = await loadForActor(userId, id);
  const bytes = await storage.read(row.letterStorageKey);
  if (!bytes) throw new HttpError(404, "The letter file is missing.");
  return { bytes, fileName: row.letterFileName };
}

// ── Down the line: AVP → deans → heads → custodians ──────────────────────────

/** The AVP sends the request to the colleges that can host it. */
export async function forward(userId: string, id: string, input: ForwardExternalRequestInput): Promise<ExternalRequestDto> {
  if (!(await isAvp(userId))) throw new HttpError(403, "Only the Academic Vice President's office forwards external requests to colleges.");
  const row = await prisma.externalRequest.findUnique({ where: { id }, include: { assignments: true } });
  if (!row) throw new HttpError(404, "Request not found");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(row.status)) throw new HttpError(409, "This request is past review.");
  const ids = [...new Set(input.orgNodeIds)];
  const nodes = await prisma.orgNode.findMany({ where: { id: { in: ids }, active: true, kind: "COLLEGE" }, include: { user: { select: { email: true } } } });
  if (nodes.length !== ids.length) throw new HttpError(400, "Choose active colleges. Each dean sends it on to their departments.");
  const fresh = nodes.filter((n) => !row.assignments.some((a) => a.orgNodeId === n.id));
  if (!fresh.length) throw new HttpError(400, "It has already been sent to every college chosen.");

  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequestAssignment.createMany({ data: fresh.map((n) => ({ requestId: id, orgNodeId: n.id, level: "COLLEGE" as const })) });
    await tx.externalRequest.update({ where: { id }, data: { status: "UNDER_REVIEW" } });
    await event(tx, id, actor, "FORWARDED", input.note, { colleges: fresh.map((n) => n.name) });
  });
  for (const n of fresh) {
    await mailStaff(
      n.user?.email,
      `External request ${row.reference} for ${n.name}`,
      [`${esc(row.organizationName)} has asked the university for ${row.kind === "SAMPLE_ANALYSIS" ? "a sample analysis on a machine" : "rooms or labs"}. Send it on to the departments of your college that can host it, or decline it for the college.`, input.note ? `Note: ${esc(input.note)}` : ""].filter(Boolean),
      paths.outside(row.id),
    );
  }
  return getForActor(userId, id);
}

/** A dean sends their college's part on to its departments. */
export async function forwardToDepartments(userId: string, collegeAssignmentId: string, input: ForwardExternalRequestInput): Promise<ExternalRequestDto> {
  const college = await loadAssignment(collegeAssignmentId);
  if (college.level !== "COLLEGE") throw new HttpError(400, "Only a college's part is forwarded to departments.");
  const access = await accessFor(userId);
  if (!leads(access, college.orgNodeId)) throw new HttpError(403, `Only the dean of ${college.orgNode.name} forwards its part.`);
  assertUnderReview(college.request);
  if (!WORKING.includes(college.status)) throw new HttpError(409, "The college has already answered.");

  const ids = [...new Set(input.orgNodeIds)];
  const nodes = await prisma.orgNode.findMany({ where: { id: { in: ids }, active: true, kind: "DEPARTMENT", incomingEdges: { some: { parentId: college.orgNodeId } } }, include: { user: { select: { email: true } } } });
  if (nodes.length !== ids.length) throw new HttpError(400, `Choose active departments of ${college.orgNode.name}.`);
  const taken = new Set((await prisma.externalRequestAssignment.findMany({ where: { requestId: college.requestId, orgNodeId: { in: ids } }, select: { orgNodeId: true } })).map((a) => a.orgNodeId));
  const fresh = nodes.filter((n) => !taken.has(n.id));
  if (!fresh.length) throw new HttpError(400, "It has already been sent to every department chosen.");

  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequestAssignment.createMany({ data: fresh.map((n) => ({ requestId: college.requestId, orgNodeId: n.id, level: "DEPARTMENT" as const, parentId: college.id })) });
    await tx.externalRequestAssignment.update({ where: { id: college.id }, data: { status: "FORWARDED" } });
    await event(tx, college.requestId, actor, "DEAN_FORWARDED", input.note, { college: college.orgNode.name, departments: fresh.map((n) => n.name) });
  });
  for (const n of fresh) {
    await mailStaff(
      n.user?.email,
      `External request ${college.request.reference} for ${n.name}`,
      [
        `${esc(college.request.organizationName)} has asked for ${college.request.kind === "SAMPLE_ANALYSIS" ? "a sample analysis" : "rooms or labs"}. Ask your custodians to hold what is needed on the requested dates, then send the dean the booked rooms, the cost breakdown and the contact persons, or decline.`,
        input.note ? `Note from the dean: ${esc(input.note)}` : "",
      ].filter(Boolean),
      paths.outside(college.request.id),
    );
  }
  return getForActor(userId, college.requestId);
}

/** A head asks custodians to hold rooms or machines — several, as many labs as it takes. */
export async function assignCustodians(userId: string, departmentAssignmentId: string, input: AssignCustodiansInput): Promise<ExternalRequestDto> {
  const dept = await loadAssignment(departmentAssignmentId);
  if (dept.level !== "DEPARTMENT") throw new HttpError(400, "Custodians are asked by a department.");
  const access = await accessFor(userId);
  if (!leads(access, dept.orgNodeId)) throw new HttpError(403, `Only the head of ${dept.orgNode.name} asks its custodians.`);
  assertUnderReview(dept.request);
  if (!WORKING.includes(dept.status)) throw new HttpError(409, "The department has already answered.");

  const custodianIds = [...new Set(input.tasks.map((t) => t.custodianId))];
  if (custodianIds.length !== input.tasks.length) throw new HttpError(400, "Ask each custodian once.");
  if (dept.tasks.some((t) => custodianIds.includes(t.custodianId))) throw new HttpError(400, "One of them has already been asked.");
  const people = await prisma.user.findMany({ where: { id: { in: custodianIds }, status: "ACTIVE", roles: { some: { kind: "CUSTODIAN" } } }, select: { id: true, email: true } });
  if (people.length !== custodianIds.length) throw new HttpError(400, "Choose active custodians.");

  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalCustodianTask.createMany({ data: input.tasks.map((t) => ({ assignmentId: dept.id, custodianId: t.custodianId, want: t.want })) });
    await tx.externalRequestAssignment.update({ where: { id: dept.id }, data: { status: "FORWARDED" } });
    await event(tx, dept.requestId, actor, "CUSTODIANS_ASKED", input.note, { department: dept.orgNode.name, count: input.tasks.length });
  });
  for (const t of input.tasks) {
    await mailStaff(
      people.find((p) => p.id === t.custodianId)?.email,
      `Hold ${dept.request.kind === "SAMPLE_ANALYSIS" ? "a machine" : "rooms"} for ${dept.request.reference}`,
      [
        `Your head asks you to hold <strong>${esc(t.want)}</strong> for ${esc(dept.request.organizationName)} on the dates they asked for.${input.note ? ` Note: ${esc(input.note)}` : ""}`,
        "Hold the slots under <strong>External requests</strong>, then mark your part done, or say you can't.",
      ],
      paths.outside(dept.request.id),
    );
  }
  return getForActor(userId, dept.requestId);
}

/** A custodian holding a slot on a room (or a machine in it) they keep, for a department
 *  that asked them to. */
export async function placeHold(userId: string, id: string, input: PlaceHoldInput): Promise<ExternalRequestDto> {
  const row = await prisma.externalRequest.findUnique({ where: { id }, include: { assignments: { include: { tasks: true } }, windows: true } });
  if (!row) throw new HttpError(404, "Request not found");
  if (!HOLDABLE.includes(row.status)) throw new HttpError(409, "Slots can only be held while a request is under review, quoted or paid but not yet confirmed.");
  // F-055 of the 2026-09-15 campaign: only on a date the request asked for — by DATE,
  // not exact time, so a replacement for a lost slot can take another hour that day.
  if (!row.windows.some((w) => civilDateOf(w.date) === input.date)) throw new HttpError(400, "That date isn't one this request asked for.");
  const target = await resolveBookingTarget(prisma, input.itemIds);
  const viewer = await viewerOf(userId);
  if (!decidesFor(viewer, target.lab.id)) throw new HttpError(403, "Only the room's custodian holds slots on its calendar.");
  const lab = await prisma.item.findUniqueOrThrow({ where: { id: target.lab.id }, select: { ownerOrgNodeId: true, currentOrgNodeId: true } });
  const units = row.assignments.filter((a) => a.level === "DEPARTMENT" && a.status !== "DECLINED" && (viewer.sysAdmin || a.tasks.some((t) => t.custodianId === userId && t.status !== "DECLINED"))).map((a) => a.orgNodeId);
  if (!units.includes(lab.ownerOrgNodeId) && !units.includes(lab.currentOrgNodeId)) throw new HttpError(403, "This room's department hasn't asked you to hold anything for this request.");

  // Before a quote, a hold lasts two weeks (extendable); once quoted, exactly as long as
  // the payment deadline. A replacement hold on a paid request gets the two weeks the
  // AVP needs to confirm it.
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

/** A custodian reporting back to their head: held what was asked, or can't. */
export async function finishTask(userId: string, taskId: string, input: FinishTaskInput): Promise<ExternalRequestDto> {
  const task = await prisma.externalCustodianTask.findUnique({ where: { id: taskId }, include: { assignment: { include: { request: true, orgNode: { select: { name: true, userId: true } } } }, custodian: { select: { name: true } } } });
  if (!task) throw new HttpError(404, "Task not found");
  if (task.custodianId !== userId && !(await scope.isSysAdmin(userId))) throw new HttpError(403, "Only the custodian who was asked reports on this.");
  assertUnderReview(task.assignment.request);
  if (!WORKING.includes(task.assignment.status)) throw new HttpError(409, "The department has already answered.");
  if (input.outcome === "DONE") {
    const holds = await prisma.reservation.count({
      where: { externalRequestId: task.assignment.requestId, requestedById: task.custodianId, state: "HELD", lab: { OR: [{ ownerOrgNodeId: task.assignment.orgNodeId }, { currentOrgNodeId: task.assignment.orgNodeId }] } },
    });
    if (!holds) throw new HttpError(400, "Hold at least one slot first, or say you can't.");
  }
  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalCustodianTask.update({ where: { id: taskId }, data: { status: input.outcome, note: input.note || null, decidedAt: new Date() } });
    await event(tx, task.assignment.requestId, actor, input.outcome === "DONE" ? "TASK_DONE" : "TASK_DECLINED", [task.assignment.orgNode.name, task.want, input.note].filter(Boolean).join(" · "));
  });
  await mailStaff(
    await emailOf(task.assignment.orgNode.userId),
    `${task.custodian.name} ${input.outcome === "DONE" ? "has held" : "can't hold"} ${task.want}: ${task.assignment.request.reference}`,
    [input.note ? esc(input.note) : "No note.", "When every custodian has answered, send the dean the booked rooms, the cost breakdown and the contact persons."],
    paths.outside(task.assignment.request.id),
  );
  return getForActor(userId, task.assignment.requestId);
}

// ── Back up the line: heads → deans → AVP ────────────────────────────────────

/** A head sends the department's answer to the dean: the rooms held (seen on the request),
 *  the cost breakdown, and who the requester should call once they've paid. */
export async function submitDepartment(userId: string, departmentAssignmentId: string, input: SubmitDepartmentInput): Promise<ExternalRequestDto> {
  const dept = await loadAssignment(departmentAssignmentId);
  if (dept.level !== "DEPARTMENT") throw new HttpError(400, "A department's answer is submitted by its head.");
  const access = await accessFor(userId);
  if (!leads(access, dept.orgNodeId)) throw new HttpError(403, `Only the head of ${dept.orgNode.name} answers for it.`);
  assertUnderReview(dept.request);
  if (!WORKING.includes(dept.status)) throw new HttpError(409, "The department has already answered.");
  if (dept.tasks.some((t) => t.status === "PENDING")) throw new HttpError(409, "Wait until every custodian you asked has answered.");
  if (!/^https:\/\//i.test(input.sheetUrl)) throw new HttpError(400, "The cost breakdown link must start with https://");
  const holds = await prisma.reservation.count({ where: { externalRequestId: dept.requestId, state: "HELD", lab: { OR: [{ ownerOrgNodeId: dept.orgNodeId }, { currentOrgNodeId: dept.orgNodeId }] } } });
  if (!holds && !input.noCalendarNeeded) throw new HttpError(400, "Nothing is held on any of your department's calendars yet. Have a custodian hold the slots first, or confirm nothing needs a calendar.");

  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequestAssignment.update({
      where: { id: dept.id },
      data: {
        status: "SUBMITTED",
        sheetUrl: input.sheetUrl,
        amountSantim: input.amountSantim,
        noCalendarNeeded: Boolean(input.noCalendarNeeded),
        contacts: input.contacts as unknown as Prisma.InputJsonValue,
        note: input.note || null,
        decidedById: userId,
        decidedAt: new Date(),
      },
    });
    await event(tx, dept.requestId, actor, "DEPARTMENT_SUBMITTED", [dept.orgNode.name, `${holds} held`, etb(input.amountSantim), input.note].filter(Boolean).join(" · "));
  });
  await mailStaff(
    await emailOf(dept.parent?.orgNode.userId ?? (await avpUserId())),
    `${dept.orgNode.name} answered ${dept.request.reference}`,
    [`${holds} slot${holds === 1 ? "" : "s"} held, ${esc(etb(input.amountSantim))}.${input.note ? ` ${esc(input.note)}` : ""}`, "Approve it, or send it back to the head."],
    paths.outside(dept.request.id),
  );
  return getForActor(userId, dept.requestId);
}

/** A dean on a department's answer (approve, or send back to the head), or the AVP on a
 *  college's (approve, or send back to the dean). */
export async function reviewAssignment(userId: string, assignmentId: string, input: ReviewAssignmentInput): Promise<ExternalRequestDto> {
  const a = await loadAssignment(assignmentId);
  const access = await accessFor(userId);
  assertUnderReview(a.request);
  if (a.level === "COLLEGE") {
    if (!access.avp) throw new HttpError(403, "Only the AVP's office reviews a college's answer.");
    if (a.status !== "SUBMITTED") throw new HttpError(409, "The college hasn't submitted its answer.");
  } else {
    if (!a.parent) throw new HttpError(409, "This department answers the AVP directly.");
    if (!leads(access, a.parent.orgNodeId)) throw new HttpError(403, `Only the dean of ${a.parent.orgNode.name} reviews its departments.`);
    if (!WORKING.includes(a.parent.status)) throw new HttpError(409, "The college has already answered. The AVP's office would have to send it back first.");
    if (a.status !== "SUBMITTED" && a.status !== "APPROVED") throw new HttpError(409, "The department hasn't submitted its answer.");
    if (input.decision === "APPROVE" && a.status === "APPROVED") throw new HttpError(409, "Already approved.");
  }
  const approve = input.decision === "APPROVE";
  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequestAssignment.update({ where: { id: a.id }, data: { status: approve ? "APPROVED" : "RETURNED" } });
    await event(tx, a.requestId, actor, approve ? "ANSWER_APPROVED" : "ANSWER_RETURNED", [a.orgNode.name, input.note].filter(Boolean).join(" · "));
  });
  if (!approve) {
    await mailStaff(await emailOf(a.orgNode.userId), `${a.request.reference} was sent back to ${a.orgNode.name}`, [input.note ? esc(input.note) : "No note.", "Revise the answer and submit it again."], paths.outside(a.request.id));
  }
  return getForActor(userId, a.requestId);
}

/** A dean sends the college's answer to the AVP once every department is decided. */
export async function submitCollege(userId: string, collegeAssignmentId: string, input: SubmitCollegeInput): Promise<ExternalRequestDto> {
  const college = await loadAssignment(collegeAssignmentId);
  if (college.level !== "COLLEGE") throw new HttpError(400, "A college's answer is submitted by its dean.");
  const access = await accessFor(userId);
  if (!leads(access, college.orgNodeId)) throw new HttpError(403, `Only the dean of ${college.orgNode.name} answers for it.`);
  assertUnderReview(college.request);
  if (!WORKING.includes(college.status)) throw new HttpError(409, "The college has already answered.");
  if (!collegeReady({ assignments: college.children }, college)) throw new HttpError(409, "Approve or decline every department's answer first: at least one approved.");
  const total = college.children.filter((c) => APPROVED.includes(c.status)).reduce((sum, c) => sum + (c.amountSantim ?? 0), 0);

  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequestAssignment.update({ where: { id: college.id }, data: { status: "SUBMITTED", amountSantim: total, note: input.note || null, decidedById: userId, decidedAt: new Date() } });
    await event(tx, college.requestId, actor, "COLLEGE_SUBMITTED", [college.orgNode.name, etb(total), input.note].filter(Boolean).join(" · "));
  });
  await mailStaff(await emailOf(await avpUserId()), `${college.orgNode.name} answered ${college.request.reference}`, [`${esc(etb(total))} across its departments.${input.note ? ` ${esc(input.note)}` : ""}`, "Approve it, or send it back to the dean."], paths.outside(college.request.id));
  return getForActor(userId, college.requestId);
}

/** A dean or head declining their unit's part. A college declining takes its departments with it. */
export async function declineAssignment(userId: string, assignmentId: string, input: DeclineAssignmentInput): Promise<ExternalRequestDto> {
  const a = await loadAssignment(assignmentId);
  const access = await accessFor(userId);
  if (!leads(access, a.orgNodeId)) throw new HttpError(403, `Only the ${a.level === "COLLEGE" ? "dean" : "head"} of ${a.orgNode.name} declines its part.`);
  assertUnderReview(a.request);
  if (!WORKING.includes(a.status)) throw new HttpError(409, "This part has already been answered.");
  const nodeIds = [a.orgNodeId, ...a.children.map((c) => c.orgNodeId)];
  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequestAssignment.updateMany({ where: { id: { in: [a.id, ...a.children.map((c) => c.id)] } }, data: { status: "DECLINED", note: input.note, decidedById: userId, decidedAt: new Date() } });
    await releaseHolds(tx, a.requestId, "CANCELLED", nodeIds);
    await event(tx, a.requestId, actor, a.level === "COLLEGE" ? "COLLEGE_DECLINED" : "DEPARTMENT_DECLINED", [a.orgNode.name, input.note].filter(Boolean).join(" · "));
  });
  await mailStaff(await emailOf(a.parent?.orgNode.userId ?? (await avpUserId())), `${a.orgNode.name} declined its part of ${a.request.reference}`, [esc(input.note)], paths.outside(a.request.id));
  return getForActor(userId, a.requestId);
}

export async function extendHolds(userId: string, id: string, until: string): Promise<ExternalRequestDto> {
  const { row, access } = await loadForActor(userId, id);
  if (!access.avp && !row.assignments.some((a) => leads(access, a.orgNodeId))) throw new HttpError(403, "Only the AVP's office, a dean or a head on this request may extend holds.");
  if (!HOLDABLE.includes(row.status)) throw new HttpError(409, "This request has no holds to extend.");
  if (!isCivilDate(until) || until <= todayCivil()) throw new HttpError(400, "Choose a future date.");
  const at = civilToInstant(until, "23:59");
  // F-056 of the 2026-09-15 campaign: bounded by the same ceiling a fresh hold gets.
  const twoWeeks = civilToInstant(addDays(todayCivil(), HOLD_DAYS_BEFORE_QUOTE), "23:59");
  const ceiling = PAYABLE.includes(row.status) && row.paymentDeadline && row.paymentDeadline > new Date() ? row.paymentDeadline : twoWeeks;
  if (at.getTime() > ceiling.getTime()) throw new HttpError(400, `Holds cannot be extended past ${instantToCivil(ceiling, DEFAULT_TIME_ZONE).date} for this request.`);
  const updated = await prisma.reservation.updateMany({ where: { externalRequestId: id, state: "HELD" }, data: { holdExpiresAt: at } });
  await event(prisma, id, await actorOf(userId), "HOLDS_EXTENDED", `${updated.count} hold${updated.count === 1 ? "" : "s"} until ${until}`);
  return getForActor(userId, id);
}

// ── The AVP: quote, decline ───────────────────────────────────────────────────

export async function sendQuote(userId: string, id: string, input: SendQuoteInput): Promise<ExternalRequestDto> {
  if (!(await isAvp(userId))) throw new HttpError(403, "Only the Academic Vice President's office sends quotes.");
  const row = await loadRow(id);
  if (row.status !== "UNDER_REVIEW") throw new HttpError(409, "Only a request under review can be quoted.");
  if (!canQuote(row)) throw new HttpError(409, "Every college must have answered, and you must have approved at least one, before quoting.");
  if (!isCivilDate(input.paymentDeadline) || input.paymentDeadline <= todayCivil()) throw new HttpError(400, "The payment deadline must be a future date.");

  const deadline = civilToInstant(input.paymentDeadline, "23:59");
  const actor = await actorOf(userId);
  await prisma.$transaction(async (tx) => {
    await tx.externalRequest.update({ where: { id }, data: { status: "QUOTED", quoteAmountSantim: input.amountSantim, quoteNote: input.note || null, quoteSentAt: new Date(), paymentDeadline: deadline } });
    await tx.reservation.updateMany({ where: { externalRequestId: id, state: "HELD" }, data: { holdExpiresAt: deadline } });
    await event(tx, id, actor, "QUOTED", `${etb(input.amountSantim)}, payable by ${input.paymentDeadline}${input.note ? `: ${input.note}` : ""}`);
  });

  const bank = bankDetails();
  await mailRequester(
    await requesterEmail(row),
    `Quote for request ${row.reference}`,
    [
      `Dear ${esc(row.contactName)},`,
      `The university can provide what ${esc(row.organizationName)} asked for. The total is <strong>${esc(etb(input.amountSantim))}</strong>, payable by ${esc(input.paymentDeadline)}. What we have held for you stays held until then.`,
      bank ? `Pay into ${esc(bank.bankName)}, account ${esc(bank.accountNumber)} (${esc(bank.accountName)}), then enter your payment reference in the portal.` : "The payment account details are in the portal.",
      input.note ? esc(input.note) : "",
      "Sign in to the portal to see the cost breakdown and confirm your payment.",
    ].filter(Boolean),
    { href: portalUrl(id), label: "View the quote" },
  );
  return getForActor(userId, id);
}

/** The requester's address: their account's, or (a request from before accounts) the one on the form. */
export async function requesterEmail(row: { requesterId: string | null; contactEmail: string }): Promise<string> {
  return (await emailOf(row.requesterId)) ?? row.contactEmail;
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
  await mailRequester(await requesterEmail(row), `Request ${row.reference}`, [`Dear ${esc(row.contactName)},`, `We are unable to provide what ${esc(row.organizationName)} asked for.`, esc(input.note), refundNote].filter(Boolean), { href: portalUrl(id), label: "View your request" });
  return getForActor(userId, id);
}

/** Quotes past their payment deadline expire, releasing their holds. Run by the cron
 *  route; idempotent. Returns how many requests it closed. */
export async function expireOverdueQuotes(): Promise<number> {
  // PAYMENT_SUBMITTED is left alone: a person still owes the requester a decision.
  const overdue = await prisma.externalRequest.findMany({
    where: { status: "QUOTED", paymentDeadline: { lt: new Date() } },
    select: { id: true, reference: true, contactEmail: true, contactName: true, requesterId: true, payments: { select: { status: true, amountSantim: true } } },
  });
  for (const r of overdue) {
    await prisma.$transaction(async (tx) => {
      await releaseHolds(tx, r.id, "EXPIRED");
      await tx.externalRequest.update({ where: { id: r.id }, data: { status: "EXPIRED", closingNote: "The quote expired unpaid." } });
      await event(tx, r.id, { id: null, label: "System" }, "EXPIRED");
    });
    await mailRequester(await requesterEmail(r), `Request ${r.reference} expired`, [`Dear ${esc(r.contactName)},`, "The payment deadline for this quote has passed, so what was held has been released. You are welcome to submit a new request.", paidSantimOf(r.payments) > 0 ? `We received ${esc(etb(paidSantimOf(r.payments)))} towards it; the university's office will contact you about returning it.` : ""].filter(Boolean));
  }
  return overdue.length;
}

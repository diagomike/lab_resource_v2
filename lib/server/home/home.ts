import "server-only";
import type { CapabilitiesDto, CountArea, DueSoonDto, HomeCountsDto, HomeDto, MyRequestDto, UnfinishedDto, WaitingDto } from "@/lib/shared";
import { daysUntil, nextStep, WAITING_LABEL, type WaitingKind } from "@/lib/domain/home-logic";
import { STAGE_LABEL } from "@/lib/domain/purchasing";
import { CALIBRATION_FIELD_KEY, calibrationOf, todayIso } from "@/lib/domain/calibration";
import { paths } from "@/lib/paths";
import { prisma } from "../prisma";
import { capabilitiesOf } from "../auth/capabilities";
import * as transfers from "../resources/approvals";
import * as labVersions from "../resources/lab-versions";
import * as purchasing from "../resources/purchasing";
import * as procurements from "../resources/procurements";
import * as governance from "../resources/category-governance";
import * as external from "../external/requests";
import { listBookings } from "../scheduling/reservations";
import { declinedByArea, listNotifications, unreadCount } from "./notifications";

/**
 * Home: what is waiting for this person, what they left unfinished, where their own
 * requests stand, and what is new. Every count comes from the same services the
 * screens use, so Home never promises something the screen then doesn't show.
 * A source that refuses this person (they don't book, don't buy…) counts as nothing.
 */

async function safe<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

const approvalsFor = (kind: WaitingKind) => `/approvals?kind=${kind}`;

/** Each kind of thing waiting on this person, counted (zeros included). */
async function waitingFor(userId: string, caps: CapabilitiesDto): Promise<Array<{ kind: WaitingKind; count: number; path: string }>> {
  const runsLabs = caps.isCustodian || caps.isAdmin;
  const heads = caps.headOf.length > 0;
  const [transfer, labCommit, purchase, booking, categoryChange, needs, procure, arrivals, loads, outside] = await Promise.all([
    safe(0, async () => (await transfers.listForActor(userId, "inbox")).length),
    safe(0, async () => (heads || caps.isPropertyAdmin || caps.officeCodes.includes("PROP") ? (await labVersions.listForActor(userId, "inbox")).length : 0)),
    safe(0, async () => (await purchasing.listForActor(userId, "inbox")).length),
    safe(0, async () => (runsLabs || heads ? (await listBookings(userId, "inbox")).length : 0)),
    safe(0, () => governance.waitingCount(userId)),
    safe(0, () => (heads ? prisma.needLine.count({ where: { orgNodeId: { in: caps.headOf }, status: "OPEN" } }) : Promise.resolve(0))),
    safe(0, async () => (caps.isProcurement || caps.isAdmin ? (await procurements.waitingRequests(userId)).length : 0)),
    safe(0, async () =>
      caps.isPropertyAdmin
        ? (await prisma.procurement.count({ where: { stage: "ARRIVED", imports: { none: { status: { in: ["OPEN", "LOADED"] } } } } })) +
          (await prisma.purchaseRequest.count({ where: { stage: "IN_STORE", procurements: { none: {} }, imports: { none: { status: { in: ["OPEN", "LOADED"] } } } } }))
        : 0,
    ),
    safe(0, () => (caps.isStoreKeeper ? prisma.importRecord.count({ where: { status: "OPEN" } }) : Promise.resolve(0))),
    safe(0, async () =>
      caps.isAvp || heads || caps.deanOf.length || caps.isCustodian ? (await external.listForActor(userId)).filter((r) => r.waitingOnMe).length : 0,
    ),
  ]);
  return [
    { kind: "lab-commit", count: labCommit, path: approvalsFor("lab-commit") },
    { kind: "transfer", count: transfer, path: approvalsFor("transfer") },
    { kind: "booking", count: booking, path: approvalsFor("booking") },
    { kind: "purchase", count: purchase, path: approvalsFor("purchase") },
    { kind: "category-change", count: categoryChange, path: approvalsFor("category-change") },
    { kind: "loads", count: loads, path: paths.arrivals() },
    { kind: "arrivals", count: arrivals, path: paths.arrivals() },
    { kind: "needs", count: needs, path: paths.needs() },
    { kind: "procure", count: procure, path: "/purchasing?tab=procurement" },
    { kind: "external", count: outside, path: "/external-requests" },
  ];
}

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
};

/** "with the CSE head, 2 days" — who a chain is waiting on, and for how long. */
function withWhom(steps: Array<{ status: string; label: string; approverName: string | null }>, since: string): string | null {
  const step = steps.find((s) => s.status === "PENDING");
  if (!step) return null;
  return `With ${step.approverName ?? `${step.label} (vacant)`}, ${ago(since)}`;
}

/** This person's open requests, newest first. */
async function myRequests(userId: string): Promise<MyRequestDto[]> {
  const [t, l, p, b, c, n] = await Promise.all([
    safe([], () => transfers.listForActor(userId, "mine")),
    safe([], () => labVersions.listForActor(userId, "mine")),
    safe([], () => purchasing.listForActor(userId, "mine")),
    safe([], () => listBookings(userId, "mine")),
    safe({ waiting: [], mine: [] }, () => governance.listChanges(userId)),
    safe([], () => purchasing.listMyNeeds(userId)),
  ]);
  const out: MyRequestDto[] = [
    ...t
      .filter((r) => r.status === "PENDING")
      .map((r) => ({ kind: "Transfer", label: r.summary, status: "Waiting", detail: withWhom(r.steps, r.createdAt), path: paths.mine("transfer", r.id), at: r.createdAt })),
    ...l
      .filter((r) => r.status === "PENDING")
      .map((r) => ({ kind: "Lab changes", label: r.labName, status: "Waiting", detail: `With the head, ${ago(r.createdAt)}`, path: paths.mine("lab-commit", r.id), at: r.createdAt })),
    ...p
      .filter((r) => !["CLOSED", "REJECTED", "CANCELLED"].includes(r.stage))
      .map((r) => ({
        kind: "Purchase",
        label: `${r.reference} · ${r.title}`,
        status: STAGE_LABEL[r.stage],
        detail: r.stage === "APPROVING" ? withWhom(r.steps, r.createdAt) : r.stage === "REVISING" ? "Sent back to you to revise" : null,
        path: paths.mine("purchase", r.id),
        at: r.createdAt,
      })),
    ...b
      .filter((r) => r.state === "REQUESTED")
      .map((r) => ({ kind: "Booking", label: `${r.labName} · ${r.date} ${r.start}`, status: "Waiting", detail: "For the custodian to decide", path: paths.mine("booking", r.id), at: r.startsAt })),
    ...c.mine
      .filter((x) => x.status === "PENDING" || x.status === "STALE")
      .map((x) => ({
        kind: "Category change",
        label: x.categoryName,
        status: x.status === "STALE" ? "Needs redoing" : "Waiting",
        detail: x.status === "STALE" ? "The category changed since you proposed this" : `With ${x.waitingOn}, ${ago(x.createdAt)}`,
        path: paths.category(x.categoryId, x.id),
        at: x.createdAt,
      })),
    ...n
      .filter((x) => x.status === "OPEN")
      .map((x) => ({ kind: "Need", label: `${x.name} × ${x.qty}${x.labName ? ` · ${x.labName}` : ""}`, status: "Asked for", detail: `With the head of ${x.orgNodeName}`, path: paths.needs(), at: x.createdAt })),
  ];
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
}

/** Lab changes made and not sent yet. */
async function unfinishedFor(userId: string, caps: CapabilitiesDto): Promise<UnfinishedDto[]> {
  if (!caps.isCustodian && !caps.isStoreKeeper) return [];
  const drafts = await safe([], () => labVersions.unsentDrafts(userId));
  return drafts.map((d) => ({
    label: `Send your changes for ${d.labName}`,
    detail: `${d.changes} change${d.changes === 1 ? "" : "s"} not sent yet.`,
    path: paths.place(d.labItemId, "draft"),
  }));
}

/** Date details (calibration, expiry) falling due within 30 days, or overdue by up to 30,
 *  on what this person keeps or heads. */
async function dueSoonFor(userId: string, caps: CapabilitiesDto): Promise<DueSoonDto[]> {
  if (!caps.isCustodian && !caps.headOf.length) return [];
  const fields = await prisma.categoryField.findMany({ where: { type: "DATE" }, select: { categoryId: true, key: true, label: true, category: { select: { calibrationCycleMonths: true } } } });
  if (!fields.length) return [];
  const byCategory = new Map<string, Array<{ key: string; label: string }>>();
  for (const f of fields) byCategory.set(f.categoryId, [...(byCategory.get(f.categoryId) ?? []), f]);
  const items = await prisma.item.findMany({
    where: {
      deletedAt: null,
      categoryId: { in: [...byCategory.keys()] },
      OR: [{ custodianId: userId }, ...(caps.headOf.length ? [{ ownerOrgNodeId: { in: caps.headOf } }] : [])],
    },
    select: { id: true, name: true, categoryId: true, props: true },
    take: 5000,
  });
  const today = new Date();
  const cycleOf = new Map(fields.map((f) => [f.categoryId, f.category.calibrationCycleMonths]));
  const out: DueSoonDto[] = [];
  for (const item of items) {
    const props = (item.props ?? {}) as Record<string, unknown>;
    for (const f of byCategory.get(item.categoryId) ?? []) {
      const value = props[f.key];
      // "Last calibrated" is a past date: what falls due is the next calibration.
      if (f.key === CALIBRATION_FIELD_KEY) {
        const info = calibrationOf(cycleOf.get(item.categoryId), value, todayIso(today));
        if (!info || info.days === null || info.days > 30 || info.days < -30) continue;
        out.push({ itemId: item.id, itemName: item.name, what: "Calibration", date: info.dueOn!, days: info.days, path: `/register?item=${item.id}` });
        continue;
      }
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      const days = daysUntil(value, today);
      if (days > 30 || days < -30) continue;
      out.push({ itemId: item.id, itemName: item.name, what: f.label, date: value, days, path: `/register?item=${item.id}` });
    }
  }
  return out.sort((a, b) => a.days - b.days).slice(0, 10);
}

/** The units someone answers for, as a whole: a head's departments, a dean's or ADAA's
 *  college, the AVP's university. */
async function glanceFor(caps: CapabilitiesDto): Promise<HomeDto["glance"]> {
  const roots = caps.isAvp ? [] : [...new Set([...caps.headOf, ...caps.deanOf, ...(caps.adaaCollegeId ? [caps.adaaCollegeId] : [])])];
  if (!caps.isAvp && !roots.length) return null;
  let units: string[] | null = null;
  let scopeName = "ASTU";
  if (!caps.isAvp) {
    const below = await prisma.orgClosure.findMany({ where: { ancestorId: { in: roots } }, select: { descendantId: true } });
    units = [...new Set([...roots, ...below.map((r) => r.descendantId)])];
    const named = await prisma.orgNode.findMany({ where: { id: { in: roots } }, select: { name: true } });
    scopeName = named.map((n) => n.name).join(", ");
  }
  const owned = units ? { ownerOrgNodeId: { in: units } } : {};
  const [places, items, working, attention] = await Promise.all([
    prisma.item.count({ where: { ...owned, deletedAt: null, parentId: null, category: { isPlace: true } } }),
    prisma.item.count({ where: { ...owned, deletedAt: null, category: { isPlace: false } } }),
    prisma.item.count({ where: { ...owned, deletedAt: null, category: { isPlace: false }, status: "WORKING" } }),
    prisma.item.count({ where: { ...owned, deletedAt: null, category: { isPlace: false }, status: { in: ["BROKEN", "UNDER_MAINTENANCE", "LOST"] } } }),
  ]);
  return { scopeName, places, items, working, attention };
}

/** The admin's loose ends: posts nobody holds, places whose custodian can't run them,
 *  accounts with nothing to do, invitations not yet taken up. */
async function adminFor(caps: CapabilitiesDto): Promise<HomeDto["admin"]> {
  if (!caps.isAdmin) return null;
  const [vacantPosts, placesWithoutCustodian, peopleWithoutRole, invitationsPending] = await Promise.all([
    prisma.orgNode.count({ where: { active: true, userId: null } }),
    prisma.item.count({
      where: {
        deletedAt: null,
        parentId: null,
        category: { isPlace: true },
        OR: [{ custodian: { status: { not: "ACTIVE" } } }, { custodian: { roles: { none: { kind: { in: ["CUSTODIAN", "STORE_KEEPER"] } } } } }],
      },
    }),
    prisma.user.count({ where: { status: "ACTIVE", roles: { none: {} } } }),
    prisma.invitation.count({ where: { consumedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { vacantPosts, placesWithoutCustodian, peopleWithoutRole, invitationsPending };
}

export async function homeFor(userId: string): Promise<HomeDto> {
  const caps = await capabilitiesOf(userId);
  const [user, waiting, unfinished, mine, dueSoon, recent, glance, admin] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
    waitingFor(userId, caps),
    unfinishedFor(userId, caps),
    myRequests(userId),
    safe([], () => dueSoonFor(userId, caps)),
    listNotifications(userId, 8),
    safe(null, () => glanceFor(caps)),
    safe(null, () => adminFor(caps)),
  ]);
  const shown: WaitingDto[] = waiting.filter((w) => w.count > 0).map((w) => ({ ...w, label: WAITING_LABEL[w.kind] }));
  return {
    name: user.name,
    nextStep: nextStep({ waiting, unfinished, dueSoon }),
    waiting: shown,
    unfinished,
    mine,
    dueSoon,
    recent: recent.items,
    glance,
    admin,
  };
}

const OPEN_OUTSIDE = ["SUBMITTED", "UNDER_REVIEW", "QUOTED", "PAYMENT_SUBMITTED", "PAID"];

/** What this person started or takes part in that hasn't reached its end yet. A
 *  failed ending (rejected, withdrawn, declined, expired) stops counting at once. */
async function followingFor(userId: string, caps: CapabilitiesDto) {
  const heads = caps.headOf.length > 0;
  const [t, l, p, b, c, n, pipeline, importsOpen, outside] = await Promise.all([
    safe([], () => transfers.listForActor(userId, "mine")),
    safe([], () => labVersions.listForActor(userId, "mine")),
    safe([], () => purchasing.listForActor(userId, "mine")),
    safe([], () => listBookings(userId, "mine")),
    safe({ waiting: [], mine: [] }, () => governance.listChanges(userId)),
    safe([], () => (caps.isCustodian ? purchasing.listMyNeeds(userId) : Promise.resolve([]))),
    safe(0, () => (caps.isProcurement || caps.isAdmin ? prisma.procurement.count({ where: { stage: { notIn: ["CLOSED", "CANCELLED"] } } }) : Promise.resolve(0))),
    safe(0, () => (caps.isPropertyAdmin ? prisma.importRecord.count({ where: { status: "OPEN" } }) : Promise.resolve(0))),
    safe([], async () => (caps.isAvp || heads || caps.deanOf.length || caps.isCustodian ? await external.listForActor(userId) : [])),
  ]);
  const live = (stage: string) => !["CLOSED", "REJECTED", "CANCELLED"].includes(stage);
  const transfersOpen = t.filter((r) => r.status === "PENDING").length;
  const labOpen = l.filter((r) => r.status === "PENDING").length;
  const purchasesOpen = p.filter((r) => live(r.stage)).length;
  const bookingsOpen = b.filter((r) => r.state === "REQUESTED").length;
  const categoryOpen = c.mine.filter((x) => x.status === "PENDING").length;
  const needsOpen = n.filter((x) => x.status === "OPEN" || (x.status === "CARRIED" && x.purchaseStage !== null && live(x.purchaseStage))).length;
  const pipelineOpen = pipeline;
  const outsideOpen = outside.filter((r) => OPEN_OUTSIDE.includes(r.status) && !r.waitingOnMe).length;
  return { transfersOpen, labOpen, purchasesOpen, bookingsOpen, categoryOpen, needsOpen, pipelineOpen, importsOpen, outsideOpen };
}

/** The sidebar's badges, the screens' tab counts and the bell: the same facts as Home. */
export async function homeCounts(userId: string): Promise<HomeCountsDto> {
  const caps = await capabilitiesOf(userId);
  const [waiting, drafts, unread, f, declined] = await Promise.all([
    waitingFor(userId, caps),
    caps.isCustodian || caps.isStoreKeeper ? safe([], () => labVersions.unsentDrafts(userId)) : Promise.resolve([]),
    unreadCount(userId),
    followingFor(userId, caps),
    declinedByArea(userId),
  ]);
  const sum = (kinds: WaitingKind[]) => waiting.filter((w) => kinds.includes(w.kind)).reduce((n, w) => n + w.count, 0);
  const tabs = {
    "approvals.inbox": { action: sum(["transfer", "lab-commit", "purchase", "booking", "category-change"]), following: 0, declined: 0 },
    "approvals.mine": { action: 0, following: f.transfersOpen + f.labOpen + f.purchasesOpen + f.bookingsOpen + f.categoryOpen, declined: declined.approvals },
    "purchasing.needs": { action: sum(["needs"]), following: f.needsOpen, declined: 0 },
    "purchasing.requests": { action: 0, following: f.purchasesOpen, declined: 0 },
    "purchasing.procurement": { action: sum(["procure"]), following: f.pipelineOpen, declined: 0 },
    "purchasing.arrivals": { action: sum(["arrivals", "loads"]), following: f.importsOpen, declined: 0 },
    "places.changes": { action: drafts.length, following: f.labOpen, declined: 0 },
    "bookings.requests": { action: sum(["booking"]), following: f.bookingsOpen, declined: 0 },
  };
  // `declined`: unread bad news per area (a decline, a rejection, something sent back),
  // counted from the notices themselves so the badge clears when they are read.
  const area = (name: CountArea, ...keys: Array<keyof typeof tabs>) => ({
    action: keys.reduce((n, k) => n + tabs[k].action, 0),
    following: keys.reduce((n, k) => n + tabs[k].following, 0),
    declined: declined[name],
  });
  return {
    areas: {
      approvals: area("approvals", "approvals.inbox", "approvals.mine"),
      purchasing: area("purchasing", "purchasing.needs", "purchasing.requests", "purchasing.procurement", "purchasing.arrivals"),
      places: area("places", "places.changes"),
      outside: { action: sum(["external"]), following: f.outsideOpen, declined: declined.outside },
      bookings: area("bookings", "bookings.requests"),
    },
    tabs,
    unread,
  };
}

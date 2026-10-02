import "server-only";
import type { Prisma } from "@prisma/client";
import type { CreatePlaceInput, PlaceCustodianDto, PlaceDto, PlaceOptionsDto, UpdatePlaceInput } from "@/lib/shared";
import type { ItemChangeInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { capabilitiesOf } from "../auth/capabilities";
import { esc, notify, quoted } from "../mail/notify";
import { applyChange } from "./mutate";

/**
 * Places — labs, workshops, studios and stores: static, managed from above.
 *
 * Who manages a unit's places (capabilities.ts `managesPlacesIn`): its head; for the
 * university (the Main Store), Property Administration; the admin everywhere. The
 * college's ADAA creates the college's own STORES (`managesStoresIn`), and may change
 * who runs any lab or store in the college and its departments (`assignsPeopleIn`).
 * Deans don't run places. Managers create the place, keep its details (block, room,
 * seats…) and assign its custodian — a custodian never creates a lab; they are
 * assigned to one and run what is inside it.
 *
 * A store's keeper may be anyone who works in the unit: choosing someone who holds no
 * custodian role yet gives them the CUSTODIAN role (what lets a person hold custody), so
 * the ADAA can name the college store's keeper without People & roles.
 *
 * Every write still goes through mutate.ts's one write door (`asPlaceManager`), so the
 * register's history, placement rules and field validation apply unchanged.
 */

const PLACE_SELECT = {
  id: true,
  name: true,
  version: true,
  props: true,
  ownerOrgNodeId: true,
  custodianId: true,
  categoryId: true,
  ownerOrg: { select: { name: true } },
  custodian: { select: { name: true } },
  category: { select: { name: true, key: true, iconKey: true, bookingMode: true } },
  labVersions: { where: { kind: "DRAFT" as const }, select: { status: true } },
} as const;

type Caps = Awaited<ReturnType<typeof capabilitiesOf>>;

function mayManage(caps: Caps, ownerOrgNodeId: string, isStore: boolean): boolean {
  return caps.managesPlacesIn.includes(ownerOrgNodeId) || (isStore && caps.managesStoresIn.includes(ownerOrgNodeId));
}

/** May hand the place to another custodian: its managers, and the college's ADAA. */
function mayAssign(caps: Caps, ownerOrgNodeId: string, isStore: boolean): boolean {
  return mayManage(caps, ownerOrgNodeId, isStore) || caps.assignsPeopleIn.includes(ownerOrgNodeId);
}

async function assertCanManagePlace(actorId: string, ownerOrgNodeId: string, isStore: boolean): Promise<void> {
  const caps = await capabilitiesOf(actorId);
  if (mayManage(caps, ownerOrgNodeId, isStore)) return;
  if (!isStore && caps.managesStoresIn.includes(ownerOrgNodeId)) throw new HttpError(403, "The ADAA adds the college's stores; labs are added by each department's head.");
  throw new HttpError(403, "Labs and stores are managed by the department's head, the college's ADAA (its stores), or Property Administration for the Main Store.");
}

async function assertCanAssign(actorId: string, ownerOrgNodeId: string, isStore: boolean): Promise<void> {
  const caps = await capabilitiesOf(actorId);
  if (mayAssign(caps, ownerOrgNodeId, isStore)) return;
  throw new HttpError(403, "Who runs a lab or store is chosen by the department's head, the college's ADAA, or Property Administration for the Main Store.");
}

async function isStoreKind(categoryId: string): Promise<boolean> {
  const kind = await prisma.resourceCategory.findUnique({ where: { id: categoryId }, select: { key: true } });
  return kind?.key === "store";
}

/** Everything inside each place (any depth), and how much of it needs attention. */
async function countsFor(placeIds: string[]): Promise<Map<string, { items: number; attention: number }>> {
  if (!placeIds.length) return new Map();
  const rows = await prisma.$queryRaw<{ root: string; items: bigint; attention: bigint }[]>`
    WITH RECURSIVE t AS (
      SELECT id, id AS root, status FROM "Item" WHERE id = ANY(${placeIds}) AND "deletedAt" IS NULL
      UNION ALL
      SELECT i.id, t.root, i.status FROM "Item" i INNER JOIN t ON i."parentId" = t.id WHERE i."deletedAt" IS NULL
    )
    SELECT root, count(*) - 1 AS items, count(*) FILTER (WHERE id <> root AND status IN ('BROKEN', 'UNDER_MAINTENANCE', 'LOST')) AS attention
    FROM t GROUP BY root
  `;
  return new Map(rows.map((r) => [r.root, { items: Number(r.items), attention: Number(r.attention) }]));
}

type PlaceRow = Awaited<ReturnType<typeof loadPlaces>>[number];

function loadPlaces(where: Prisma.ItemWhereInput) {
  return prisma.item.findMany({ where: { ...where, parentId: null, deletedAt: null, category: { isPlace: true } }, select: PLACE_SELECT, orderBy: { name: "asc" } });
}

function toDto(row: PlaceRow, counts: Map<string, { items: number; attention: number }>, actorId: string, caps: Caps): PlaceDto {
  const c = counts.get(row.id) ?? { items: 0, attention: 0 };
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    categoryIconKey: row.category.iconKey,
    isStore: row.category.key === "store",
    bookable: row.category.bookingMode === "ROOM",
    ownerOrgNodeId: row.ownerOrgNodeId,
    ownerOrgNodeName: row.ownerOrg.name,
    custodianId: row.custodianId,
    custodianName: row.custodian.name,
    props: (row.props ?? {}) as PlaceDto["props"],
    itemCount: c.items,
    needsAttention: c.attention,
    draftStatus: row.labVersions[0]?.status ?? null,
    canManage: mayManage(caps, row.ownerOrgNodeId, row.category.key === "store"),
    canAssign: mayAssign(caps, row.ownerOrgNodeId, row.category.key === "store"),
    isMine: row.custodianId === actorId,
    version: row.version,
  };
}

/** The places this person manages, and the ones they run. */
export async function listPlaces(actorId: string): Promise<PlaceDto[]> {
  const caps = await capabilitiesOf(actorId);
  const rows = await loadPlaces({
    OR: [
      { custodianId: actorId },
      ...(caps.managesPlacesIn.length ? [{ ownerOrgNodeId: { in: caps.managesPlacesIn } }] : []),
      ...(caps.managesStoresIn.length ? [{ ownerOrgNodeId: { in: caps.managesStoresIn }, category: { key: "store" } }] : []),
      ...(caps.assignsPeopleIn.length ? [{ ownerOrgNodeId: { in: caps.assignsPeopleIn } }] : []),
    ],
  });
  const counts = await countsFor(rows.map((r) => r.id));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return rows
    .map((r) => toDto(r, counts, actorId, caps))
    .sort((a, b) => Number(b.isMine) - Number(a.isMine) || collator.compare(a.ownerOrgNodeName, b.ownerOrgNodeName) || collator.compare(a.name, b.name));
}

/** One place — readable by every university account (transparency across ASTU). */
export async function getPlace(actorId: string, placeId: string): Promise<PlaceDto> {
  const [row] = await loadPlaces({ id: placeId });
  if (!row) throw new HttpError(404, "Lab or store not found");
  return toDto(row, await countsFor([row.id]), actorId, await capabilitiesOf(actorId));
}

export async function placeOptions(actorId: string): Promise<PlaceOptionsDto> {
  const caps = await capabilitiesOf(actorId);
  const [kinds, units] = await Promise.all([
    prisma.resourceCategory.findMany({ where: { isPlace: true, active: true }, select: { id: true, key: true, name: true, iconKey: true }, orderBy: { name: "asc" } }),
    // Places belong to the university (the Main Store), a college or a department — never an office.
    prisma.orgNode.findMany({
      where: { id: { in: [...caps.managesPlacesIn, ...caps.managesStoresIn] }, active: true, kind: { not: "OFFICE" } },
      select: { id: true, name: true, kind: true },
      orderBy: [{ level: "asc" }, { name: "asc" }],
    }),
  ]);
  return { kinds, units: units.map((u) => ({ id: u.id, name: u.name, kind: u.kind, storesOnly: !caps.managesPlacesIn.includes(u.id) })) };
}

/** Who may run a place of this unit: active custodians and store keepers who work in
 *  it or below it (for the university itself — the Main Store — the store keepers). A
 *  college or department STORE may be kept by anyone who works there. */
export async function custodianCandidates(actorId: string, ownerOrgNodeId: string, isStore = false): Promise<PlaceCustodianDto[]> {
  await assertCanAssign(actorId, ownerOrgNodeId, isStore);
  const owner = await prisma.orgNode.findUnique({ where: { id: ownerOrgNodeId }, select: { kind: true } });
  const below = (await prisma.orgClosure.findMany({ where: { ancestorId: ownerOrgNodeId }, select: { descendantId: true } })).map((r) => r.descendantId);
  const people = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      ...(owner?.kind === "UNIVERSITY"
        ? { roles: { some: { kind: "STORE_KEEPER" } } }
        : isStore
          ? { homeNodeId: { in: below }, roles: { none: { kind: "EXTERNAL" } } }
          : { homeNodeId: { in: below }, roles: { some: { kind: { in: ["CUSTODIAN", "STORE_KEEPER"] } } } }),
    },
    select: { id: true, name: true, title: true, roles: { select: { kind: true } }, _count: { select: { custodyOf: { where: { parentId: null, deletedAt: null } } } } },
    orderBy: { name: "asc" },
  });
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    runs: p._count.custodyOf,
    becomesCustodian: !p.roles.some((r) => r.kind === "CUSTODIAN" || r.kind === "STORE_KEEPER" || r.kind === "SYS_ADMIN"),
  }));
}

/** The chosen person may run this place — and, for a store, becomes a custodian if they
 *  are not one yet (so they can hold what is in it). */
async function assertCandidate(actorId: string, ownerOrgNodeId: string, custodianId: string, isStore: boolean): Promise<void> {
  const candidate = (await custodianCandidates(actorId, ownerOrgNodeId, isStore)).find((c) => c.id === custodianId);
  if (!candidate) throw new HttpError(400, isStore ? "Choose a store keeper who works in this unit." : "Choose a custodian who works in this unit.");
  if (candidate.becomesCustodian) await prisma.userRole.create({ data: { userId: custodianId, kind: "CUSTODIAN" } });
}

export async function createPlace(actorId: string, input: CreatePlaceInput): Promise<PlaceDto> {
  const isStore = await isStoreKind(input.categoryId);
  await assertCanManagePlace(actorId, input.ownerOrgNodeId, isStore);
  const owner = await prisma.orgNode.findUnique({ where: { id: input.ownerOrgNodeId }, select: { kind: true } });
  if (owner?.kind === "OFFICE") throw new HttpError(400, "A lab or store belongs to a department, a college or the university, not an office.");
  const kind = await prisma.resourceCategory.findUnique({ where: { id: input.categoryId }, select: { isPlace: true, active: true, name: true } });
  if (!kind?.isPlace || !kind.active) throw new HttpError(400, "Choose a kind of place: a lab, workshop, studio or store.");
  await assertCandidate(actorId, input.ownerOrgNodeId, input.custodianId, isStore);

  const props = Object.fromEntries(Object.entries(input.props).filter(([, v]) => v !== "" && v !== null));
  const created = await applyChange(
    actorId,
    { kind: "createItem", parentId: null, categoryId: input.categoryId, count: 1, name: input.name, props, ownerOrgNodeId: input.ownerOrgNodeId, currentOrgNodeId: input.ownerOrgNodeId, custodianId: input.custodianId },
    { asPlaceManager: true },
  );
  const id = created.itemIds[0];
  const place = await getPlace(actorId, id);
  await notify(input.custodianId, actorId, {
    subject: isStore ? `You now keep ${place.name}` : `You now run ${place.name}`,
    paragraphs: [
      isStore
        ? `You are the store keeper of <strong>${esc(place.name)}</strong> (${esc(place.ownerOrgNodeName)}). Record what it holds; your changes go to Property Administration for approval.`
        : `You are the custodian of <strong>${esc(place.name)}</strong> (${esc(kind.name)}, ${esc(place.ownerOrgNodeName)}). Add what it holds, and your changes go to the head for approval.`,
    ],
    path: `/places/${id}`,
    action: isStore ? "Open the store" : "Open the lab",
  });
  return place;
}

/** Everything inside a place that its custodian answers for on the owning unit's behalf
 *  — what moves with the place when its custodian changes. A borrowed item (another
 *  unit's, or someone else's) stays with whoever holds it. */
async function heldWithPlace(placeId: string, custodianId: string, ownerOrgNodeId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE t AS (
      SELECT id FROM "Item" WHERE "parentId" = ${placeId} AND "deletedAt" IS NULL AND "custodianId" = ${custodianId} AND "ownerOrgNodeId" = ${ownerOrgNodeId}
      UNION ALL
      SELECT i.id FROM "Item" i INNER JOIN t ON i."parentId" = t.id
      WHERE i."deletedAt" IS NULL AND i."custodianId" = ${custodianId} AND i."ownerOrgNodeId" = ${ownerOrgNodeId}
    )
    SELECT id FROM t
  `;
  return rows.map((r) => r.id);
}

export async function updatePlace(actorId: string, placeId: string, input: UpdatePlaceInput): Promise<PlaceDto> {
  const before = await getPlace(actorId, placeId);
  const editsDetails = (input.name !== undefined && input.name !== before.name) || Object.keys(input.props ?? {}).length > 0;
  // Changing only who runs it is the ADAA's too; the name and details stay the managers'.
  if (editsDetails) await assertCanManagePlace(actorId, before.ownerOrgNodeId, before.isStore);
  else await assertCanAssign(actorId, before.ownerOrgNodeId, before.isStore);
  const run = (change: ItemChangeInput) => applyChange(actorId, change, { asPlaceManager: true });

  if (input.name !== undefined && input.name !== before.name) await run({ kind: "setName", itemIds: [placeId], value: input.name });
  for (const [key, value] of Object.entries(input.props ?? {})) {
    const next = value === "" ? null : value;
    if ((before.props[key] ?? null) !== next) await run({ kind: "setProperty", itemIds: [placeId], propKey: key, value: next });
  }
  if (input.custodianId && input.custodianId !== before.custodianId) {
    await assertCandidate(actorId, before.ownerOrgNodeId, input.custodianId, before.isStore);
    if (before.draftStatus === "SUBMITTED") throw new HttpError(409, `${before.name} has changes waiting for approval. Decide them before handing the place over.`);
    const moving = [placeId, ...(await heldWithPlace(placeId, before.custodianId, before.ownerOrgNodeId))];
    await run({ kind: "setCustodian", itemIds: moving, value: input.custodianId, ...(input.note ? { note: input.note } : {}) } as ItemChangeInput);
    const after = await getPlace(actorId, placeId);
    await notify(input.custodianId, actorId, {
      subject: before.isStore ? `You now keep ${after.name}` : `You now run ${after.name}`,
      paragraphs: [`You are now the custodian of <strong>${esc(after.name)}</strong> (${esc(after.ownerOrgNodeName)}), and of the ${moving.length - 1} things in it it answered for.${quoted(input.note)}`],
      path: `/places/${placeId}`,
      action: before.isStore ? "Open the store" : "Open the lab",
    });
    await notify(before.custodianId, actorId, {
      subject: `${after.name} has a new custodian`,
      paragraphs: [`${esc(after.custodianName)} now runs <strong>${esc(after.name)}</strong> in your place.${quoted(input.note)}`],
      path: `/places/${placeId}`,
    });
  }
  return getPlace(actorId, placeId);
}

/** An empty place can be removed by whoever manages it; one with anything inside cannot. */
export async function removePlace(actorId: string, placeId: string): Promise<void> {
  const place = await getPlace(actorId, placeId);
  await assertCanManagePlace(actorId, place.ownerOrgNodeId, place.isStore);
  if (place.itemCount > 0) throw new HttpError(409, `${place.name} still holds ${place.itemCount} thing${place.itemCount === 1 ? "" : "s"}. Move them out first.`);
  await applyChange(actorId, { kind: "deleteItem", itemIds: [placeId] }, { asPlaceManager: true });
}

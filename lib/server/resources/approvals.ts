import "server-only";
import type { Prisma, ChainStep as PrismaChainStep } from "@prisma/client";
import type { ChangeRequestDto, ChainStepDto, ItemChangeInput, PendingTransferMarkersDto, RequestTransferResultDto, TransferNamingDto } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { applyChange, topMostItemIds, type Tx } from "./mutate";
import { esc, notify, quoted } from "../mail/notify";
import { CMD_OFFICE, PROPERTY_OFFICE, requireOffice } from "../org/offices";
import { toDomainCategoryMap, toDomainItem } from "./adapt";
import { canPlace } from "@/lib/domain/placement";
import { allocateNames } from "@/lib/domain/naming";
import {
  activate,
  buildChain,
  buildOrgIndex,
  canDecide,
  chainSettled,
  collapseRepeatedApprovers,
  currentStep,
  movementChain,
  resolveApprover,
  mayRequestTransfer,
  validateChain,
  type ChainStep as DomainChainStep,
  type MovementShape,
} from "@/lib/domain/approvals";
import type { OrgNode as DomainOrgNode, Person } from "@/lib/domain/types";
import { paths } from "@/lib/paths";

/**
 * Track 3 — cross-lab transfers, the multi-office chain engine's first real use. See
 * ~/.claude/plans/lets-merge-the-work-memoized-journal.md §6 for the full design.
 *
 * Ported from temp_works/src/lib/store.ts's `route()` (deciding what should happen to
 * a change) and `decideRequest()` (walking a chain to its conclusion) — the exact
 * reference implementation lib/domain/approvals.ts's 45 tests were already written
 * against — substituting live Prisma reads/writes for the sandbox's in-memory store,
 * the same way lab-drafts.ts ported its own reference logic.
 *
 * Who may ask is one fixed rule (`mayRequestTransfer`); the steps come from the
 * movement's shape (`movementChain`). Every other `ItemChangeKind` applies through
 * mutate.ts.
 */

type TransferInput = Extract<ItemChangeInput, { kind: "transferItem" }>;

// ── Loading live domain data — never cached, never re-derived from a stale read ──

async function loadPerson(userId: string): Promise<Person | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, homeNodeId: true } });
  if (!user) return undefined;
  const roles = await scope.rolesOf(userId);
  return { id: user.id, name: user.name, homeOrgNodeId: user.homeNodeId, roles };
}

/** Every org node, in the shape lib/domain/approvals.ts's chain builder walks —
 *  `parentIds` is unused by a transfer's own selectors (OWNER_HEAD/TARGET_HEAD/
 *  ITEM_CUSTODIAN/REQUESTER_RECEIPT are all direct lookups, no HIERARCHY walk), but
 *  ChainContext.orgIndex still needs building, so this stays a real conversion
 *  rather than a stub. */
async function loadDomainOrgNodes(): Promise<DomainOrgNode[]> {
  const rows = await prisma.orgNode.findMany({ include: { incomingEdges: true } });
  return rows.map((n) => ({
    id: n.id,
    name: n.name,
    kind: n.kind,
    level: n.level,
    parentIds: n.incomingEdges.map((e) => e.parentId),
    occupantId: n.userId,
    active: n.active,
  }));
}

function toDomainStep(row: PrismaChainStep): DomainChainStep {
  return {
    id: row.id,
    order: row.order,
    selector: row.selector,
    label: row.label,
    nodeId: row.nodeId,
    approverId: row.approverId,
    status: row.status,
    skipReason: row.skipReason,
    receipt: row.receipt,
    decidedById: row.decidedById ?? undefined,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : undefined,
    note: row.note ?? undefined,
  };
}

// ── Resolving what should happen to a transfer, without doing any of it ─────────
//
// Pure with respect to the database in the sense that it commits nothing — used by
// both `requestTransfer` (which then acts on the answer) and `previewTransfer` (which
// shows it to the requester before they commit to asking).

interface TransferContext {
  items: Array<{ id: string; name: string; categoryId: string; parentId: string | null; ownerOrgNodeId: string; currentOrgNodeId: string; custodianId: string; version: number }>;
  destination: { id: string; name: string; categoryId: string; custodianId: string };
}

/** The fields a transfer actually depends on — F-041 of the 2026-09-15 campaign.
 *  Deliberately excludes `version` (which a cosmetic edit like a rename bumps just
 *  as readily as a structural one) and every other column (name, properties, ...). */
interface StructuralFields {
  parentId: string | null;
  ownerOrgNodeId: string;
  currentOrgNodeId: string;
  custodianId: string;
}

function structuralFieldsOf(item: { parentId: string | null; ownerOrgNodeId: string; currentOrgNodeId: string; custodianId: string }): StructuralFields {
  return { parentId: item.parentId, ownerOrgNodeId: item.ownerOrgNodeId, currentOrgNodeId: item.currentOrgNodeId, custodianId: item.custodianId };
}

function structuralFieldsEqual(a: StructuralFields, b: StructuralFields): boolean {
  return a.parentId === b.parentId && a.ownerOrgNodeId === b.ownerOrgNodeId && a.currentOrgNodeId === b.currentOrgNodeId && a.custodianId === b.custodianId;
}

async function loadTransferContext(input: TransferInput): Promise<TransferContext> {
  const items = await prisma.item.findMany({ where: { id: { in: input.itemIds }, deletedAt: null } });
  if (items.length !== input.itemIds.length) throw new HttpError(400, "One or more of these resources no longer exist.");

  const destination = await prisma.item.findUnique({ where: { id: input.transfer.targetParentId } });
  if (!destination || destination.deletedAt) throw new HttpError(400, "The destination no longer exists.");

  const targetNode = await prisma.orgNode.findUnique({ where: { id: input.transfer.targetOrgNodeId } });
  if (!targetNode?.active) throw new HttpError(400, "Choose an active receiving unit.");

  if (input.transfer.targetCustodianId) {
    const custodian = await prisma.user.findUnique({ where: { id: input.transfer.targetCustodianId } });
    if (!custodian) throw new HttpError(400, "Choose an existing custodian.");
    // F-024 of the 2026-09-15 campaign: custody landing on a disabled account would
    // stall the receipt step forever (they can never sign in to confirm it).
    await scope.assertEligibleCustodian(input.transfer.targetCustodianId);
  }

  return { items, destination };
}

type Resolution =
  | { outcome: "DENIED"; reason: string }
  | { outcome: "APPLIED"; reason: string }
  | { outcome: "ROUTED"; reason: string; steps: DomainChainStep[] };

/**
 * Ported from `route()` — a selection spanning several categories can match several
 * policies; the worst outcome wins (DENY over CHAIN over AUTO), because applying half
 * a bulk transfer and routing the other half leaves the register in a state nobody
 * asked for.
 */
async function resolveTransfer(actorId: string, input: TransferInput, ctx: TransferContext, movement: MovementShape): Promise<Resolution> {
  const person = await loadPerson(actorId);
  if (!person) return { outcome: "DENIED", reason: "Nobody is signed in." };

  const categoryRows = await prisma.resourceCategory.findMany({
    include: { group: { select: { name: true } }, fields: true, templateAsParent: true },
  });
  const categories = toDomainCategoryMap(categoryRows);

  for (const item of ctx.items) {
    if (!canPlace(categories, item.categoryId, ctx.destination.categoryId)) {
      throw new HttpError(400, `"${categories[item.categoryId]?.name ?? item.categoryId}" may not be placed inside the selected destination.`);
    }
  }

  const first = ctx.items[0];
  const nodes = await loadDomainOrgNodes();
  const orgIndex = buildOrgIndex(nodes);
  const firstRow = await prisma.item.findUnique({ where: { id: first.id } });
  const domainItem = firstRow ? toDomainItem(firstRow, []) : undefined;

  if (movement === "RETURN") {
    // A fixed, always-available two-step flow. See assertTransferParties's own header
    // for why this is detected by shape rather than a client flag.
    const hostReleaserId = await resolveHostReleaserId(first.id);
    const steps = buildChain(movementChain("RETURN", {}), {
      item: domainItem,
      ownerNodeId: first.ownerOrgNodeId,
      targetNodeId: input.transfer.targetOrgNodeId,
      hostReleaserId,
      requesterId: actorId,
      nodes,
      orgIndex,
    });
    if (steps.every((s) => s.status === "SKIPPED")) {
      return { outcome: "APPLIED", reason: "Returned directly. Nobody else to ask." };
    }
    return { outcome: "ROUTED", reason: "Returning it to its own owning unit", steps };
  }

  // Who may ASK (custodians, heads, the store keeper, the admin); the steps come from
  // the movement's shape below.
  if (!mayRequestTransfer(person)) return { outcome: "DENIED", reason: "Only custodians, heads and the store keeper ask to move resources." };

  const ownerNodeId = first.ownerOrgNodeId;
  const targetNodeId = input.transfer.targetOrgNodeId;

  // Each movement has the university's own line (`movementChain`): local consent
  // (whoever holds it, the unit that owns it, whoever runs the room it lands in, the
  // unit receiving it), then the central office answering for it — the College
  // Managing Director for a permanent transfer, Property Administration for anything
  // in or out of the Main Store or leaving its college for good — then whoever ends up
  // holding it confirms.
  //
  // Who that last person is: a handover names them (`targetCustodianId`, the person
  // taking on custody); a return to the store is the store's own custodian; a pull is
  // the destination CONTAINER's own custodian — for a loan a courtesy consult for the
  // room (custody stays with the lender), for a permanent transfer the person who
  // will answer for it — skipped like any other post when the requester holds it.
  const targetCustodianId = movement === "STORE_OUT" ? (input.transfer.targetCustodianId ?? first.custodianId) : (input.transfer.targetCustodianId ?? ctx.destination.custodianId);
  const needsProperty = movement === "STORE_OUT" || movement === "FROM_STORE" || movement === "TO_STORE";
  const crossesColleges = movement === "PERMANENT" ? await crossesCollegeLine(ctx.items.map((i) => i.ownerOrgNodeId), targetNodeId) : false;
  const cmd = movement === "PERMANENT" ? await requireOffice(CMD_OFFICE, nodes) : null;
  const property = needsProperty || crossesColleges ? await requireOffice(PROPERTY_OFFICE, nodes) : null;
  const chain = movementChain(movement, {
    cmdNodeId: cmd?.id,
    propertyNodeId: property?.id,
    crossesColleges,
    askReceivingCustodian: targetCustodianId !== actorId,
    askItemCustodian: ctx.items.some((i) => i.custodianId !== actorId),
  });

  const broken = validateChain(chain, { ownerNodeId, targetNodeId, nodes, orgIndex });
  if (broken) return { outcome: "DENIED", reason: broken };

  const steps = collapseRepeatedApprovers(
    buildChain(chain, {
      item: domainItem,
      ownerNodeId,
      targetNodeId,
      targetCustodianId,
      requesterId: actorId,
      nodes,
      orgIndex,
    }),
  );

  // Every step skipped means one thing only: the requester holds every post on the
  // route, so each step is their own signature on their own request. Applying
  // directly here is what keeps "I already head both units" instant, exactly as
  // today, while everyone else goes through the real chain (§6.2).
  if (steps.every((s) => s.status === "SKIPPED")) {
    return { outcome: "APPLIED", reason: "No eligible approver: applied directly." };
  }

  return { outcome: "ROUTED", reason: MOVEMENT_REASON[movement], steps };
}

const MOVEMENT_REASON: Record<MovementShape, string> = {
  LOAN: "A loan needs both units and a receipt",
  PERMANENT: "A permanent transfer needs both units, the College Managing Director and a receipt",
  STORE_OUT: "Sending from the store needs Property Administration, then the receiving custodian accepts it",
  FROM_STORE: "Taking from the store needs the receiving head and Property Administration",
  TO_STORE: "Returning to the store needs the owning head and Property Administration",
  RETURN: "Returning it to its own owning unit",
};

/** The colleges above a unit (itself too, when it is one). */
async function collegesOf(nodeId: string): Promise<Set<string>> {
  const rows = await prisma.orgClosure.findMany({ where: { descendantId: nodeId, ancestor: { kind: "COLLEGE" } }, select: { ancestorId: true } });
  return new Set(rows.map((r) => r.ancestorId));
}

/** A permanent transfer leaves its college when any owning unit shares no college
 *  with the receiving unit. A unit outside every college (the university itself, an
 *  office) shares none, so moving its property for good is always university business. */
async function crossesCollegeLine(ownerNodeIds: string[], targetNodeId: string): Promise<boolean> {
  const target = await collegesOf(targetNodeId);
  for (const ownerId of new Set(ownerNodeIds)) {
    const owner = await collegesOf(ownerId);
    if (![...owner].some((id) => target.has(id))) return true;
  }
  return false;
}

/** Which movement a stored request is — one raised before movements were recorded
 *  is a handover or a loan. */
export function movementOf(payload: { transfer?: { movement?: MovementShape; transferOwnership?: boolean } } | null | undefined): MovementShape {
  return payload?.transfer?.movement ?? (payload?.transfer?.transferOwnership ? "STORE_OUT" : "LOAN");
}

export const MOVEMENT_TITLE: Record<MovementShape, string> = {
  LOAN: "Loan between units",
  PERMANENT: "Permanent transfer",
  STORE_OUT: "Store handover",
  FROM_STORE: "Request from the store",
  TO_STORE: "Return to the store",
  RETURN: "Return to its owner",
};

/** "handover", "permanent transfer", … — for sentences. */
const MOVEMENT_NOUN: Record<MovementShape, string> = {
  LOAN: "transfer",
  PERMANENT: "permanent transfer",
  STORE_OUT: "handover",
  FROM_STORE: "request from the store",
  TO_STORE: "return to the store",
  RETURN: "return",
};

function summarize(ctx: TransferContext, input: TransferInput, destination: string): string {
  const subject = ctx.items.length === 1 ? ctx.items[0].name : `${ctx.items.length} resources`;
  return `${MOVEMENT_TITLE[movementOf(input)]}: ${subject} → ${destination}`;
}

/** "Switch Rack in Software Laboratory B510-R11": a destination inside a lab is named
 *  together with the lab (R2-4 of the 2026-09-23 run), because with 31 labs "→ Switch
 *  Rack" alone can't be told apart. */
async function destinationLabel(db: Tx, destinationId: string): Promise<string> {
  const chain = await db.$queryRaw<{ name: string; parentId: string | null }[]>`
    WITH RECURSIVE up AS (
      SELECT id, "parentId", name, 0 AS depth FROM "Item" WHERE id = ${destinationId}
      UNION ALL
      SELECT i.id, i."parentId", i.name, u.depth + 1 FROM "Item" i INNER JOIN up u ON i.id = u."parentId"
    )
    SELECT name, "parentId" FROM up ORDER BY depth
  `;
  if (!chain.length) return "a removed destination";
  const root = chain[chain.length - 1];
  return chain.length > 1 ? `${chain[0].name} in ${root.name}` : chain[0].name;
}

// ── One promise per item ─────────────────────────────────────────────────────────
//
// R2-1 of the 2026-09-23 run: nothing stopped the store keeper from handing the same
// store items to two labs. The second request was only refused at apply time (stale),
// after both heads and custodians had been asked. A request's `baseVersions` names the
// TOP-MOST items it moves; each one's subtree travels with it. So a new request clashes
// with a pending one when it names one of those items, something inside one (it would
// be pulled out), or something that contains one (it would be carried off).

/** Why these items can't be asked for right now, or null when none is promised. */
async function findPendingClash(db: Tx, itemIds: string[]): Promise<string | null> {
  if (!itemIds.length) return null;
  const pending = await db.changeRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true, baseVersions: true, payload: true, createdAt: true, requester: { select: { name: true } } },
  });
  if (!pending.length) return null;
  const promisedBy = new Map<string, (typeof pending)[number]>();
  for (const r of pending) for (const id of Object.keys((r.baseVersions ?? {}) as Record<string, number>)) promisedBy.set(id, r);

  const related = await db.$queryRaw<{ root: string; id: string }[]>`
    WITH RECURSIVE down AS (
      SELECT id AS root, id FROM "Item" WHERE id = ANY(${itemIds})
      UNION ALL
      SELECT d.root, i.id FROM "Item" i INNER JOIN down d ON i."parentId" = d.id WHERE i."deletedAt" IS NULL
    ), up AS (
      SELECT id AS root, "parentId" AS id FROM "Item" WHERE id = ANY(${itemIds})
      UNION ALL
      SELECT u.root, i."parentId" FROM "Item" i INNER JOIN up u ON i.id = u.id
    )
    SELECT root, id FROM down UNION SELECT root, id FROM up WHERE id IS NOT NULL
  `;
  const clashing = new Map<string, Set<string>>(); // request id → requested item ids
  for (const { root, id } of related) {
    const r = promisedBy.get(id);
    if (r) clashing.set(r.id, (clashing.get(r.id) ?? new Set()).add(root));
  }
  if (!clashing.size) return null;

  const [firstId, roots] = [...clashing][0];
  const first = pending.find((r) => r.id === firstId)!;
  const items = await db.item.findMany({ where: { id: { in: [...roots] } }, select: { name: true }, orderBy: { name: "asc" } });
  const names = items.map((i) => `"${i.name}"`);
  const shown = names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", ");
  const payload = first.payload as unknown as TransferInput;
  const kind = MOVEMENT_NOUN[movementOf(payload)];
  const to = payload.transfer?.targetParentId ? await destinationLabel(db, payload.transfer.targetParentId) : "another place";
  const more = clashing.size > 1 ? ` (and ${clashing.size - 1} more pending request${clashing.size > 2 ? "s" : ""})` : "";
  const plural = names.length > 1;
  return (
    `${shown} ${plural ? "are" : "is"} already in a pending ${kind} to ${to}, asked by ${first.requester.name} on ${first.createdAt.toISOString().slice(0, 10)}${more}. ` +
    `That request has to be approved, rejected or cancelled before ${plural ? "they" : "it"} can go anywhere else.`
  );
}

/** Register markers: the top-most items a pending transfer or handover will move, and
 *  where to. Only items the viewer can see are marked. */
export async function pendingTransferMarkers(actorId: string): Promise<PendingTransferMarkersDto> {
  const pending = await prisma.changeRequest.findMany({ where: { status: "PENDING" }, select: { id: true, baseVersions: true, payload: true } });
  if (!pending.length) return {};
  const ownerOf = new Map<string, (typeof pending)[number]>();
  for (const r of pending) for (const id of Object.keys((r.baseVersions ?? {}) as Record<string, number>)) ownerOf.set(id, r);
  const where = await scope.visibleItemWhere(actorId);
  const visible = await prisma.item.findMany({ where: { AND: [where, { id: { in: [...ownerOf.keys()] }, deletedAt: null }] }, select: { id: true } });
  const labels = new Map<string, string>();
  const out: PendingTransferMarkersDto = {};
  for (const { id } of visible) {
    const r = ownerOf.get(id)!;
    const payload = r.payload as unknown as TransferInput;
    const target = payload.transfer?.targetParentId;
    if (target && !labels.has(target)) labels.set(target, await destinationLabel(prisma, target));
    out[id] = { requestId: r.id, line: `In a pending ${MOVEMENT_NOUN[movementOf(payload)]} to ${target ? labels.get(target) : "another place"}` };
  }
  return out;
}

// ── Requesting a transfer ────────────────────────────────────────────────────────

/** Moving OWNERSHIP along with the resource is the main store handing stock over to a
 *  department — nobody else's to ask for. A custodian or head lending something keeps
 *  their own unit as the owner, which is the whole point of the owner/current split. */
async function assertMayTransferOwnership(actorId: string, input: TransferInput): Promise<void> {
  if (!input.transfer.transferOwnership) return;
  const roles = await scope.rolesOf(actorId);
  if (!roles.includes("STORE_KEEPER") && !roles.includes("SYS_ADMIN")) {
    throw new HttpError(403, "Only the store keeper may hand ownership of stock over to another unit.");
  }
}

/**
 * Return flow (2026-09-20, F-039 of the 2026-09-15 campaign) — sending a borrowed
 * item back to its own owning unit. Detected structurally, by shape, and built
 * directly. A transfer is a return exactly when every named
 * item is currently on loan (owner ≠ current) and the chosen destination belongs to
 * that SAME owning unit — sending it home, never anywhere else.
 */
async function isReturnShape(destinationUnitId: string, items: Array<{ ownerOrgNodeId: string; currentOrgNodeId: string }>): Promise<boolean> {
  return items.length > 0 && items.every((i) => i.ownerOrgNodeId !== i.currentOrgNodeId && i.ownerOrgNodeId === destinationUnitId);
}

/**
 * Either side of a loan may ask for it back: the lender (their ordinary write
 * custody over the item itself) or the host (they currently physically
 * hold it, via the READ-side containment walk — `custodyItemIdsOf`, unchanged by
 * the 2026-09-20 write-custody fix — even though that same fix means the host may
 * no longer WRITE the item directly; asking for it to leave is not writing it).
 * Neither check alone is right for both directions, so this tries both.
 */
async function mayInitiateReturn(actorId: string, itemIds: string[]): Promise<boolean> {
  try {
    await scope.assertCanMutate(actorId, itemIds);
    return true;
  } catch {
    // fall through to the host-side check below
  }
  const hosted = new Set(await scope.custodyItemIdsOf(actorId));
  return itemIds.every((id) => hosted.has(id));
}

/** HOST_RELEASE's approver: whoever custodies the item's current physical
 *  container, falling back to the current unit's own occupant if the item is
 *  somehow a root. Resolved once, at request time — the same frozen-person
 *  discipline `targetCustodianId` already uses for TARGET_CUSTODIAN, not a live
 *  office re-resolution (there is no "office" here, just whoever happens to run
 *  the room today). */
async function resolveHostReleaserId(itemId: string): Promise<string | null> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { parentId: true, currentOrgNodeId: true } });
  if (item?.parentId) {
    const parent = await prisma.item.findUnique({ where: { id: item.parentId }, select: { custodianId: true } });
    if (parent?.custodianId) return parent.custodianId;
  }
  if (item?.currentOrgNodeId) {
    const node = await prisma.orgNode.findUnique({ where: { id: item.currentOrgNodeId }, select: { userId: true } });
    return node?.userId ?? null;
  }
  return null;
}

/** The Main Store a place belongs to — its top-most container is a Store owned by the
 *  university itself (not a department's own chemical store) — or null. */
async function centralStoreRootOf(itemId: string): Promise<{ id: string; custodianId: string } | null> {
  const [root] = await prisma.$queryRaw<{ id: string; custodianId: string; key: string; kind: string }[]>`
    WITH RECURSIVE up AS (
      SELECT id, "parentId" FROM "Item" WHERE id = ${itemId}
      UNION ALL
      SELECT i.id, i."parentId" FROM "Item" i INNER JOIN up u ON i.id = u."parentId"
    )
    SELECT i.id, i."custodianId", c.key, o.kind::text AS kind
    FROM up JOIN "Item" i ON i.id = up.id JOIN "ResourceCategory" c ON c.id = i."categoryId" JOIN "OrgNode" o ON o.id = i."ownerOrgNodeId"
    WHERE up."parentId" IS NULL
  `;
  return root && root.key === "store" && root.kind === "UNIVERSITY" ? { id: root.id, custodianId: root.custodianId } : null;
}

/** The Main Store(s) something can be returned into — every Store place owned by the
 *  university itself, with who keeps it. */
export async function listCentralStores(): Promise<Array<{ id: string; name: string; custodianName: string }>> {
  const rows = await prisma.item.findMany({
    where: { parentId: null, deletedAt: null, category: { key: "store" }, ownerOrg: { kind: "UNIVERSITY" } },
    select: { id: true, name: true, custodian: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, custodianName: r.custodian.name }));
}

async function allInCentralStore(itemIds: string[]): Promise<boolean> {
  for (const id of itemIds) if (!(await centralStoreRootOf(id))) return false;
  return itemIds.length > 0;
}

/**
 * Track 5 — who is on which end of a transfer, and which movement it is. Transfers
 * are PULLED: the unit that needs something finds it (the Register's whole-university
 * view) and asks for it into a place it already holds, and the chain is how the other
 * side says yes. So a pull is checked against the DESTINATION — the requester must be
 * able to write it — and the source must not already be theirs (that is a Move, not a
 * transfer). The receiving unit is read off the destination rather than trusted from
 * the client. A pull is a LOAN unless the requester asks for it PERMANENTLY, and one
 * out of the Main Store is always FROM_STORE — the store's stock is there to be given
 * out, never lent.
 *
 * Two pushes are left:
 *  - the store keeper handing stock over (`transferOwnership` from the client —
 *    STORE_OUT): store keeper/SYS_ADMIN only, checked against the SOURCE as it always was;
 *  - sending something back into the Main Store (TO_STORE), detected by the destination
 *    being inside it: asked by whoever holds the item, or by the store's own keeper.
 *
 * Everything that changes hands for good is normalized here to `transferOwnership`
 * plus the custodian who will answer for it, so the write path applies it the same way.
 */
async function assertTransferParties(actorId: string, input: TransferInput): Promise<{ input: TransferInput; movement: MovementShape }> {
  if (input.transfer.transferOwnership) {
    await assertMayTransferOwnership(actorId, input);
    await scope.assertCanMutate(actorId, input.itemIds);
    const { permanent: _permanent, ...transfer } = input.transfer;
    void _permanent;
    return { input: { ...input, transfer: { ...transfer, movement: "STORE_OUT" } }, movement: "STORE_OUT" };
  }
  // Refused now rather than when the chain finally applies it (mutate.ts refuses it too).
  if (input.transfer.renameAs) throw new HttpError(400, "Only a store handover can rename what it hands over.");

  const destination = await prisma.item.findUnique({ where: { id: input.transfer.targetParentId } });
  if (!destination || destination.deletedAt) throw new HttpError(400, "The destination no longer exists.");

  const items = await prisma.item.findMany({ where: { id: { in: input.itemIds } }, select: { id: true, ownerOrgNodeId: true, currentOrgNodeId: true } });
  const onto = (movement: MovementShape, custodianId: string | null, ownership: boolean): { input: TransferInput; movement: MovementShape } => ({
    input: {
      ...input,
      transfer: {
        targetParentId: destination.id,
        targetOrgNodeId: destination.currentOrgNodeId,
        targetCustodianId: custodianId,
        ...(ownership ? { transferOwnership: true } : {}),
        movement,
      },
    },
    movement,
  });

  if ((await centralStoreRootOf(destination.id)) && !(await allInCentralStore(input.itemIds))) {
    // Back into the Main Store: the item's holder sends it, or the store keeper asks
    // for it (then the holder is asked first — movementChain's askItemCustodian).
    const mayAsk = (await mayWrite(actorId, input.itemIds)) || (await mayWrite(actorId, [destination.id]));
    if (!mayAsk) throw new HttpError(404, "Resource not found");
    return onto("TO_STORE", destination.custodianId, true);
  }

  if (await isReturnShape(destination.currentOrgNodeId, items)) {
    // Sending something home is the lender's own standing already exercised, or the
    // host's own standing to let it go — see mayInitiateReturn's own header. The
    // ordinary pull's "you already hold this" refusal below is about a PULL
    // specifically (asking for something into a place you already run); it must not
    // block either return party, so this branches BEFORE reaching it.
    if (!(await mayInitiateReturn(actorId, input.itemIds))) throw new HttpError(404, "Resource not found");
    return onto("RETURN", null, false);
  }

  await scope.assertCanMutate(actorId, [destination.id]);

  const held = new Set(await scope.custodyItemIdsOf(actorId));
  if (input.itemIds.some((id) => held.has(id))) {
    throw new HttpError(400, "You already hold this resource. Use Move to place it elsewhere in your own lab.");
  }

  if (await allInCentralStore(input.itemIds)) return onto("FROM_STORE", destination.custodianId, true);
  if (input.transfer.permanent) return onto("PERMANENT", destination.custodianId, true);
  return onto("LOAN", null, false);
}

async function mayWrite(actorId: string, itemIds: string[]): Promise<boolean> {
  try {
    await scope.assertCanMutate(actorId, itemIds);
    return true;
  } catch {
    return false;
  }
}

/** Preview only — resolves what WOULD happen, commits nothing. What `TransferModal`
 *  calls before the requester commits to asking, so it can say "applies immediately"
 *  or "needs approval from X, then Y" up front. */
/** The request is about the top-most selected resources only — see
 *  `topMostItemIds`. Collapsed before anything else runs, so placement, policy and
 *  the stored payload all describe what will actually move. */
async function normalizeTransfer(input: TransferInput): Promise<TransferInput> {
  return { ...input, itemIds: await topMostItemIds(prisma, input.itemIds) };
}

/** What a store handover's items would be called at the destination (R2-3): the name
 *  the destination already uses for that category ("Workstation" beside Workstation
 *  01–20), and the names they'd get with the requested (or suggested) base. Offered
 *  only for a handover of one category; `planned` is a preview — the names are
 *  allocated live when the handover applies. */
async function handoverNaming(input: TransferInput, ctx: TransferContext): Promise<TransferNamingDto | undefined> {
  if (movementOf(input) !== "STORE_OUT") return undefined;
  const categoryIds = new Set(ctx.items.map((i) => i.categoryId));
  if (categoryIds.size !== 1) return undefined;
  const siblings = await prisma.item.findMany({
    where: { parentId: ctx.destination.id, deletedAt: null, id: { notIn: ctx.items.map((i) => i.id) } },
    select: { name: true, categoryId: true },
  });
  const bases = new Map<string, number>();
  for (const sib of siblings) {
    // Only a numbered scheme is a scheme: a lone "Teacher Table" says nothing about
    // what the next table should be called.
    const m = categoryIds.has(sib.categoryId) ? sib.name.match(/^(.*\S)\s+\d+$/) : null;
    if (m) bases.set(m[1], (bases.get(m[1]) ?? 0) + 1);
  }
  const suggested = [...bases].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const base = input.transfer.renameAs ?? suggested;
  return { suggested, planned: base ? allocateNames(base, siblings.map((x) => x.name), ctx.items.length) : [] };
}

export async function previewTransfer(
  actorId: string,
  rawInput: TransferInput,
): Promise<{ outcome: "APPLIED" | "ROUTED" | "DENIED"; reason: string; movement: MovementShape; steps?: ChainStepDto[]; naming?: TransferNamingDto }> {
  const { input, movement } = await assertTransferParties(actorId, await normalizeTransfer(rawInput));
  const ctx = await loadTransferContext(input);
  const clash = await findPendingClash(prisma, input.itemIds);
  if (clash) return { outcome: "DENIED", reason: clash, movement };
  const resolution = await resolveTransfer(actorId, input, ctx, movement);
  const naming = resolution.outcome === "DENIED" ? undefined : await handoverNaming(input, ctx);
  if (resolution.outcome !== "ROUTED") return { ...resolution, movement, ...(naming ? { naming } : {}) };

  // buildChain already resolved each step's approver against LIVE org data a moment
  // ago, so the ids here are current — only the display names need a lookup.
  const approverIds = [...new Set(resolution.steps.map((s) => s.approverId).filter((id): id is string => Boolean(id)))];
  const users = approverIds.length ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return {
    outcome: "ROUTED",
    reason: resolution.reason,
    movement,
    steps: resolution.steps.map((s) => toStepDto(s, s.approverId, s.approverId ? (nameById.get(s.approverId) ?? null) : null)),
    ...(naming ? { naming } : {}),
  };
}

export async function requestTransfer(actorId: string, rawInput: TransferInput): Promise<RequestTransferResultDto> {
  const { input, movement } = await assertTransferParties(actorId, await normalizeTransfer(rawInput));

  const ctx = await loadTransferContext(input);
  // Checked up front so an applied-at-once transfer can't carry off promised items
  // either, and again under the lock below for a routed one.
  const clash = await findPendingClash(prisma, input.itemIds);
  if (clash) throw new HttpError(409, clash);
  const resolution = await resolveTransfer(actorId, input, ctx, movement);

  if (resolution.outcome === "DENIED") throw new HttpError(403, resolution.reason);

  if (resolution.outcome === "APPLIED") {
    const result = await applyChange(actorId, input, { viaApprovalEngine: true });
    return { outcome: "APPLIED", result };
  }

  const baseVersions: Record<string, number> = Object.fromEntries(ctx.items.map((i) => [i.id, i.version]));
  const structuralSnapshot: Record<string, StructuralFields> = Object.fromEntries(ctx.items.map((i) => [i.id, structuralFieldsOf(i)]));

  const destination = await destinationLabel(prisma, ctx.destination.id);
  const requestId = await prisma.$transaction(async (tx) => {
    // One lock for every new transfer request: two requests over the same items can't
    // both pass the clash check before either is written. Requests are rare enough
    // that serializing them costs nothing noticeable.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lrms:transfer-request'))`;
    const raced = await findPendingClash(tx, input.itemIds);
    if (raced) throw new HttpError(409, raced);
    const request = await tx.changeRequest.create({
      data: {
        payload: input as unknown as Prisma.InputJsonValue,
        requesterId: actorId,
        status: "PENDING",
        baseVersions,
        structuralSnapshot: structuralSnapshot as unknown as Prisma.InputJsonValue,
        summary: summarize(ctx, input, destination),
        note: input.note ?? null,
      },
    });
    await tx.chainStep.createMany({
      data: resolution.steps.map((s) => ({
        requestId: request.id,
        order: s.order,
        selector: s.selector,
        label: s.label,
        nodeId: s.nodeId,
        approverId: s.approverId,
        status: s.status,
        skipReason: s.skipReason,
        receipt: s.receipt,
      })),
    });
    return request.id;
  });

  const request = await getRequest(actorId, requestId);
  await tellNextApprover(request, actorId);
  if (movement === "STORE_OUT") {
    await tellRecipient(request, input.transfer.targetCustodianId, actorId);
    await tellReceivingHead(request, input.transfer.targetOrgNodeId, actorId);
  }
  return { outcome: "ROUTED", request };
}

// ── Notifications (lib/server/mail/notify.ts) — always after the write commits ────

/** Whoever the request now waits on: an approver, or a custodian confirming receipt. */
async function tellNextApprover(request: ChangeRequestDto, actorId: string): Promise<void> {
  const step = request.steps.find((s) => s.status === "PENDING");
  if (!step?.approverId) return;
  await notify(step.approverId, actorId, {
    subject: `A transfer is waiting for you: ${request.summary}`,
    paragraphs: [
      `${esc(request.requesterName)}'s request has reached your step (${esc(step.label)}): <strong>${esc(request.summary)}</strong>.${quoted(request.note)}`,
      step.receipt ? "Confirm it under <strong>Approvals</strong> once it's with you. The button below opens it." : "Approve or reject it. The button below opens it.",
    ],
    path: paths.decide("transfer", request.id),
    action: "Open the request",
  });
}

/** A store handover or allocation: the person it is for hears about it now, not only
 *  once it reaches them to accept — staff and lab assistants follow what is coming. */
async function tellRecipient(request: ChangeRequestDto, recipientId: string | null, actorId: string): Promise<void> {
  const pending = request.steps.find((s) => s.status === "PENDING");
  if (!recipientId || pending?.approverId === recipientId) return;
  await notify(recipientId, actorId, {
    subject: `Coming to you from the store: ${request.summary}`,
    paragraphs: [
      `${esc(request.requesterName)} is handing over <strong>${esc(request.summary)}</strong> to you.${quoted(request.note)}`,
      "Once Property Administration approves it, accept it under <strong>Approvals</strong> when it is in your hands.",
    ],
    path: paths.decide("transfer", request.id),
    action: "Open the request",
  });
}

/** Stock coming from the store into a department: its head is told (not asked). */
async function tellReceivingHead(request: ChangeRequestDto, unitId: string, actorId: string): Promise<void> {
  const unit = await prisma.orgNode.findUnique({ where: { id: unitId }, select: { userId: true, kind: true } });
  if (!unit?.userId || unit.kind !== "DEPARTMENT") return;
  await notify(unit.userId, actorId, {
    subject: `Coming to your department from the store: ${request.summary}`,
    paragraphs: [`${esc(request.requesterName)} is sending <strong>${esc(request.summary)}</strong> from the store. Property Administration approves it, and the lab's custodian accepts it.${quoted(request.note)}`],
    path: paths.mine("transfer", request.id).replace("box=mine&", ""),
    action: "Open the request",
  });
}

async function tellRequesterOutcome(request: ChangeRequestDto, actorId: string): Promise<void> {
  const outcome =
    request.status === "APPLIED"
      ? ["is done", "Every step approved it, and the register now shows the change."]
      : request.status === "REJECTED"
        ? ["was rejected", "Nothing was moved."]
        : ["couldn't be applied", "Something it depends on changed while it was waiting, so nothing was moved. Raise it again if it's still needed."];
  await notify(request.requesterId, actorId, {
    subject: `Your transfer ${outcome[0]}: ${request.summary}`,
    paragraphs: [`<strong>${esc(request.summary)}</strong>: ${outcome[1]}${quoted(request.resolution)}`],
    path: paths.mine("transfer", request.id),
    declined: request.status !== "APPLIED",
  });
  // Whoever already approved it hears that it stopped, so nobody waits for something
  // that isn't coming (2026-10-03).
  if (request.status !== "APPLIED") {
    const approved = request.steps.filter((s) => s.status === "APPROVED" && s.approverId && s.approverId !== request.requesterId).map((s) => s.approverId);
    await notify(approved, actorId, {
      subject: `A transfer you approved ${outcome[0]}: ${request.summary}`,
      paragraphs: [`<strong>${esc(request.summary)}</strong>, asked for by ${esc(request.requesterName)}: ${outcome[1]}${quoted(request.resolution)}`],
      path: paths.decide("transfer", request.id).replace("?focus=", "?box=mine&focus="),
      declined: true,
    });
  }
}

// ── Deciding a step ──────────────────────────────────────────────────────────────

async function loadRequestWithSteps(requestId: string) {
  const request = await prisma.changeRequest.findUnique({
    where: { id: requestId },
    include: { steps: { orderBy: { order: "asc" } }, requester: { select: { name: true } } },
  });
  if (!request) throw new HttpError(404, "Request not found");
  return request;
}

type DecideOutcome = { done: true } | { done: false; requesterId: string; payload: TransferInput; freshVersions: Record<string, number>; at: Date; note?: string };

/**
 * Ends the request outright on REJECT (no draft to preserve here, unlike Track 2's
 * lab commits — see §6.3). On APPROVE, arms the next step; once every step (the
 * REQUESTER_RECEIPT included) is APPROVED or SKIPPED, applies the payload through
 * the ordinary write door, attributed to the ORIGINAL REQUESTER regardless of who
 * cast the last approval — the same attribution discipline Track 2 established.
 *
 * F-040 of the 2026-09-15 campaign: everything up to and including the chain-step
 * advancement now runs inside ONE transaction opened with an advisory lock keyed on
 * `requestId`, serialising concurrent decisions on the SAME request (a double-click
 * on "confirm receipt", two tabs). Before this, two concurrent calls could both pass
 * the PENDING check, both advance the same step, and — after the ITEM's own
 * optimistic version check correctly let only one `applyChange` actually win —
 * BOTH unconditionally overwrote the request's own status, so the loser's STALE
 * write could land last even though the register showed the transfer had gone
 * through. Serialised, a second concurrent caller now finds the step already
 * decided (`currentStep` returns nothing left to decide) and gets a plain 403,
 * never reaching the settle/apply logic at all — there is structurally only ever
 * one caller who can settle a given request, so the final `applyChange` and status
 * write need no lock of their own.
 */
export async function decideStep(actorId: string, requestId: string, decision: "APPROVE" | "REJECT", note?: string): Promise<ChangeRequestDto> {
  const request = await decideStepNow(actorId, requestId, decision, note);
  if (request.status === "PENDING") await tellNextApprover(request, actorId);
  else await tellRequesterOutcome(request, actorId);
  return request;
}

async function decideStepNow(actorId: string, requestId: string, decision: "APPROVE" | "REJECT", note?: string): Promise<ChangeRequestDto> {
  const outcome = await prisma.$transaction(async (tx): Promise<DecideOutcome> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;

    const request = await tx.changeRequest.findUnique({ where: { id: requestId }, include: { steps: { orderBy: { order: "asc" } } } });
    if (!request) throw new HttpError(404, "Request not found");
    if (request.status !== "PENDING") throw new HttpError(409, "This request has already been decided.");

    const payload = request.payload as unknown as TransferInput;
    const subjectRow = await tx.item.findUnique({ where: { id: payload.itemIds[0] } });
    const domainItem = subjectRow ? toDomainItem(subjectRow, []) : undefined;
    const nodes = await loadDomainOrgNodes();

    const domainSteps = request.steps.map(toDomainStep);
    const step = currentStep(domainSteps);
    const person = await loadPerson(actorId);
    if (!canDecide(step, person, nodes, domainItem)) {
      throw new HttpError(403, "This decision is not yours to make.");
    }

    const at = new Date();

    if (decision === "REJECT") {
      await tx.chainStep.update({ where: { id: step!.id }, data: { status: "REJECTED", decidedById: actorId, decidedAt: at, note: note ?? null } });
      await tx.changeRequest.update({ where: { id: requestId }, data: { status: "REJECTED", resolvedAt: at, resolution: note ?? null } });
      return { done: true };
    }

    // F-041, part 1 of the 2026-09-15 campaign: re-validate every subject item
    // BEFORE recording this decision — existence, and the fields a transfer
    // actually depends on (structuralFieldsOf's own note explains why not the
    // whole-row version). A mismatch fails the request immediately, named, instead
    // of walking every remaining step only to fail at the very last one with an
    // unexplained "Version conflict".
    const snapshot = request.structuralSnapshot as Record<string, StructuralFields> | null;
    if (snapshot) {
      const liveItems = await tx.item.findMany({ where: { id: { in: payload.itemIds } } });
      const liveById = new Map(liveItems.map((i) => [i.id, i]));
      const reasons = new Set<string>();
      for (const itemId of payload.itemIds) {
        const was = snapshot[itemId];
        if (!was) continue; // no snapshot for this id — never our own case, skip rather than false-flag
        const live = liveById.get(itemId);
        if (!live || live.deletedAt) reasons.add("an item this request names was deleted");
        else if (!structuralFieldsEqual(structuralFieldsOf(live), was)) reasons.add(`"${live.name}" was moved, re-owned, re-homed or given a new custodian since this request was raised`);
      }
      if (reasons.size) {
        await tx.changeRequest.update({ where: { id: requestId }, data: { status: "STALE", resolvedAt: at, resolution: [...reasons].join("; ") } });
        return { done: true };
      }
    }

    await tx.chainStep.update({ where: { id: step!.id }, data: { status: "APPROVED", decidedById: actorId, decidedAt: at, note: note ?? null } });

    const refreshedRows = await tx.chainStep.findMany({ where: { requestId }, orderBy: { order: "asc" } });
    const advanced = activate(refreshedRows.map(toDomainStep));
    for (let i = 0; i < advanced.length; i++) {
      if (refreshedRows[i].status !== advanced[i].status) {
        await tx.chainStep.update({ where: { id: refreshedRows[i].id }, data: { status: advanced[i].status } });
      }
    }

    if (!chainSettled(advanced)) return { done: true };

    // Fresh versions, taken right here under the lock, not the request's own
    // creation-time baseVersions — a rename tolerated by the structural check above
    // would have bumped those, incorrectly failing this final version check even
    // though nothing this transfer actually depends on changed (F-041).
    const finalItems = await tx.item.findMany({ where: { id: { in: payload.itemIds } } });
    const freshVersions: Record<string, number> = Object.fromEntries(finalItems.map((i) => [i.id, i.version]));
    return { done: false, requesterId: request.requesterId, payload, freshVersions, at, note };
  });

  if (outcome.done) return getRequest(actorId, requestId);

  const { requesterId, payload, freshVersions, at, note: settleNote } = outcome;
  try {
    const result = await applyChange(requesterId, { ...payload, expectedVersions: freshVersions }, { viaApprovalEngine: true });
    await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "APPLIED", resolvedAt: at, resolution: settleNote ?? null } });
    void result; // the applied ItemChangeResultDto isn't surfaced on the request itself — the change log already records it
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "One or more of these resources changed while this was waiting, so nothing was applied.";
    await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "STALE", resolvedAt: at, resolution: message } });
  }

  return getRequest(actorId, requestId);
}

export async function cancelRequest(actorId: string, requestId: string): Promise<void> {
  const request = await prisma.changeRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "PENDING") throw new HttpError(404, "Request not found");
  if (request.requesterId !== actorId) throw new HttpError(403, "Only the person who raised this request may cancel it.");
  await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", resolvedAt: new Date() } });
  const dto = await getRequest(actorId, requestId);
  await notify(dto.steps.find((s) => s.status === "PENDING")?.approverId, actorId, {
    subject: `Transfer withdrawn: ${dto.summary}`,
    paragraphs: [`${esc(dto.requesterName)} withdrew <strong>${esc(dto.summary)}</strong>. There's nothing left for you to decide.`],
    path: "/approvals",
  });
}

// ── Reading ──────────────────────────────────────────────────────────────────────

function toStepDto(step: DomainChainStep, liveApproverId: string | null, approverName: string | null): ChainStepDto {
  return {
    id: step.id,
    order: step.order,
    selector: step.selector,
    label: step.label,
    nodeId: step.nodeId,
    approverId: liveApproverId,
    approverName,
    status: step.status,
    skipReason: step.skipReason,
    receipt: step.receipt,
    decidedById: step.decidedById ?? null,
    decidedByName: null,
    decidedAt: step.decidedAt ?? null,
    note: step.note ?? null,
  };
}

async function toDto(request: Awaited<ReturnType<typeof loadRequestWithSteps>>): Promise<ChangeRequestDto> {
  const nodes = await loadDomainOrgNodes();
  const subjectPayload = request.payload as unknown as TransferInput;
  const subjectRow = subjectPayload?.itemIds?.[0] ? await prisma.item.findUnique({ where: { id: subjectPayload.itemIds[0] } }) : null;
  const domainItem = subjectRow ? toDomainItem(subjectRow, []) : undefined;

  const domainSteps = request.steps.map(toDomainStep);
  const userIds = new Set<string>();
  for (const s of domainSteps) {
    const live = s.status === "PENDING" || s.status === "WAITING" ? resolveApprover(s, { nodes, item: domainItem }) : s.approverId;
    if (live) userIds.add(live);
    if (s.decidedById) userIds.add(s.decidedById);
  }
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const steps: ChainStepDto[] = domainSteps.map((s) => {
    const liveId = s.status === "PENDING" || s.status === "WAITING" ? resolveApprover(s, { nodes, item: domainItem }) : s.approverId;
    return {
      id: s.id,
      order: s.order,
      selector: s.selector,
      label: s.label,
      nodeId: s.nodeId,
      approverId: liveId,
      approverName: liveId ? (nameById.get(liveId) ?? null) : null,
      status: s.status,
      skipReason: s.skipReason,
      receipt: s.receipt,
      decidedById: s.decidedById ?? null,
      decidedByName: s.decidedById ? (nameById.get(s.decidedById) ?? null) : null,
      decidedAt: s.decidedAt ?? null,
      note: s.note ?? null,
    };
  });

  return {
    id: request.id,
    requesterId: request.requesterId,
    requesterName: request.requester.name,
    createdAt: request.createdAt.toISOString(),
    status: request.status,
    steps,
    summary: request.summary,
    movement: movementOf(request.payload as never),
    note: request.note,
    resolvedAt: request.resolvedAt ? request.resolvedAt.toISOString() : null,
    resolution: request.resolution,
  };
}

/** Readable by the requester, any step's current or past resolved approver, or
 *  SYS_ADMIN — 404 otherwise (a 403 would confirm the row exists). */
export async function getRequest(actorId: string, requestId: string): Promise<ChangeRequestDto> {
  const request = await loadRequestWithSteps(requestId);
  const dto = await toDto(request);
  const isParty = actorId === request.requesterId || dto.steps.some((s) => s.approverId === actorId || s.decidedById === actorId);
  if (!isParty && !(await scope.isSysAdmin(actorId))) throw new HttpError(404, "Resource not found");
  return dto;
}

/** `"inbox"` — every PENDING request whose CURRENT step's live-resolved approver is
 *  this actor. `"mine"` — every request this actor raised, any status. These can
 *  legitimately overlap: a REQUESTER_RECEIPT step names the requester as its own
 *  approver, so a request someone raised reappears in their own inbox once it
 *  reaches that final step — expected, not a bug (§6.3). */
export async function listForActor(actorId: string, box: "inbox" | "mine"): Promise<ChangeRequestDto[]> {
  if (box === "mine") {
    const requests = await prisma.changeRequest.findMany({
      where: { requesterId: actorId },
      include: { steps: { orderBy: { order: "asc" } }, requester: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(requests.map(toDto));
  }

  const pending = await prisma.changeRequest.findMany({
    where: { status: "PENDING" },
    include: { steps: { orderBy: { order: "asc" } }, requester: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const dtos = await Promise.all(pending.map(toDto));
  return dtos.filter((d) => d.steps.some((s) => s.status === "PENDING" && s.approverId === actorId));
}

// ── Returning a borrowed resource to its owner ────────────────────────────────────

/**
 * Where something on loan goes back to: either side of the loan may send it home (the
 * lender asks for it back; the borrower, who runs the place it sits in, returns it on
 * their own, and their own release is then skipped). The suggestion is the place it
 * came from, read off the applied loan's snapshot, when that place still belongs to
 * the owner; the options are the owning unit's places.
 */
export async function returnTarget(actorId: string, itemId: string): Promise<{ suggested: { id: string; name: string } | null; options: Array<{ id: string; name: string }>; side: "LENDER" | "BORROWER" }> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, ownerOrgNodeId: true, currentOrgNodeId: true, deletedAt: true } });
  if (!item || item.deletedAt) throw new HttpError(404, "Resource not found");
  if (item.ownerOrgNodeId === item.currentOrgNodeId) throw new HttpError(400, "This resource isn't on loan: it already sits with its owning unit.");
  const lender = await mayWrite(actorId, [itemId]);
  const borrower = !lender && (await scope.custodyItemIdsOf(actorId)).includes(itemId);
  if (!lender && !borrower) throw new HttpError(403, "Only its own custodian (to ask for it back) or the custodian of the place holding it (to return it) can send it home.");

  const [loan] = await prisma.$queryRaw<{ snapshot: Prisma.JsonValue }[]>`
    SELECT "structuralSnapshot" AS snapshot FROM "ChangeRequest"
    WHERE status = 'APPLIED' AND (payload->'itemIds') @> jsonb_build_array(${itemId}::text)
    ORDER BY "createdAt" DESC LIMIT 1
  `;
  const fromParent = (loan?.snapshot as Record<string, { parentId?: string | null }> | null)?.[itemId]?.parentId ?? null;
  const origin = fromParent
    ? await prisma.item.findFirst({ where: { id: fromParent, deletedAt: null, currentOrgNodeId: item.ownerOrgNodeId }, select: { id: true, name: true } })
    : null;
  const places = await prisma.item.findMany({
    where: { parentId: null, deletedAt: null, currentOrgNodeId: item.ownerOrgNodeId, category: { isPlace: true } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const options = origin && !places.some((p) => p.id === origin.id) ? [origin, ...places] : places;
  return { suggested: origin, options, side: lender ? "LENDER" : "BORROWER" };
}

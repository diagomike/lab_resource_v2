import "server-only";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";

/**
 * "Staff holdings" — where resources issued to a person (a laptop for a lecturer, a
 * projector kept in an office) sit in the register. One place per department, like a
 * lab: owned by the department, answered for by its head, and each item inside is in
 * the custody of the staff member it was issued to.
 *
 * The category is ensured by its key rather than seeded, so an existing install
 * (production included) needs no data step: the first allocation to a person creates
 * it. It is a place: a root only, never booked, never impaired by what it holds.
 */
export const STAFF_HOLDINGS_KEY = "staff-holdings";

async function ensureCategory(): Promise<string> {
  const existing = await prisma.resourceCategory.findUnique({ where: { key: STAFF_HOLDINGS_KEY }, select: { id: true } });
  if (existing) return existing.id;
  const group = (await prisma.categoryGroup.findFirst({ where: { name: "Places" } })) ?? (await prisma.categoryGroup.create({ data: { name: "Places", sortOrder: 0 } }));
  const created = await prisma.resourceCategory.upsert({
    where: { key: STAFF_HOLDINGS_KEY },
    update: {},
    create: {
      key: STAFF_HOLDINGS_KEY,
      name: "Staff holdings",
      iconKey: "Users",
      groupId: group.id,
      countingMode: "SERIALIZED",
      impairRule: "NEVER",
      canBeRoot: true,
      // Places are roots: ONLY_LISTED with no rule means it never sits inside anything.
      placement: "ONLY_LISTED",
    },
    select: { id: true },
  });
  return created.id;
}

/** The department's Staff holdings place, created on first use. The department needs
 *  a head: they answer for the place, and approve what is issued into it. */
export async function ensureStaffHoldings(departmentId: string): Promise<{ id: string; name: string }> {
  const categoryId = await ensureCategory();
  const found = await prisma.item.findFirst({ where: { parentId: null, deletedAt: null, categoryId, ownerOrgNodeId: departmentId }, select: { id: true, name: true } });
  if (found) return found;

  const dept = await prisma.orgNode.findUnique({ where: { id: departmentId }, select: { name: true, active: true, userId: true } });
  if (!dept?.active) throw new HttpError(400, "That person's department is not active.");
  if (!dept.userId) throw new HttpError(400, `${dept.name} has no head yet, and a head answers for its Staff holdings. Ask an administrator to appoint one first.`);

  // One per department even if two first allocations race: a per-department lock.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lrms:staff-holdings:${departmentId}`}))`;
    const again = await tx.item.findFirst({ where: { parentId: null, deletedAt: null, categoryId, ownerOrgNodeId: departmentId }, select: { id: true, name: true } });
    if (again) return again;
    return tx.item.create({
      data: {
        categoryId,
        name: `Staff holdings — ${dept.name}`,
        countingMode: "SERIALIZED",
        status: "WORKING",
        ownerOrgNodeId: departmentId,
        currentOrgNodeId: departmentId,
        custodianId: dept.userId!,
      },
      select: { id: true, name: true },
    });
  });
}

/** Is this item a Staff holdings place? */
export async function isStaffHoldingsPlace(itemId: string): Promise<boolean> {
  const row = await prisma.item.findUnique({ where: { id: itemId }, select: { parentId: true, category: { select: { key: true } } } });
  return !!row && row.parentId === null && row.category.key === STAFF_HOLDINGS_KEY;
}

/** Staff holdings places this person answers for (as a department head). */
export async function staffHoldingsHeldBy(userId: string): Promise<string[]> {
  const rows = await prisma.item.findMany({ where: { parentId: null, deletedAt: null, custodianId: userId, category: { key: STAFF_HOLDINGS_KEY } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Who a store keeper may issue something to: an active member of staff with a
 *  department (never a student or an outside account). */
export async function assertIssuable(userId: string): Promise<{ id: string; name: string; homeNodeId: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
  const roles = user?.roles.map((r) => r.kind) ?? [];
  if (!user || user.status !== "ACTIVE" || !user.homeNodeId || !roles.some((r) => r !== "STUDENT" && r !== "EXTERNAL")) {
    throw new HttpError(400, "Choose an active member of staff who belongs to a department.");
  }
  return { id: user.id, name: user.name, homeNodeId: user.homeNodeId };
}

/** People a store keeper can issue to, matching a search. */
export async function issueRecipients(q: string): Promise<Array<{ id: string; name: string; title: string | null; departmentName: string }>> {
  const query = q.trim();
  if (query.length < 2) return [];
  const rows = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      homeNodeId: { not: null },
      roles: { some: { kind: { notIn: ["STUDENT", "EXTERNAL"] } } },
      OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query, mode: "insensitive" } }],
    },
    select: { id: true, name: true, title: true, homeNode: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 20,
  });
  return rows.map((r) => ({ id: r.id, name: r.name, title: r.title, departmentName: r.homeNode?.name ?? "" }));
}

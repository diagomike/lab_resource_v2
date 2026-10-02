import "server-only";
import type { CapabilitiesDto, RoleKind } from "@/lib/shared";
import { prisma } from "../prisma";

/**
 * Who someone is, as plain facts: their roles, and the posts they occupy (a department,
 * a college, the university root, an office). "Head" means OCCUPYING the node — never
 * the MANAGER role label (lib/server/org/scope.ts `isHeadOf`).
 *
 * Who manages places (creates labs and stores, assigns their custodians):
 *  - a department's head: that department;
 *  - a college's ADAA: the college's own stores (creates them), and who runs any lab or
 *    store in the college and its departments (`assignsPeopleIn`);
 *  - Property Administration: the university itself (the Main Store);
 *  - the admin: everything.
 * Deans do not (2026-10-02, by product direction): they approve, they don't run places.
 */
export async function capabilitiesOf(userId: string): Promise<CapabilitiesDto> {
  const [user, occupied] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { homeNodeId: true, roles: { select: { kind: true } } } }),
    prisma.orgNode.findMany({ where: { userId, active: true }, select: { id: true, kind: true, code: true } }),
  ]);
  const roles = (user?.roles ?? []).map((r) => r.kind as RoleKind);
  const has = (r: RoleKind) => roles.includes(r);

  const headOf = occupied.filter((n) => n.kind === "DEPARTMENT").map((n) => n.id);
  const deanOf = occupied.filter((n) => n.kind === "COLLEGE").map((n) => n.id);
  const isAvp = occupied.some((n) => n.kind === "UNIVERSITY");
  const officeCodes = occupied.filter((n) => n.kind === "OFFICE" && n.code).map((n) => n.code!);

  const adaaCollegeId = has("ADAA") && user?.homeNodeId ? await collegeOf(user.homeNodeId) : null;

  let managesPlacesIn: string[];
  if (has("SYS_ADMIN")) {
    managesPlacesIn = (await prisma.orgNode.findMany({ where: { active: true }, select: { id: true } })).map((n) => n.id);
  } else {
    const managed = new Set<string>(headOf);
    if (has("PROPERTY_ADMIN")) {
      const university = await prisma.orgNode.findFirst({ where: { kind: "UNIVERSITY", active: true }, select: { id: true } });
      if (university) managed.add(university.id);
    }
    managesPlacesIn = [...managed];
  }

  const assigns = new Set(managesPlacesIn);
  if (adaaCollegeId && !has("SYS_ADMIN")) {
    const below = await prisma.orgClosure.findMany({ where: { ancestorId: adaaCollegeId }, select: { descendantId: true } });
    for (const r of below) assigns.add(r.descendantId);
  }

  return {
    isAdmin: has("SYS_ADMIN"),
    isPropertyAdmin: has("PROPERTY_ADMIN"),
    isProcurement: has("PROCUREMENT"),
    isStoreKeeper: has("STORE_KEEPER"),
    isCustodian: has("CUSTODIAN"),
    isAdaa: has("ADAA"),
    headOf,
    deanOf,
    isAvp,
    officeCodes,
    adaaCollegeId,
    managesPlacesIn,
    managesStoresIn: adaaCollegeId && !has("SYS_ADMIN") ? [adaaCollegeId] : [],
    assignsPeopleIn: [...assigns],
  };
}

/** The college a unit sits in: itself when it is one, else its nearest college above. */
export async function collegeOf(nodeId: string): Promise<string | null> {
  const self = await prisma.orgNode.findUnique({ where: { id: nodeId }, select: { kind: true } });
  if (self?.kind === "COLLEGE") return nodeId;
  const up = await prisma.orgClosure.findMany({
    where: { descendantId: nodeId, ancestor: { kind: "COLLEGE", active: true } },
    select: { ancestorId: true, depth: true },
    orderBy: { depth: "asc" },
    take: 1,
  });
  return up[0]?.ancestorId ?? null;
}

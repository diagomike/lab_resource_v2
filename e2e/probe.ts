import { db, S } from "./lib";
async function main() {
  const cats = await db.resourceCategory.findMany({ select: { key: true, name: true, countingMode: true, bookingMode: true, canBeRoot: true, placement: true } });
  console.log(cats.map((c) => `${c.key}|${c.name}|${c.countingMode}|${c.bookingMode}|root:${c.canBeRoot}|${c.placement}`).join("\n"));
  for (const k of ["custSe", "custSe2", "custChem", "storekeeper", "admin"]) {
    const roots = await db.item.findMany({ where: { custodianId: S[k].id, parentId: null }, select: { id: true, name: true, category: { select: { key: true } }, ownerOrg: { select: { name: true } }, currentOrg: { select: { name: true } }, _count: { select: { children: true } } } });
    console.log(k, JSON.stringify(roots.map((r) => [r.id, r.name, r.category.key, r.ownerOrg.name, r.currentOrg.name, r._count.children])));
  }
  const loan = await db.item.findMany({ where: { NOT: { ownerOrgNodeId: { equals: undefined } } }, select: { id: true, name: true, ownerOrgNodeId: true, currentOrgNodeId: true, custodianId: true, parentId: true }, take: 0 });
  const loans = await db.$queryRaw`SELECT i.id, i.name, o.name owner, c.name cur, u.email cust, p.name parent FROM "Item" i JOIN "OrgNode" o ON o.id=i."ownerOrgNodeId" JOIN "OrgNode" c ON c.id=i."currentOrgNodeId" JOIN "User" u ON u.id=i."custodianId" LEFT JOIN "Item" p ON p.id=i."parentId" WHERE i."ownerOrgNodeId" <> i."currentOrgNodeId"`;
  console.log("loans", loans, loan.length);
  await db.$disconnect();
}
main();

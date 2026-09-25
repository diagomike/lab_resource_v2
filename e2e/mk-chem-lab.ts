import { post, db, S, nodeId } from "./lib";
async function main() {
  const chem = await nodeId("Chemical Engineering");
  const labCat = await db.resourceCategory.findUniqueOrThrow({ where: { key: "lab" } });
  const existing = await db.item.findFirst({ where: { name: "Mechanical Unit Operations Laboratory" } });
  if (existing) { console.log("exists", existing.id); return db.$disconnect(); }
  const r = await post("admin", "/resources/items/changes", { kind: "createItem", parentId: null, categoryId: labCat.id, count: 1, ownerOrgNodeId: chem, custodianId: S.custChem.id, name: "Mechanical Unit Operations Laboratory" });
  console.log("created", JSON.stringify(r.body));
  await db.$disconnect();
}
main();

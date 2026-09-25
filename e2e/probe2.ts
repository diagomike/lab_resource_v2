import { get, db, S, nodeId } from "./lib";
async function main() {
  const se = await nodeId("Software Engineering");
  for (const a of ["custChem", "staffChem"]) {
    const s = await get(a, "/resources/items?pageSize=200");
    const rows = s.body?.rows ?? s.body?.items ?? [];
    console.log(a, "search keys", Object.keys(s.body ?? {}), "sample row keys", rows[0] ? Object.keys(rows[0]) : null);
    const ids = rows.map((r: any) => r.id);
    const seRows = await db.item.findMany({ where: { id: { in: ids }, ownerOrgNodeId: se, currentOrgNodeId: se }, select: { id: true, name: true, custodianId: true } });
    console.log(a, "SE-only rows in SEARCH:", seRows.map((r) => `${r.name} cust=${r.custodianId === S.custChem.id ? "Hanna" : r.custodianId}`), rows.filter((r: any) => seRows.some((x) => x.id === r.id)).map((r: any) => r.readOnlyContext));
    const t = await get(a, "/resources/items/tree");
    const trows = t.body?.rows ?? t.body?.items ?? t.body ?? [];
    const tse = await db.item.findMany({ where: { id: { in: trows.map((r: any) => r.id) }, ownerOrgNodeId: se, currentOrgNodeId: se }, select: { id: true, name: true } });
    console.log(a, "SE-only rows in TREE:", tse.map((r) => r.name), trows.filter((r: any) => tse.some((x) => x.id === r.id)).map((r: any) => r.readOnlyContext));
  }
  const inSeLab = await db.item.findMany({ where: { parent: { name: "SE Lab X — Software Lab 3" }, OR: [{ custodianId: S.custChem.id }, { ownerOrgNodeId: { not: se } }] }, select: { name: true, ownerOrgNodeId: true, custodianId: true } });
  console.log("foreign things inside SE Lab X:", inSeLab);
  const r = require("./results.json").find((x: any) => x.id === "V-11");
  console.log("V-11", JSON.stringify(r.evidence));
  const route = require("fs").readFileSync("app/api/resources/labs/[labItemId]/ideal-vs-actual/route.ts", "utf8");
  console.log(route.split("\n").filter((l: string) => !/^\s*(\*|\/\*\*|\/\/|import)/.test(l)).join("\n"));
  await db.$disconnect();
}
main();

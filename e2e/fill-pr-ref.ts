// Unblocks count-based PR numbering after B-17 (see F-04x): inserts one CANCELLED filler row so count+1 is free again.
import { db } from "./lib";
async function main() {
  const any = await db.purchaseRequest.findFirstOrThrow();
  const n = await db.purchaseRequest.count({ where: { reference: { startsWith: "PR-E2E-FILL" } } });
  await db.purchaseRequest.create({ data: { reference: `PR-E2E-FILL-${n + 1}`, orgNodeId: any.orgNodeId, raisedById: any.raisedById, title: "E2E filler (numbering workaround)", stage: "CANCELLED" } });
  console.log("filler inserted");
  await db.$disconnect();
}
main();

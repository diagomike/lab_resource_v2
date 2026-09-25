// Clears leftover PurchaseRequest/NeedLine rows the earlier E2E campaign run left on
// the CLONE database, so the vitest suite's own MAX(reference)+1 numbering starts clean.
import { db } from "./lib";
async function main() {
  await db.purchaseEvent.deleteMany({});
  await db.purchaseStep.deleteMany({});
  await db.needLine.updateMany({ data: { purchaseLineId: null } });
  await db.purchaseLine.deleteMany({});
  await db.purchaseRequest.deleteMany({});
  await db.needLine.deleteMany({});
  console.log("purchasing tables cleared on the clone");
  await db.$disconnect();
}
main();

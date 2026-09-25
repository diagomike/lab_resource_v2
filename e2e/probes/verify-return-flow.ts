// F-039 verification: the actual return flow works both ways, not just that abuse
// (the bare cross-unit moveInTree) is blocked. Run against the e2e clone only.
import { post, get, db, done, nodeId, S } from "../lib";

async function catId(key: string) {
  return (await db.resourceCategory.findUniqueOrThrow({ where: { key } })).id;
}

async function main() {
  const se = await nodeId("Software Engineering");
  const chem = await nodeId("Chemical Engineering");
  const whiteboard = await catId("whiteboard");
  const girmaLab = await db.item.findFirstOrThrow({ where: { name: "SE Lab X — Software Lab 3" } });
  const chemStore = await db.item.findFirstOrThrow({ where: { name: "Chemistry Store — Room C-12" } });

  const change = (a: string, b: unknown) => post(a, "/resources/items/changes", b);
  const decide = (a: string, id: string, decision: "APPROVE" | "REJECT") => post(a, `/resources/transfers/${id}/decide`, { decision });
  const pull = (a: string, itemIds: string[], targetParentId: string) => post(a, "/resources/transfers", { input: { kind: "transferItem", itemIds, transfer: { targetParentId, targetOrgNodeId: "decoy", targetCustodianId: null } } });

  // ── Case 1: lender-initiated return ──────────────────────────────────────
  const b1 = (await change("admin", { kind: "createItem", parentId: girmaLab.id, categoryId: whiteboard, count: 1, name: "Return Test A" })).body.itemIds[0];
  const pullReq = await pull("custChem", [b1], chemStore.id);
  if (pullReq.body?.outcome !== "ROUTED") throw new Error("setup pull did not route: " + JSON.stringify(pullReq.body));
  const pid = pullReq.body.request.id;
  await decide("custSe", pid, "APPROVE");
  await decide("headSe", pid, "APPROVE");
  await decide("headChem", pid, "APPROVE");
  await decide("custChem", pid, "APPROVE"); // receipt — now on loan in ChemE's store

  const preview1 = await post("custSe", "/resources/transfers/preview", { input: { kind: "transferItem", itemIds: [b1], transfer: { targetParentId: girmaLab.id, targetOrgNodeId: "decoy", targetCustodianId: null } } });
  const req1 = await pull("custSe", [b1], girmaLab.id);
  console.log("lender-initiated return: preview.outcome=", preview1.body?.outcome, "request.outcome=", req1.body?.outcome, "chain=", (req1.body?.request?.steps ?? []).map((s: any) => s.label));
  if (req1.body?.outcome === "ROUTED") {
    const rid = req1.body.request.id;
    const hostReleaseStep = req1.body.request.steps[0];
    console.log("  host releaser resolved to:", hostReleaseStep.approverName, "(expect Hanna Bekele)");
    const r1 = await decide("custChem", rid, "APPROVE"); // Hanna releases
    const r2 = await decide("custSe", rid, "APPROVE"); // Girma confirms receipt (OWNER_RECEIPT)
    const after1 = await db.item.findUniqueOrThrow({ where: { id: b1 } });
    console.log("  release:", r1.status, "receipt:", r2.status, "final parentId==girmaLab:", after1.parentId === girmaLab.id, "currentOrgNodeId==se:", after1.currentOrgNodeId === se);
  } else {
    console.log("  FAILED: lender-initiated return did not route. Full body:", JSON.stringify(req1.body));
  }

  // ── Case 2: host-initiated return ────────────────────────────────────────
  const b2 = (await change("admin", { kind: "createItem", parentId: girmaLab.id, categoryId: whiteboard, count: 1, name: "Return Test B" })).body.itemIds[0];
  const pullReq2 = await pull("custChem", [b2], chemStore.id);
  const pid2 = pullReq2.body.request.id;
  await decide("custSe", pid2, "APPROVE");
  await decide("headSe", pid2, "APPROVE");
  await decide("headChem", pid2, "APPROVE");
  await decide("custChem", pid2, "APPROVE");

  const req2 = await pull("custChem", [b2], girmaLab.id); // HOST (Hanna) initiates
  console.log("host-initiated return: request.outcome=", req2.body?.outcome, "chain=", (req2.body?.request?.steps ?? []).map((s: any) => s.label));
  if (req2.body?.outcome === "ROUTED") {
    const rid2 = req2.body.request.id;
    const steps = req2.body.request.steps;
    console.log("  HOST_RELEASE step status (expect SKIPPED, self-held):", steps[0].status);
    const r3 = await decide("custSe", rid2, "APPROVE"); // Girma (owner custodian) confirms receipt
    const after2 = await db.item.findUniqueOrThrow({ where: { id: b2 } });
    console.log("  receipt:", r3.status, "final parentId==girmaLab:", after2.parentId === girmaLab.id, "currentOrgNodeId==se:", after2.currentOrgNodeId === se);
  } else {
    console.log("  FAILED: host-initiated return did not route. Full body:", JSON.stringify(req2.body));
  }

  // cleanup
  await change("admin", { kind: "deleteItem", itemIds: [b1, b2] }).catch(() => {});
  await done();
}
main().catch((e) => { console.error(e); process.exit(1); });

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** DB-backed — live chain resolution against real org nodes/heads, vacancy/handoff
 *  behaviour, and version-conflict handling are not provable as pure logic (the pure
 *  half already lives in lib/domain/approvals.spec.ts, 45 tests). See
 *  university-scope.spec.ts's header for the `.env`-loading detail; identical here.
 *
 *  Every org node used here is a freshly created, ORPHAN node (no parent edges) —
 *  never the shared seeded SE/ChemE departments other spec files' fixtures also read
 *  and write concurrently. Track 2's own lab-drafts.spec.ts found this the hard way
 *  (hijacking the real SE node's occupancy broke other tests running in parallel);
 *  this file follows that lesson from the start. */
function loadDotEnv(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), ".env");
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadDotEnv();

type ApprovalsModule = typeof import("./approvals");
type MutateModule = typeof import("./mutate");
type CategoriesModule = typeof import("./categories");
type PrismaModule = typeof import("../prisma");

let approvals: ApprovalsModule;
let mutate: MutateModule;
let categories: CategoriesModule;
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let groupId: string;
let categoryId: string;
const testKey = `__test-approvals-${Date.now()}`;

const createdUserIds: string[] = [];
const createdNodeIds: string[] = [];
const createdItemIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdRequestIds: string[] = [];

let userCounter = 0;

async function makeUser(suffix: string, roles: string[] = []) {
  const email = `${testKey}-${suffix}-${userCounter++}@astu.edu.et`;
  const user = await prisma.user.create({
    data: { email, emailLower: email, name: `Test ${suffix}`, status: "ACTIVE", roles: { create: roles.map((kind) => ({ kind: kind as never })) } },
  });
  createdUserIds.push(user.id);
  return user.id;
}

/** A standalone, orphan department node — no parent edges, so it never touches the
 *  real org chart other tests share. `headId: null` is a deliberately vacant post. */
async function makeNode(name: string, headId: string | null) {
  const node = await prisma.orgNode.create({ data: { name: `${testKey}-${name}`, level: 9, kind: "DEPARTMENT", active: true, userId: headId } });
  createdNodeIds.push(node.id);
  return node.id;
}

async function setHead(nodeId: string, headId: string | null) {
  await prisma.orgNode.update({ where: { id: nodeId }, data: { userId: headId } });
}

async function makeItem(ownerOrgNodeId: string, custodianId: string, name: string) {
  const item = await prisma.item.create({
    data: { categoryId, name, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId, currentOrgNodeId: ownerOrgNodeId, custodianId },
  });
  createdItemIds.push(item.id);
  return item.id;
}

async function makePolicy(input: { id: string; actorRole: string | null; outcome: "AUTO" | "CHAIN" | "DENY"; appliesTo?: unknown; chain?: unknown }) {
  await prisma.approvalPolicy.create({
    data: {
      id: input.id,
      name: input.id,
      operation: "transferItem",
      appliesTo: (input.appliesTo ?? { type: "ANY" }) as never,
      actorRole: input.actorRole as never,
      outcome: input.outcome,
      chain: (input.chain ?? undefined) as never,
    },
  });
  createdPolicyIds.push(input.id);
}

function transferInput(itemIds: string[], targetParentId: string, targetOrgNodeId: string, targetCustodianId: string | null = null) {
  return { kind: "transferItem" as const, itemIds, transfer: { targetParentId, targetOrgNodeId, targetCustodianId } };
}

const CUSTODIAN_CHAIN = [{ type: "ITEM_CUSTODIAN" }, { type: "OWNER_HEAD" }, { type: "TARGET_HEAD" }, { type: "REQUESTER_RECEIPT" }];

beforeAll(async () => {
  approvals = await import("./approvals");
  mutate = await import("./mutate");
  categories = await import("./categories");
  ({ prisma } = await import("../prisma"));

  const sysAdmin = await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } });
  sysAdminId = sysAdmin.id;

  const group = await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } });
  groupId = group.id;
  const category = await categories.create(sysAdminId, {
    key: testKey,
    name: "Approvals Test Category",
    iconKey: "Package",
    groupId,
    countingMode: "SERIALIZED",
    impairRule: "ANY_CRITICAL",
    canBeRoot: true,
    placement: "ANYWHERE",
    allowedParentCategoryIds: [],
    fields: [],
    templateChildren: [],
  });
  categoryId = category.id;

  await makePolicy({ id: `${testKey}-auto-propadmin`, actorRole: "PROPERTY_ADMIN", outcome: "AUTO" });
  await makePolicy({ id: `${testKey}-chain-custodian`, actorRole: "CUSTODIAN", outcome: "CHAIN", chain: CUSTODIAN_CHAIN });
});

afterAll(async () => {
  await prisma.chainStep.deleteMany({ where: { requestId: { in: createdRequestIds } } });
  await prisma.changeRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
  await prisma.approvalPolicy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.itemChange.deleteMany({ where: { OR: [{ itemId: { in: createdItemIds } }, { categoryId }] } });
  await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
  await prisma.orgNode.deleteMany({ where: { id: { in: createdNodeIds } } });
  await prisma.resourceCategory.delete({ where: { id: categoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("the closed loophole — direct transferItem is refused, even custodying both ends", () => {
  it("a non-SYS_ADMIN direct applyChange call with kind: transferItem is refused regardless of custody", async () => {
    const bothEndsId = await makeUser("both-ends");
    const ownerNodeId = await makeNode("loophole-owner", bothEndsId);
    const destLabId = await makeItem(ownerNodeId, bothEndsId, "Loophole Dest Lab");
    const sourceId = await makeItem(ownerNodeId, bothEndsId, "Loophole Source Item");

    await expect(mutate.applyChange(bothEndsId, transferInput([sourceId], destLabId, ownerNodeId))).rejects.toMatchObject({ status: 403 });

    const after = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(after.parentId).toBeNull();
  });

  it("SYS_ADMIN may still call it directly — unaffected", async () => {
    const ownerId = await makeUser("sysadmin-both-ends-owner");
    const ownerNodeId = await makeNode("loophole-sysadmin", ownerId);
    const destLabId = await makeItem(ownerNodeId, ownerId, "Loophole SysAdmin Dest");
    const sourceId = await makeItem(ownerNodeId, ownerId, "Loophole SysAdmin Source");

    const result = await mutate.applyChange(sysAdminId, transferInput([sourceId], destLabId, ownerNodeId));
    expect(result.applied).toBe(1);
  });
});

describe("requestTransfer — policy resolution (pull: the requester holds the destination)", () => {
  it("AUTO applies immediately; no ChangeRequest row is created", async () => {
    const propAdminId = await makeUser("auto-propadmin", ["PROPERTY_ADMIN"]);
    const lenderId = await makeUser("auto-lender", ["CUSTODIAN"]);
    const ownerNodeId = await makeNode("auto-owner", null);
    const targetNodeId = await makeNode("auto-target", null);
    const destLabId = await makeItem(targetNodeId, propAdminId, "Auto Dest Lab");
    const sourceId = await makeItem(ownerNodeId, lenderId, "Auto Source Item");

    const before = await prisma.changeRequest.count();
    const result = await approvals.requestTransfer(propAdminId, transferInput([sourceId], destLabId, targetNodeId));
    expect(result.outcome).toBe("APPLIED");

    const after = await prisma.changeRequest.count();
    expect(after).toBe(before);

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).toBe(targetNodeId);
    expect(item.parentId).toBe(destLabId);
    expect(item.custodianId).toBe(lenderId); // a borrow — custody stays with the lender
  });

  it("an actor with no matching policy is DENIED (no matching rule means DENY)", async () => {
    const staffId = await makeUser("deny-staff", ["STAFF"]);
    const lenderId = await makeUser("deny-lender", ["CUSTODIAN"]);
    const ownerNodeId = await makeNode("deny-owner", null);
    const targetNodeId = await makeNode("deny-target", null);
    const destLabId = await makeItem(targetNodeId, staffId, "Deny Dest Lab");
    const sourceId = await makeItem(ownerNodeId, lenderId, "Deny Source Item");

    await expect(approvals.requestTransfer(staffId, transferInput([sourceId], destLabId, targetNodeId))).rejects.toMatchObject({ status: 403 });
  });

  it("CHAIN creates one ChangeRequest; the lender's custodian step is the first armed step, and nothing on Item moves yet", async () => {
    const requesterId = await makeUser("chain-requester", ["CUSTODIAN"]);
    const lenderId = await makeUser("chain-lender", ["CUSTODIAN"]);
    const ownerHeadId = await makeUser("chain-owner-head");
    const targetHeadId = await makeUser("chain-target-head");
    const ownerNodeId = await makeNode("chain-owner", ownerHeadId);
    const targetNodeId = await makeNode("chain-target", targetHeadId);
    // The dest lab's own custodian IS the requester — pulling into their OWN lab,
    // the common case, so F-042's "ask the destination's custodian, when it
    // differs" step is correctly omitted here (covered separately below).
    const destLabId = await makeItem(targetNodeId, requesterId, "Chain Dest Lab");
    const sourceId = await makeItem(ownerNodeId, lenderId, "Chain Source Item");

    const result = await approvals.requestTransfer(requesterId, transferInput([sourceId], destLabId, targetNodeId));
    expect(result.outcome).toBe("ROUTED");
    if (result.outcome !== "ROUTED") throw new Error("unreachable");
    createdRequestIds.push(result.request.id);

    expect(result.request.steps.map((s) => s.selector)).toEqual(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "REQUESTER_RECEIPT"]);
    expect([result.request.steps[0].status, result.request.steps[0].approverId]).toEqual(["PENDING", lenderId]);
    expect([result.request.steps[1].status, result.request.steps[1].approverId]).toEqual(["WAITING", ownerHeadId]);
    expect(result.request.steps[2].approverId).toBe(targetHeadId);
    expect(result.request.steps[3].approverId).toBe(requesterId);

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).toBe(ownerNodeId); // unchanged
  });

  it("the receiving unit is read off the destination, never trusted from the client", async () => {
    const requesterId = await makeUser("derive-requester", ["CUSTODIAN"]);
    const lenderId = await makeUser("derive-lender", ["CUSTODIAN"]);
    const ownerNodeId = await makeNode("derive-owner", await makeUser("derive-owner-head"));
    const targetNodeId = await makeNode("derive-target", await makeUser("derive-target-head"));
    const decoyNodeId = await makeNode("derive-decoy", null);
    const destLabId = await makeItem(targetNodeId, requesterId, "Derive Dest Lab");
    const sourceId = await makeItem(ownerNodeId, lenderId, "Derive Source Item");

    const result = await approvals.requestTransfer(requesterId, transferInput([sourceId], destLabId, decoyNodeId, requesterId));
    if (result.outcome !== "ROUTED") throw new Error("expected ROUTED");
    createdRequestIds.push(result.request.id);
    const stored = await prisma.changeRequest.findUniqueOrThrow({ where: { id: result.request.id } });
    expect((stored.payload as { transfer: unknown }).transfer).toEqual({ targetParentId: destLabId, targetOrgNodeId: targetNodeId, targetCustodianId: null });
  });
});

describe("decideStep — vacancy, handoff, receipt-gated apply", () => {
  async function setUpChain() {
    const requesterId = await makeUser("flow-requester", ["CUSTODIAN"]);
    const lenderId = await makeUser("flow-lender", ["CUSTODIAN"]);
    const ownerHeadId = await makeUser("flow-owner-head");
    const targetHeadId = await makeUser("flow-target-head");
    const ownerNodeId = await makeNode("flow-owner", ownerHeadId);
    const targetNodeId = await makeNode("flow-target", targetHeadId);
    // The dest lab's own custodian is the requester (pulling into their own lab),
    // which keeps this fixture's chain at the plain 4-step shape (ITEM_CUSTODIAN,
    // OWNER_HEAD, TARGET_HEAD, REQUESTER_RECEIPT) — these tests are about
    // vacancy/handoff/staleness generically, not F-042's own fix.
    const destLabId = await makeItem(targetNodeId, requesterId, "Flow Dest Lab");
    const sourceId = await makeItem(ownerNodeId, lenderId, "Flow Source Item");

    const result = await approvals.requestTransfer(requesterId, transferInput([sourceId], destLabId, targetNodeId));
    if (result.outcome !== "ROUTED") throw new Error("expected ROUTED");
    createdRequestIds.push(result.request.id);
    return { requestId: result.request.id, requesterId, lenderId, ownerHeadId, targetHeadId, ownerNodeId, targetNodeId, sourceId, destLabId };
  }

  it("a vacant OWNER_HEAD blocks — undecidable by anyone — and appointing someone unblocks it immediately", async () => {
    const { requestId, ownerNodeId, requesterId, lenderId } = await setUpChain();
    await approvals.decideStep(lenderId, requestId, "APPROVE");
    await setHead(ownerNodeId, null);

    await expect(approvals.decideStep(requesterId, requestId, "APPROVE")).rejects.toMatchObject({ status: 403 });

    const req = await approvals.getRequest(requesterId, requestId);
    expect(req.steps.find((s) => s.selector === "OWNER_HEAD")?.approverId).toBeNull();

    const newHeadId = await makeUser("flow-new-owner-head");
    await setHead(ownerNodeId, newHeadId);
    const decided = await approvals.decideStep(newHeadId, requestId, "APPROVE");
    expect(decided.steps.find((s) => s.selector === "OWNER_HEAD")?.status).toBe("APPROVED");
  });

  it("a headship change mid-flight redirects the decision to the NEW head", async () => {
    const { requestId, lenderId, ownerHeadId, targetNodeId, targetHeadId } = await setUpChain();
    await approvals.decideStep(lenderId, requestId, "APPROVE");
    await approvals.decideStep(ownerHeadId, requestId, "APPROVE");

    const newTargetHeadId = await makeUser("flow-new-target-head");
    await setHead(targetNodeId, newTargetHeadId);

    await expect(approvals.decideStep(targetHeadId, requestId, "APPROVE")).rejects.toMatchObject({ status: 403 });
    const decided = await approvals.decideStep(newTargetHeadId, requestId, "APPROVE");
    expect(decided.steps.find((s) => s.selector === "TARGET_HEAD")?.decidedById).toBe(newTargetHeadId);
  });

  it("full happy path: the Item is untouched until REQUESTER_RECEIPT is confirmed, then lands in the requester's lab, attributed to the requester", async () => {
    const { requestId, requesterId, lenderId, ownerHeadId, targetHeadId, sourceId, targetNodeId, ownerNodeId, destLabId } = await setUpChain();

    await approvals.decideStep(lenderId, requestId, "APPROVE");
    await approvals.decideStep(ownerHeadId, requestId, "APPROVE");
    await approvals.decideStep(targetHeadId, requestId, "APPROVE");
    let item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).not.toBe(targetNodeId); // still not applied — receipt is the last step

    const final = await approvals.decideStep(requesterId, requestId, "APPROVE"); // confirm receipt
    expect(final.status).toBe("APPLIED");

    item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect([item.parentId, item.currentOrgNodeId, item.ownerOrgNodeId, item.custodianId]).toEqual([destLabId, targetNodeId, ownerNodeId, lenderId]);

    const change = await prisma.itemChange.findFirstOrThrow({ where: { itemId: sourceId, kind: "transferItem" } });
    expect(change.actorId).toBe(requesterId); // attributed to the requester, not the last approver
  });

  it("REJECT ends the whole request outright; the Item is never touched", async () => {
    const { requestId, lenderId, sourceId, ownerNodeId } = await setUpChain();
    const decided = await approvals.decideStep(lenderId, requestId, "REJECT", "not right now");
    expect(decided.status).toBe("REJECTED");
    expect(decided.resolution).toBe("not right now");

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).toBe(ownerNodeId);

    await expect(approvals.decideStep(lenderId, requestId, "APPROVE")).rejects.toMatchObject({ status: 409 });
  });

  it("a rename mid-flight does not void an approved transfer (F-041) — it still applies, using a fresh version", async () => {
    const { requestId, requesterId, lenderId, ownerHeadId, targetHeadId, sourceId, targetNodeId, destLabId, ownerNodeId } = await setUpChain();
    await approvals.decideStep(lenderId, requestId, "APPROVE");
    await approvals.decideStep(ownerHeadId, requestId, "APPROVE");
    await approvals.decideStep(targetHeadId, requestId, "APPROVE");

    // A cosmetic edit bumps the item's own row version but changes none of the
    // fields a transfer actually depends on (parent/owner/current unit/custodian)
    // — F-041 of the 2026-09-15 campaign: this used to void the whole chain at the
    // very last (receipt) step with an unexplained "Version conflict", even though
    // nothing the approvers actually signed off on had changed.
    await mutate.applyChange(sysAdminId, { kind: "setName", itemIds: [sourceId], value: "Renamed mid-flight" });

    const final = await approvals.decideStep(requesterId, requestId, "APPROVE");
    expect(final.status).toBe("APPLIED");

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.name).toBe("Renamed mid-flight");
    expect([item.parentId, item.currentOrgNodeId, item.ownerOrgNodeId, item.custodianId]).toEqual([destLabId, targetNodeId, ownerNodeId, lenderId]);
  });

  it("a structural change mid-flight (not a rename) DOES mark the request STALE, named (F-041)", async () => {
    const { requestId, requesterId, lenderId, ownerHeadId, targetHeadId, sourceId, targetNodeId } = await setUpChain();
    await approvals.decideStep(lenderId, requestId, "APPROVE");
    await approvals.decideStep(ownerHeadId, requestId, "APPROVE");
    await approvals.decideStep(targetHeadId, requestId, "APPROVE");

    // A real structural change this time — the source item's own custodian moves —
    // one of the fields structuralFieldsOf actually compares.
    const otherCustodianId = await makeUser("mid-flight-new-custodian", ["CUSTODIAN"]);
    await prisma.item.update({ where: { id: sourceId }, data: { custodianId: otherCustodianId } });

    const final = await approvals.decideStep(requesterId, requestId, "APPROVE");
    expect(final.status).toBe("STALE");
    expect(final.resolution).toContain("custodian");

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).not.toBe(targetNodeId);
  });

  it("losing custody of the destination while the request waits marks it STALE instead of landing somewhere they no longer hold", async () => {
    const { requestId, requesterId, lenderId, ownerHeadId, targetHeadId, sourceId, destLabId, targetNodeId } = await setUpChain();
    await approvals.decideStep(lenderId, requestId, "APPROVE");
    await approvals.decideStep(ownerHeadId, requestId, "APPROVE");
    await approvals.decideStep(targetHeadId, requestId, "APPROVE");

    await prisma.item.update({ where: { id: destLabId }, data: { custodianId: targetHeadId } });

    const final = await approvals.decideStep(requesterId, requestId, "APPROVE");
    expect(final.status).toBe("STALE");
    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).not.toBe(targetNodeId);
  });
});

describe("cancelRequest", () => {
  it("the requester may cancel their own PENDING request; a non-requester may not", async () => {
    const requesterId = await makeUser("cancel-requester", ["CUSTODIAN"]);
    const lenderId = await makeUser("cancel-lender", ["CUSTODIAN"]);
    const ownerHeadId = await makeUser("cancel-owner-head");
    const targetHeadId = await makeUser("cancel-target-head");
    const ownerNodeId = await makeNode("cancel-owner", ownerHeadId);
    const targetNodeId = await makeNode("cancel-target", targetHeadId);
    const destLabId = await makeItem(targetNodeId, requesterId, "Cancel Dest Lab");
    const sourceId = await makeItem(ownerNodeId, lenderId, "Cancel Source Item");

    const result = await approvals.requestTransfer(requesterId, transferInput([sourceId], destLabId, targetNodeId));
    if (result.outcome !== "ROUTED") throw new Error("expected ROUTED");
    createdRequestIds.push(result.request.id);

    await expect(approvals.cancelRequest(ownerHeadId, result.request.id)).rejects.toMatchObject({ status: 403 });
    await approvals.cancelRequest(requesterId, result.request.id);
    const req = await approvals.getRequest(requesterId, result.request.id);
    expect(req.status).toBe("CANCELLED");
  });
});

describe("pull floors — who may ask for what, into where", () => {
  it("pulling into a destination you don't hold is refused (404), like any out-of-custody write", async () => {
    const outsiderId = await makeUser("outsider", ["CUSTODIAN"]);
    const ownerId = await makeUser("floor-owner", ["CUSTODIAN"]);
    const ownerNodeId = await makeNode("floor-owner-node", null);
    const targetNodeId = await makeNode("floor-target-node", null);
    const destLabId = await makeItem(targetNodeId, ownerId, "Floor Dest Lab");
    const sourceId = await makeItem(ownerNodeId, ownerId, "Floor Source Item");

    await expect(approvals.requestTransfer(outsiderId, transferInput([sourceId], destLabId, targetNodeId))).rejects.toMatchObject({ status: 404 });
    await expect(approvals.previewTransfer(outsiderId, transferInput([sourceId], destLabId, targetNodeId))).rejects.toMatchObject({ status: 404 });
  });

  it("pulling something you already hold is refused (400) — that is a Move", async () => {
    const custodianId = await makeUser("own-item", ["CUSTODIAN"]);
    const nodeId = await makeNode("own-item-node", null);
    const labA = await makeItem(nodeId, custodianId, "Own Lab A");
    const sourceId = await makeItem(nodeId, custodianId, "Own Source Item");

    await expect(approvals.requestTransfer(custodianId, transferInput([sourceId], labA, nodeId))).rejects.toMatchObject({ status: 400 });
  });
});

describe("store handover — the main store hands stock over to a department", () => {
  const STORE_CHAIN = [{ type: "TARGET_HEAD" }, { type: "TARGET_CUSTODIAN" }];

  function handoverInput(itemIds: string[], targetParentId: string, targetOrgNodeId: string, targetCustodianId: string) {
    return { kind: "transferItem" as const, itemIds, transfer: { targetParentId, targetOrgNodeId, targetCustodianId, transferOwnership: true } };
  }

  beforeAll(async () => {
    await makePolicy({ id: `${testKey}-chain-storekeeper`, actorRole: "STORE_KEEPER", outcome: "CHAIN", chain: STORE_CHAIN });
  });

  it("routes receiving head → receiving custodian; owner, current unit and custody all move only once the custodian accepts", async () => {
    const keeperId = await makeUser("store-keeper", ["STORE_KEEPER", "STAFF"]);
    const labHeadId = await makeUser("store-lab-head", ["MANAGER"]);
    const labCustodianId = await makeUser("store-lab-custodian", ["CUSTODIAN"]);
    const storeNodeId = await makeNode("store-university", null);
    const deptNodeId = await makeNode("store-dept", labHeadId);
    const labId = await makeItem(deptNodeId, labCustodianId, "Handover Dest Lab");
    const stockA = await makeItem(storeNodeId, keeperId, "Handover Stock A");
    const stockB = await makeItem(storeNodeId, keeperId, "Handover Stock B");

    const preview = await approvals.previewTransfer(keeperId, handoverInput([stockA, stockB], labId, deptNodeId, labCustodianId));
    expect(preview.outcome).toBe("ROUTED");
    expect(preview.steps?.map((s) => [s.selector, s.approverId])).toEqual([
      ["TARGET_HEAD", labHeadId],
      ["TARGET_CUSTODIAN", labCustodianId],
    ]);

    const result = await approvals.requestTransfer(keeperId, handoverInput([stockA, stockB], labId, deptNodeId, labCustodianId));
    if (result.outcome !== "ROUTED") throw new Error("expected ROUTED");
    createdRequestIds.push(result.request.id);
    expect(result.request.summary).toMatch(/^Store handover: 2 resources/);

    // The custodian cannot accept before the head has approved.
    await expect(approvals.decideStep(labCustodianId, result.request.id, "APPROVE")).rejects.toMatchObject({ status: 403 });
    await approvals.decideStep(labHeadId, result.request.id, "APPROVE");

    let item = await prisma.item.findUniqueOrThrow({ where: { id: stockA } });
    expect([item.ownerOrgNodeId, item.custodianId, item.parentId]).toEqual([storeNodeId, keeperId, null]);

    const final = await approvals.decideStep(labCustodianId, result.request.id, "APPROVE", "arrived, 2 units");
    expect(final.status).toBe("APPLIED");

    for (const id of [stockA, stockB]) {
      item = await prisma.item.findUniqueOrThrow({ where: { id } });
      expect([item.parentId, item.ownerOrgNodeId, item.currentOrgNodeId, item.custodianId]).toEqual([labId, deptNodeId, deptNodeId, labCustodianId]);
    }

    const lines = await prisma.itemChange.findMany({ where: { itemId: stockA }, orderBy: { kind: "asc" } });
    expect(lines.map((l) => l.kind).sort()).toEqual(["setCustodian", "setOwnerOrg", "transferItem"]);
    expect(new Set(lines.map((l) => l.batchId)).size).toBe(1);
    expect(lines.every((l) => l.actorId === keeperId && l.ownerOrgNodeId === deptNodeId && l.custodianId === labCustodianId)).toBe(true);
  });

  it("refuses an ownership move requested by anyone but a store keeper or SYS_ADMIN", async () => {
    const custodianId = await makeUser("handover-not-keeper", ["CUSTODIAN"]);
    const ownerNodeId = await makeNode("handover-refuse-owner", null);
    const targetNodeId = await makeNode("handover-refuse-target", null);
    const destLabId = await makeItem(targetNodeId, custodianId, "Handover Refuse Dest");
    const sourceId = await makeItem(ownerNodeId, custodianId, "Handover Refuse Source");

    await expect(approvals.requestTransfer(custodianId, handoverInput([sourceId], destLabId, targetNodeId, custodianId))).rejects.toMatchObject({ status: 403 });
    await expect(approvals.previewTransfer(custodianId, handoverInput([sourceId], destLabId, targetNodeId, custodianId))).rejects.toMatchObject({ status: 403 });
  });

  it("F-024: refuses a handover naming a student as the receiving custodian", async () => {
    const keeperId = await makeUser("f024-handover-keeper", ["STORE_KEEPER"]);
    const labHeadId = await makeUser("f024-handover-head", ["MANAGER"]);
    const studentId = await makeUser("f024-handover-student", ["STUDENT"]);
    const storeNodeId = await makeNode("f024-handover-store", null);
    const deptNodeId = await makeNode("f024-handover-dept", labHeadId);
    const labId = await makeItem(deptNodeId, studentId, "F024 Handover Dest Lab");
    const stock = await makeItem(storeNodeId, keeperId, "F024 Handover Stock");

    await expect(approvals.requestTransfer(keeperId, handoverInput([stock], labId, deptNodeId, studentId))).rejects.toMatchObject({ status: 400 });
  });
});

describe("F-042 — a pull always asks both the owning and the receiving end, regardless of the requester's role", () => {
  beforeAll(async () => {
    // The exact chain pol-store-transfer uses for a genuine HANDOVER — seeded here
    // under a STORE_KEEPER role so resolvePolicy resolves a CHAIN outcome (not
    // AUTO/DENY) for the ordinary PULL test below too. Before F-042, this same
    // policy row's chain (TARGET_HEAD, TARGET_CUSTODIAN only) was what actually got
    // used for a store keeper's pull as well, since resolvePolicy matches by role
    // alone — never asking the owning head. The fix bypasses this chain for any
    // non-handover transfer, replacing it with the fixed pull shape.
    await makePolicy({ id: `${testKey}-f042-storekeeper`, actorRole: "STORE_KEEPER", outcome: "CHAIN", chain: [{ type: "TARGET_HEAD" }, { type: "TARGET_CUSTODIAN" }] });
  });

  it("a store keeper's pull (not a handover) asks the owning head, not just the receiving end", async () => {
    const keeperId = await makeUser("f042-keeper", ["STORE_KEEPER"]);
    const deptHeadId = await makeUser("f042-dept-head", ["MANAGER"]);
    const deptCustodianId = await makeUser("f042-dept-custodian", ["CUSTODIAN"]);
    const storeHeadId = await makeUser("f042-store-head", ["MANAGER"]);
    const deptNodeId = await makeNode("f042-dept", deptHeadId);
    const storeNodeId = await makeNode("f042-store-unit", storeHeadId);
    const sourceId = await makeItem(deptNodeId, deptCustodianId, "F042 Dept Item");
    // The Main Store item itself, custodied by the keeper — pulling into their own
    // shelf, so TARGET_CUSTODIAN is correctly omitted (self); OWNER_HEAD/TARGET_HEAD
    // are the actual point of this test.
    const storeLabId = await makeItem(storeNodeId, keeperId, "F042 Main Store");

    const preview = await approvals.previewTransfer(keeperId, transferInput([sourceId], storeLabId, storeNodeId));
    expect(preview.outcome).toBe("ROUTED");
    expect(preview.steps?.map((s) => s.selector)).toEqual(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "REQUESTER_RECEIPT"]);
    expect(preview.steps?.find((s) => s.selector === "OWNER_HEAD")?.approverId).toBe(deptHeadId);
    expect(preview.steps?.find((s) => s.selector === "TARGET_HEAD")?.approverId).toBe(storeHeadId);
  });

  it("a dean can no longer pull into a unit's store they don't custody — only custodians move resources (2026-09-22)", async () => {
    const deanId = await makeUser("f042-dean", ["MANAGER"]);
    const seHeadId = await makeUser("f042-se-head", ["MANAGER"]);
    const seCustodianId = await makeUser("f042-se-custodian", ["CUSTODIAN"]);
    const chemHeadId = await makeUser("f042-chem-head", ["MANAGER"]);
    const chemCustodianId = await makeUser("f042-chem-custodian", ["CUSTODIAN"]);
    const seNodeId = await makeNode("f042-se", seHeadId);
    const chemNodeId = await makeNode("f042-chem", chemHeadId);
    const whiteboardId = await makeItem(seNodeId, seCustodianId, "F042 Whiteboard");
    const chemStoreId = await makeItem(chemNodeId, chemCustodianId, "F042 ChemE Store");

    // The dean occupies a college one level above ChemE — MANAGER's write reach
    // covers their whole visible subtree (F-021 of the earlier fix round), not
    // just the exact node they occupy, so a real ancestor/descendant closure row is
    // what actually grants it (matching what org.recomputeClosure would produce).
    const collegeNodeId = await makeNode("f042-college", deanId);
    await prisma.orgClosure.createMany({
      data: [
        { ancestorId: collegeNodeId, descendantId: collegeNodeId, depth: 0 },
        { ancestorId: chemNodeId, descendantId: chemNodeId, depth: 0 },
        { ancestorId: collegeNodeId, descendantId: chemNodeId, depth: 1 },
      ],
    });

    await expect(approvals.previewTransfer(deanId, transferInput([whiteboardId], chemStoreId, chemNodeId))).rejects.toMatchObject({ status: 404 });

    // The store's own custodian pulling the same item still asks the owning side.
    const preview = await approvals.previewTransfer(chemCustodianId, transferInput([whiteboardId], chemStoreId, chemNodeId));
    expect(preview.outcome).toBe("ROUTED");
    expect(preview.steps?.find((s) => s.selector === "ITEM_CUSTODIAN")?.approverId).toBe(seCustodianId);
    expect(preview.steps?.find((s) => s.selector === "OWNER_HEAD")?.approverId).toBe(seHeadId);
    expect(preview.steps?.find((s) => s.selector === "TARGET_HEAD")?.approverId).toBe(chemHeadId);
  });
});

describe("F-040 — concurrent final approvals never leave an applied transfer marked STALE", () => {
  it("4 simultaneous final approvals yield exactly one APPLIED and no STALE overwrite", async () => {
    const requesterId = await makeUser("f040-requester", ["CUSTODIAN"]);
    const lenderId = await makeUser("f040-lender", ["CUSTODIAN"]);
    const ownerHeadId = await makeUser("f040-owner-head");
    const targetHeadId = await makeUser("f040-target-head");
    const ownerNodeId = await makeNode("f040-owner", ownerHeadId);
    const targetNodeId = await makeNode("f040-target", targetHeadId);
    const destLabId = await makeItem(targetNodeId, requesterId, "F040 Dest Lab");
    const sourceId = await makeItem(ownerNodeId, lenderId, "F040 Source Item");

    const result = await approvals.requestTransfer(requesterId, transferInput([sourceId], destLabId, targetNodeId));
    if (result.outcome !== "ROUTED") throw new Error("expected ROUTED");
    createdRequestIds.push(result.request.id);

    await approvals.decideStep(lenderId, result.request.id, "APPROVE");
    await approvals.decideStep(ownerHeadId, result.request.id, "APPROVE");
    await approvals.decideStep(targetHeadId, result.request.id, "APPROVE");

    // The double-click / two-tabs race: the item's own optimistic version check
    // already stopped a double move (unchanged by this fix); what F-042 of the
    // 2026-09-15 campaign found is that the LOSING call(s) then unconditionally
    // overwrote the request's own status to STALE, regardless of what actually
    // happened — so the stored status could end up STALE even though the register
    // shows the transfer went through.
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => approvals.decideStep(requesterId, result.request.id, "APPROVE")));
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : `rejected:${(r.reason as { status?: number })?.status}`));
    expect(statuses.filter((s) => s === "APPLIED")).toHaveLength(1);
    expect(statuses.filter((s) => s === "STALE")).toHaveLength(0);
    // The other 3 concurrent calls each land on either "already decided" (the
    // request itself is no longer PENDING by the time they get the lock) or
    // "nothing left for you to decide" (the step was already approved) — never a
    // STALE overwrite of the one call that actually succeeded.
    expect(statuses.filter((s) => s === "rejected:403" || s === "rejected:409")).toHaveLength(3);

    const final = await approvals.getRequest(requesterId, result.request.id);
    expect(final.status).toBe("APPLIED");
    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).toBe(targetNodeId);
  });
});

describe("a tree selection — a container ticked together with what is inside it", () => {
  it("transfer and move act on the top-most items only; nested parts travel inside them instead of being pulled out", async () => {
    const keeperId = await makeUser("nested-keeper", ["STORE_KEEPER", "STAFF"]);
    const headId = await makeUser("nested-head", ["MANAGER"]);
    const custodianId = await makeUser("nested-custodian", ["CUSTODIAN"]);
    const storeNodeId = await makeNode("nested-store", null);
    const deptNodeId = await makeNode("nested-dept", headId);
    const labId = await makeItem(deptNodeId, custodianId, "Nested Dest Lab");
    const computerId = await makeItem(storeNodeId, keeperId, "Nested Computer");
    const ram = await prisma.item.create({
      data: { parentId: computerId, categoryId, name: "Nested RAM", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: storeNodeId, currentOrgNodeId: storeNodeId, custodianId: keeperId },
    });
    createdItemIds.push(ram.id);

    // The register sends the child's id along with its container's.
    const selection = [computerId, ram.id];
    const preview = await approvals.previewTransfer(keeperId, { kind: "transferItem", itemIds: selection, transfer: { targetParentId: labId, targetOrgNodeId: deptNodeId, targetCustodianId: custodianId, transferOwnership: true } });
    expect(preview.outcome).toBe("ROUTED");

    const result = await approvals.requestTransfer(keeperId, { kind: "transferItem", itemIds: selection, transfer: { targetParentId: labId, targetOrgNodeId: deptNodeId, targetCustodianId: custodianId, transferOwnership: true } });
    if (result.outcome !== "ROUTED") throw new Error("expected ROUTED");
    createdRequestIds.push(result.request.id);
    const stored = await prisma.changeRequest.findUniqueOrThrow({ where: { id: result.request.id } });
    expect((stored.payload as { itemIds: string[] }).itemIds).toEqual([computerId]);

    await approvals.decideStep(headId, result.request.id, "APPROVE");
    await approvals.decideStep(custodianId, result.request.id, "APPROVE");

    const [computer, nestedRam] = await Promise.all([prisma.item.findUniqueOrThrow({ where: { id: computerId } }), prisma.item.findUniqueOrThrow({ where: { id: ram.id } })]);
    expect(computer.parentId).toBe(labId);
    expect([nestedRam.parentId, nestedRam.ownerOrgNodeId, nestedRam.custodianId]).toEqual([computerId, deptNodeId, custodianId]);

    // Same rule for a plain move within someone's own custody.
    const shelfId = await makeItem(deptNodeId, custodianId, "Nested Shelf");
    await mutate.applyChange(sysAdminId, { kind: "moveInTree", itemIds: [computerId, ram.id], value: shelfId });
    const [movedComputer, movedRam] = await Promise.all([prisma.item.findUniqueOrThrow({ where: { id: computerId } }), prisma.item.findUniqueOrThrow({ where: { id: ram.id } })]);
    expect(movedComputer.parentId).toBe(shelfId);
    expect(movedRam.parentId).toBe(computerId);
  });
});

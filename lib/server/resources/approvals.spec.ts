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

describe("requestTransfer — policy resolution", () => {
  it("AUTO applies immediately; no ChangeRequest row is created", async () => {
    const propAdminId = await makeUser("auto-propadmin", ["PROPERTY_ADMIN"]);
    const ownerNodeId = await makeNode("auto-owner", null);
    const targetNodeId = await makeNode("auto-target", null);
    const destLabId = await makeItem(targetNodeId, propAdminId, "Auto Dest Lab");
    const sourceId = await makeItem(ownerNodeId, propAdminId, "Auto Source Item");

    const before = await prisma.changeRequest.count();
    const result = await approvals.requestTransfer(propAdminId, transferInput([sourceId], destLabId, targetNodeId));
    expect(result.outcome).toBe("APPLIED");

    const after = await prisma.changeRequest.count();
    expect(after).toBe(before);

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).toBe(targetNodeId);
  });

  it("a custodian with no matching policy is DENIED (no matching rule means DENY)", async () => {
    const staffId = await makeUser("deny-staff", ["STAFF"]);
    const ownerNodeId = await makeNode("deny-owner", null);
    const targetNodeId = await makeNode("deny-target", null);
    const destLabId = await makeItem(targetNodeId, staffId, "Deny Dest Lab");
    const sourceId = await makeItem(ownerNodeId, staffId, "Deny Source Item");

    await expect(approvals.requestTransfer(staffId, transferInput([sourceId], destLabId, targetNodeId))).rejects.toMatchObject({ status: 403 });
  });

  it("CHAIN creates one ChangeRequest with the right steps in order; nothing on Item moves yet — and the requester's own custodian step is SKIPPED, not PENDING", async () => {
    const custodianId = await makeUser("chain-custodian", ["CUSTODIAN"]);
    const ownerHeadId = await makeUser("chain-owner-head");
    const targetHeadId = await makeUser("chain-target-head");
    const ownerNodeId = await makeNode("chain-owner", ownerHeadId);
    const targetNodeId = await makeNode("chain-target", targetHeadId);
    const destLabId = await makeItem(targetNodeId, targetHeadId, "Chain Dest Lab");
    const sourceId = await makeItem(ownerNodeId, custodianId, "Chain Source Item");

    const result = await approvals.requestTransfer(custodianId, transferInput([sourceId], destLabId, targetNodeId));
    expect(result.outcome).toBe("ROUTED");
    if (result.outcome !== "ROUTED") throw new Error("unreachable");
    createdRequestIds.push(result.request.id);

    const selectors = result.request.steps.map((s) => s.selector);
    expect(selectors).toEqual(["ITEM_CUSTODIAN", "OWNER_HEAD", "TARGET_HEAD", "REQUESTER_RECEIPT"]);

    const custodianStep = result.request.steps[0];
    expect(custodianStep.status).toBe("SKIPPED"); // requester holds this post
    expect(result.request.steps[1].status).toBe("PENDING"); // OWNER_HEAD is next armed step
    expect(result.request.steps[1].approverId).toBe(ownerHeadId);
    expect(result.request.steps[2].status).toBe("WAITING");
    expect(result.request.steps[2].approverId).toBe(targetHeadId);

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).toBe(ownerNodeId); // unchanged
  });
});

describe("decideStep — vacancy, handoff, receipt-gated apply", () => {
  async function setUpChain() {
    const custodianId = await makeUser("flow-custodian", ["CUSTODIAN"]);
    const ownerHeadId = await makeUser("flow-owner-head");
    const targetHeadId = await makeUser("flow-target-head");
    const ownerNodeId = await makeNode("flow-owner", ownerHeadId);
    const targetNodeId = await makeNode("flow-target", targetHeadId);
    const destLabId = await makeItem(targetNodeId, targetHeadId, "Flow Dest Lab");
    const sourceId = await makeItem(ownerNodeId, custodianId, "Flow Source Item");

    const result = await approvals.requestTransfer(custodianId, transferInput([sourceId], destLabId, targetNodeId));
    if (result.outcome !== "ROUTED") throw new Error("expected ROUTED");
    createdRequestIds.push(result.request.id);
    return { requestId: result.request.id, custodianId, ownerHeadId, targetHeadId, ownerNodeId, targetNodeId, sourceId, destLabId };
  }

  it("a vacant OWNER_HEAD blocks — undecidable by anyone — and appointing someone unblocks it immediately", async () => {
    const { requestId, ownerNodeId, custodianId } = await setUpChain();
    await setHead(ownerNodeId, null);

    await expect(approvals.decideStep(custodianId, requestId, "APPROVE")).rejects.toMatchObject({ status: 403 });

    const req = await approvals.getRequest(custodianId, requestId);
    expect(req.steps.find((s) => s.selector === "OWNER_HEAD")?.approverId).toBeNull();

    const newHeadId = await makeUser("flow-new-owner-head");
    await setHead(ownerNodeId, newHeadId);
    const decided = await approvals.decideStep(newHeadId, requestId, "APPROVE");
    expect(decided.steps.find((s) => s.selector === "OWNER_HEAD")?.status).toBe("APPROVED");
  });

  it("a headship change mid-flight redirects the decision to the NEW head", async () => {
    const { requestId, ownerHeadId, targetNodeId, targetHeadId } = await setUpChain();
    await approvals.decideStep(ownerHeadId, requestId, "APPROVE");

    const newTargetHeadId = await makeUser("flow-new-target-head");
    await setHead(targetNodeId, newTargetHeadId);

    await expect(approvals.decideStep(targetHeadId, requestId, "APPROVE")).rejects.toMatchObject({ status: 403 });
    const decided = await approvals.decideStep(newTargetHeadId, requestId, "APPROVE");
    expect(decided.steps.find((s) => s.selector === "TARGET_HEAD")?.decidedById).toBe(newTargetHeadId);
  });

  it("full happy path: the Item is untouched until REQUESTER_RECEIPT is confirmed, then updates atomically, attributed to the requester", async () => {
    const { requestId, custodianId, ownerHeadId, targetHeadId, sourceId, targetNodeId } = await setUpChain();

    await approvals.decideStep(ownerHeadId, requestId, "APPROVE");
    let item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).not.toBe(targetNodeId);

    await approvals.decideStep(targetHeadId, requestId, "APPROVE");
    item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).not.toBe(targetNodeId); // still not applied — receipt is the last step

    const final = await approvals.decideStep(custodianId, requestId, "APPROVE"); // confirm receipt
    expect(final.status).toBe("APPLIED");

    item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).toBe(targetNodeId);

    const change = await prisma.itemChange.findFirstOrThrow({ where: { itemId: sourceId, kind: "transferItem" } });
    expect(change.actorId).toBe(custodianId); // attributed to the requester, not the last approver
  });

  it("REJECT ends the whole request outright; the Item is never touched", async () => {
    const { requestId, ownerHeadId, sourceId, ownerNodeId } = await setUpChain();
    const decided = await approvals.decideStep(ownerHeadId, requestId, "REJECT", "not right now");
    expect(decided.status).toBe("REJECTED");
    expect(decided.resolution).toBe("not right now");

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).toBe(ownerNodeId);

    await expect(approvals.decideStep(ownerHeadId, requestId, "APPROVE")).rejects.toMatchObject({ status: 409 });
  });

  it("a version conflict at final settle time marks the request STALE and applies nothing", async () => {
    const { requestId, custodianId, ownerHeadId, targetHeadId, sourceId, targetNodeId } = await setUpChain();
    await approvals.decideStep(ownerHeadId, requestId, "APPROVE");
    await approvals.decideStep(targetHeadId, requestId, "APPROVE");

    // Something else touches the item while the request waits on receipt.
    await mutate.applyChange(sysAdminId, { kind: "setName", itemIds: [sourceId], value: "Changed underneath" });

    const final = await approvals.decideStep(custodianId, requestId, "APPROVE");
    expect(final.status).toBe("STALE");

    const item = await prisma.item.findUniqueOrThrow({ where: { id: sourceId } });
    expect(item.currentOrgNodeId).not.toBe(targetNodeId);
  });
});

describe("cancelRequest", () => {
  it("the requester may cancel their own PENDING request; a non-requester may not", async () => {
    const custodianId = await makeUser("cancel-custodian", ["CUSTODIAN"]);
    const ownerHeadId = await makeUser("cancel-owner-head");
    const targetHeadId = await makeUser("cancel-target-head");
    const ownerNodeId = await makeNode("cancel-owner", ownerHeadId);
    const targetNodeId = await makeNode("cancel-target", targetHeadId);
    const destLabId = await makeItem(targetNodeId, targetHeadId, "Cancel Dest Lab");
    const sourceId = await makeItem(ownerNodeId, custodianId, "Cancel Source Item");

    const result = await approvals.requestTransfer(custodianId, transferInput([sourceId], destLabId, targetNodeId));
    if (result.outcome !== "ROUTED") throw new Error("expected ROUTED");
    createdRequestIds.push(result.request.id);

    await expect(approvals.cancelRequest(ownerHeadId, result.request.id)).rejects.toMatchObject({ status: 403 });
    await approvals.cancelRequest(custodianId, result.request.id);
    const req = await approvals.getRequest(custodianId, result.request.id);
    expect(req.status).toBe("CANCELLED");
  });
});

describe("custody floor — requesting a transfer of something you don't custody", () => {
  it("is refused (404), the existing assertCanMutate floor, unchanged", async () => {
    const outsiderId = await makeUser("outsider", ["CUSTODIAN"]);
    const ownerId = await makeUser("floor-owner", ["CUSTODIAN"]);
    const ownerNodeId = await makeNode("floor-owner-node", null);
    const targetNodeId = await makeNode("floor-target-node", null);
    const destLabId = await makeItem(targetNodeId, ownerId, "Floor Dest Lab");
    const sourceId = await makeItem(ownerNodeId, ownerId, "Floor Source Item");

    await expect(approvals.requestTransfer(outsiderId, transferInput([sourceId], destLabId, targetNodeId))).rejects.toMatchObject({ status: 404 });
  });
});

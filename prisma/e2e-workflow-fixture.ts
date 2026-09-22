/**
 * Dev-only, reversible fixture for the end-to-end lab lifecycle walkthrough
 * (~/.claude/plans/i-have-added-multiple-federated-reddy.md, Part B): lab set-up →
 * head approval → cross-department transfer → department purchasables → multi-office
 * review with send-backs → procurement pipeline → store intake → store handover.
 *
 * It runs against the REAL local SE/ChemE data, so it only adds the posts that data is
 * missing, records every prior value it changes, and puts them back afterwards:
 *   --setup     reactivate the CoEEC dean (known password, occupies CoEEC), create a
 *               store keeper (STORE_KEEPER + STAFF, home = the university root), set the
 *               procurement officer's password — invites are bypassed on purpose: their
 *               mail goes to real Gmail SMTP.
 *   --teardown  delete every workflow row the run created (purchase requests, needs,
 *               transfer requests, lab commits, drafts, ideal targets), soft-delete every
 *               item the cast created, and restore every recorded prior value.
 *   (default)   read-only report: accounts, posts, and every workflow row since setup.
 *
 * Only items CREATED during the run are ever moved or deleted — the one real item it
 * changes is ASTU Main Store's custodian (set through the UI in scene S0), restored on
 * teardown. `ItemChange` audit rows are append-only and stay.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";

if (process.env.NODE_ENV === "production") {
  console.error("e2e-workflow-fixture.ts refuses to run with NODE_ENV=production.");
  process.exit(1);
}

const prisma = new PrismaClient();
const STATE_FILE = path.resolve(process.cwd(), "prisma/.e2e-fixture-state.json");
const PASSWORD = "astu1234";

const EMAIL = {
  admin: "admin@astu.edu.et",
  seHead: "head.se@astu.edu.et",
  chemHead: "head.chem@astu.edu.et",
  seCustodian: "custodian.se@astu.edu.et",
  chemCustodian: "custodian.chem@astu.edu.et",
  dean: "dean.coeec@astu.edu.et",
  procurement: "procurement@astu.edu.et",
  storeKeeper: "storekeeper@astu.edu.et",
};
const NODE = { university: "Adama Science and Technology University", coeec: "College of Electrical Engineering and Computing", se: "Software Engineering" };
const MAIN_STORE = "ASTU Main Store";

interface FixtureState {
  startedAt: string;
  dean: { id: string; status: string; passwordHash: string | null; addedRoles: string[]; assignmentId: string };
  coeecPriorOccupantId: string | null;
  procurement: { id: string; passwordHash: string | null };
  storeKeeper: { id: string; created: boolean; priorStatus: string | null; priorPasswordHash: string | null };
  sePriorDraftWorkflowEnabled: boolean;
  mainStore: { id: string; priorCustodianId: string };
  priorVersionIds: string[];
}

async function nodeByName(name: string) {
  return prisma.orgNode.findFirstOrThrow({ where: { name } });
}

async function userByEmail(email: string) {
  return prisma.user.findUniqueOrThrow({ where: { emailLower: email.toLowerCase() }, include: { roles: true } });
}

function readState(): FixtureState | null {
  return fs.existsSync(STATE_FILE) ? (JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as FixtureState) : null;
}

// ── setup ────────────────────────────────────────────────────────────────────

async function setup() {
  if (readState()) throw new Error(`Already set up (${STATE_FILE} exists) — run --teardown first.`);

  const [university, coeec, se, admin, dean, procurement] = await Promise.all([
    nodeByName(NODE.university),
    nodeByName(NODE.coeec),
    nodeByName(NODE.se),
    userByEmail(EMAIL.admin),
    userByEmail(EMAIL.dean),
    userByEmail(EMAIL.procurement),
  ]);
  const mainStore = await prisma.item.findFirstOrThrow({ where: { name: MAIN_STORE, parentId: null, deletedAt: null } });
  const existingKeeper = await prisma.user.findUnique({ where: { emailLower: EMAIL.storeKeeper } });
  const priorVersions = await prisma.labVersion.findMany({ select: { id: true } });
  const passwordHash = await argon2.hash(PASSWORD);
  const startedAt = new Date();

  // The dean: reactivate, give a head's roles (Purchasing is role-gated in the nav), and
  // occupy CoEEC — with a ledger row, the same as an Org Studio assignment would write.
  const deanRoles = ["MANAGER", "STAFF"].filter((r) => !dean.roles.some((x) => x.kind === r));
  await prisma.user.update({ where: { id: dean.id }, data: { status: "ACTIVE", passwordHash, homeNodeId: coeec.id } });
  for (const kind of deanRoles) await prisma.userRole.create({ data: { userId: dean.id, kind: kind as never } });
  await prisma.orgNode.update({ where: { id: coeec.id }, data: { userId: dean.id } });
  const assignment = await prisma.orgNodeAssignment.create({ data: { nodeId: coeec.id, userId: dean.id, assignedById: admin.id, reason: "E2E lifecycle walkthrough" } });

  // The store keeper.
  let keeperId: string;
  if (existingKeeper) {
    keeperId = existingKeeper.id;
    await prisma.user.update({ where: { id: keeperId }, data: { status: "ACTIVE", passwordHash, homeNodeId: university.id } });
    for (const kind of ["STORE_KEEPER", "STAFF"]) {
      await prisma.userRole.upsert({ where: { userId_kind: { userId: keeperId, kind: kind as never } }, update: {}, create: { userId: keeperId, kind: kind as never } });
    }
  } else {
    const keeper = await prisma.user.create({
      data: {
        email: EMAIL.storeKeeper,
        emailLower: EMAIL.storeKeeper,
        name: "Main Store Keeper",
        passwordHash,
        status: "ACTIVE",
        homeNodeId: university.id,
        roles: { create: [{ kind: "STORE_KEEPER" }, { kind: "STAFF" }] },
      },
    });
    keeperId = keeper.id;
  }

  await prisma.user.update({ where: { id: procurement.id }, data: { passwordHash } });

  const state: FixtureState = {
    startedAt: startedAt.toISOString(),
    dean: { id: dean.id, status: dean.status, passwordHash: dean.passwordHash, addedRoles: deanRoles, assignmentId: assignment.id },
    coeecPriorOccupantId: coeec.userId,
    procurement: { id: procurement.id, passwordHash: procurement.passwordHash },
    storeKeeper: { id: keeperId, created: !existingKeeper, priorStatus: existingKeeper?.status ?? null, priorPasswordHash: existingKeeper?.passwordHash ?? null },
    sePriorDraftWorkflowEnabled: se.draftWorkflowEnabled,
    mainStore: { id: mainStore.id, priorCustodianId: mainStore.custodianId },
    priorVersionIds: priorVersions.map((v) => v.id),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`Set up at ${state.startedAt}. State recorded to ${STATE_FILE}.`);
  await report();
}

// ── teardown ─────────────────────────────────────────────────────────────────

async function teardown() {
  const state = readState();
  if (!state) throw new Error("Nothing to tear down — no state file.");
  const since = new Date(state.startedAt);
  // The admin account is deliberately NOT treated as cast for deletion: no scene creates
  // an item as admin, and it is the account a real person is most likely to be using
  // at the same time.
  const cast = await prisma.user.findMany({ where: { emailLower: { in: Object.values(EMAIL).filter((e) => e !== EMAIL.admin) } }, select: { id: true } });
  const castIds = cast.map((u) => u.id);

  const before = await counts();

  // Items the cast created during the run, plus everything nested inside them.
  const createdLog = await prisma.itemChange.findMany({ where: { kind: "createItem", at: { gte: since }, actorId: { in: castIds }, itemId: { not: null } }, select: { itemId: true } });
  const roots = [...new Set(createdLog.map((c) => c.itemId!))];
  const doomed = roots.length
    ? await prisma.$queryRaw<{ id: string }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id FROM "Item" WHERE id = ANY(${roots}) AND "deletedAt" IS NULL
          UNION
          SELECT i.id FROM "Item" i INNER JOIN subtree s ON i."parentId" = s.id WHERE i."deletedAt" IS NULL
        )
        SELECT id FROM subtree`
    : [];
  const doomedIds = doomed.map((d) => d.id);

  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequest.deleteMany({ where: { createdAt: { gte: since } } }); // cascades lines/steps/events
    await tx.needLine.deleteMany({ where: { createdAt: { gte: since } } });
    await tx.changeRequest.deleteMany({ where: { createdAt: { gte: since } } }); // cascades chain steps
    await tx.labCommitRequest.deleteMany({ where: { createdAt: { gte: since } } });
    await tx.labVersion.deleteMany({ where: { id: { notIn: state.priorVersionIds ?? [] } } });
    if (doomedIds.length) await tx.item.updateMany({ where: { id: { in: doomedIds } }, data: { deletedAt: new Date() } });

    await tx.item.update({ where: { id: state.mainStore.id }, data: { custodianId: state.mainStore.priorCustodianId, version: { increment: 1 } } });
    await tx.orgNode.updateMany({ where: { name: NODE.se }, data: { draftWorkflowEnabled: state.sePriorDraftWorkflowEnabled } });

    const coeec = await tx.orgNode.findFirstOrThrow({ where: { name: NODE.coeec } });
    await tx.orgNode.update({ where: { id: coeec.id }, data: { userId: state.coeecPriorOccupantId } });
    await tx.orgNodeAssignment.update({ where: { id: state.dean.assignmentId }, data: { endedAt: new Date() } });
    await tx.userRole.deleteMany({ where: { userId: state.dean.id, kind: { in: state.dean.addedRoles as never[] } } });
    await tx.user.update({ where: { id: state.dean.id }, data: { status: state.dean.status as never, passwordHash: state.dean.passwordHash } });

    // Disabled, never deleted — the account may sit on audit rows (ItemChange actor).
    await tx.user.update({
      where: { id: state.storeKeeper.id },
      data: state.storeKeeper.created ? { status: "DISABLED" } : { status: (state.storeKeeper.priorStatus ?? "DISABLED") as never, passwordHash: state.storeKeeper.priorPasswordHash },
    });
    await tx.user.update({ where: { id: state.procurement.id }, data: { passwordHash: state.procurement.passwordHash } });
    await tx.session.deleteMany({ where: { userId: { in: [state.dean.id, state.storeKeeper.id] } } });
  });

  fs.unlinkSync(STATE_FILE);
  const after = await counts();
  console.log("Torn down. Soft-deleted", doomedIds.length, "run-created items.");
  console.log("before:", before);
  console.log("after: ", after);
}

// ── report ───────────────────────────────────────────────────────────────────

async function counts() {
  const [items, purchaseRequests, needs, changeRequests, labCommits, drafts, ideals] = await Promise.all([
    prisma.item.count({ where: { deletedAt: null } }),
    prisma.purchaseRequest.count(),
    prisma.needLine.count(),
    prisma.changeRequest.count(),
    prisma.labCommitRequest.count(),
    prisma.labVersion.count({ where: { kind: { not: "IDEAL" } } }),
    prisma.labVersion.count({ where: { kind: "IDEAL" } }),
  ]);
  const se = await prisma.orgNode.findFirst({ where: { name: NODE.se }, select: { draftWorkflowEnabled: true } });
  return { items, purchaseRequests, needs, changeRequests, labCommits, drafts, ideals, seDraftWorkflow: se?.draftWorkflowEnabled };
}

async function report() {
  const state = readState();
  console.log("\nState:", state ? `set up since ${state.startedAt}` : "not set up");
  console.log("Counts:", await counts());

  const posts = await prisma.orgNode.findMany({ where: { name: { in: [...Object.values(NODE), "Chemical Engineering", "Procurement Office"] } }, select: { name: true, user: { select: { email: true } } } });
  for (const p of posts) console.log(`  post  ${p.name.padEnd(48)} ${p.user?.email ?? "(vacant)"}`);
  for (const email of Object.values(EMAIL)) {
    const u = await prisma.user.findUnique({ where: { emailLower: email }, include: { roles: true } });
    if (!u) {
      console.log(`  user  ${email.padEnd(30)} (missing)`);
      continue;
    }
    const ok = u.passwordHash ? await argon2.verify(u.passwordHash, PASSWORD).catch(() => false) : false;
    console.log(`  user  ${email.padEnd(30)} ${u.status.padEnd(8)} ${u.roles.map((r) => r.kind).join("+").padEnd(22)} password ${ok ? "astu1234" : "unknown"}`);
  }
  const store = await prisma.item.findFirst({ where: { name: MAIN_STORE, parentId: null, deletedAt: null }, select: { custodian: { select: { email: true } } } });
  console.log(`  item  ${MAIN_STORE} custodian: ${store?.custodian.email}`);

  if (!state) return;
  const since = new Date(state.startedAt);
  const labCommits = await prisma.labCommitRequest.findMany({ where: { createdAt: { gte: since } }, include: { lab: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  for (const c of labCommits) console.log(`  lab-commit  ${c.lab.name} ${c.targetKind} ${c.status}${c.resolution ? ` "${c.resolution}"` : ""}`);
  const ideals = await prisma.labVersion.findMany({ where: { kind: "IDEAL" }, include: { lab: { select: { name: true } }, _count: { select: { items: true } } } });
  for (const v of ideals) console.log(`  ideal  ${v.lab.name}: ${v._count.items - 1} items`);
  const transfers = await prisma.changeRequest.findMany({ where: { createdAt: { gte: since } }, include: { steps: { orderBy: { order: "asc" } } }, orderBy: { createdAt: "asc" } });
  for (const t of transfers) console.log(`  transfer  ${t.status.padEnd(9)} ${t.summary} [${t.steps.map((s) => `${s.label}:${s.status}`).join(" → ")}]${t.resolution ? ` "${t.resolution}"` : ""}`);
  const prs = await prisma.purchaseRequest.findMany({ where: { createdAt: { gte: since } }, include: { lines: true, events: { orderBy: { at: "asc" } } }, orderBy: { createdAt: "asc" } });
  for (const r of prs) {
    console.log(`  purchase  ${r.reference} ${r.stage} "${r.title}" lines: ${r.lines.map((l) => `${l.name}×${l.qty}${l.receivedQty !== null ? ` (recv ${l.receivedQty})` : ""}`).join(", ")}`);
    for (const e of r.events) console.log(`      ${e.at.toISOString()} ${e.stage} ${e.note ?? ""}`);
  }
}

const mode = process.argv.includes("--setup") ? setup : process.argv.includes("--teardown") ? teardown : report;
mode()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

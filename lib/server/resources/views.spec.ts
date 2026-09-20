import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** DB-backed — audience resolution against real accounts, cross-department raw-body
 *  assertions, and write-gate authorization are not provable as pure logic (the pure
 *  half already lives in lib/domain/views.spec.ts). See university-scope.spec.ts's
 *  header for the `.env`-loading detail; identical here. */
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

type ItemsModule = typeof import("./items");
type ViewsModule = typeof import("./views");
type CategoriesModule = typeof import("./categories");
type MutateModule = typeof import("./mutate");
type PrismaModule = typeof import("../prisma");

let items: ItemsModule;
let views: ViewsModule;
let categories: CategoriesModule;
let mutate: MutateModule;
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let seNodeId: string;
let chemNodeId: string;
let groupId: string;
let categoryId: string;
const testKey = `__test-views-${Date.now()}`;

const createdViewIds: string[] = [];
const createdUserIds: string[] = [];
const createdItemIds: string[] = [];

async function makeUser(suffix: string, data: { homeNodeId?: string; roles: string[] }) {
  const email = `${testKey}-${suffix}@astu.edu.et`;
  const user = await prisma.user.create({
    data: {
      email,
      emailLower: email,
      name: `Test ${suffix}`,
      status: "ACTIVE",
      homeNodeId: data.homeNodeId,
      roles: { create: data.roles.map((kind) => ({ kind: kind as never })) },
    },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function makeItem(ownerOrgNodeId: string, custodianId: string, name: string) {
  const item = await prisma.item.create({
    data: { categoryId, name, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId, currentOrgNodeId: ownerOrgNodeId, custodianId },
  });
  createdItemIds.push(item.id);
  return item.id;
}

async function makeView(input: Parameters<ViewsModule["upsert"]>[0]) {
  const view = await views.upsert(input);
  createdViewIds.push(view.id);
  return view.id;
}

beforeAll(async () => {
  items = await import("./items");
  views = await import("./views");
  categories = await import("./categories");
  mutate = await import("./mutate");
  ({ prisma } = await import("../prisma"));

  const [sysAdmin, seNode, chemNode] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Software Engineering" } } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Chemical" } } }),
  ]);
  sysAdminId = sysAdmin.id;
  seNodeId = seNode.id;
  chemNodeId = chemNode.id;

  const group = await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } });
  groupId = group.id;
  const category = await categories.create(sysAdminId, {
    key: testKey,
    name: "Views Test Category",
    iconKey: "Package",
    groupId,
    countingMode: "SERIALIZED",
    impairRule: "ANY_CRITICAL",
    canBeRoot: false,
    placement: "ANYWHERE",
    allowedParentCategoryIds: [],
    fields: [],
    templateChildren: [],
  });
  categoryId = category.id;
});

afterAll(async () => {
  await prisma.itemChange.deleteMany({ where: { OR: [{ itemId: { in: createdItemIds } }, { categoryId }] } });
  await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
  await prisma.accessViewAudience.deleteMany({ where: { viewId: { in: createdViewIds } } });
  await prisma.accessView.deleteMany({ where: { id: { in: createdViewIds } } });
  await prisma.resourceCategory.delete({ where: { id: categoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("resolveEffectiveView — zero views (today's production state)", () => {
  it("a person resolves to null when no AccessView row matches them at all — the safe-rollout regression guard", async () => {
    const nobody = await makeUser("no-views", { homeNodeId: seNodeId, roles: ["STAFF"] });
    await expect(views.resolveEffectiveView(nobody, null)).resolves.toBeNull();
    await expect(views.listSummariesForPerson(nobody)).resolves.toEqual([]);
  });
});

describe("resolveEffectiveView — resolution order and fallback", () => {
  let personId: string;
  let roleViewId: string;
  let personViewId: string;
  let everyoneViewId: string;

  beforeAll(async () => {
    personId = await makeUser("resolve-order", { homeNodeId: seNodeId, roles: ["CUSTODIAN"] });
    roleViewId = await makeView({ name: `${testKey}-role`, scope: "ORG_SUBTREE", explicitNodeIds: [], audiences: [{ type: "ROLE", role: "CUSTODIAN" }], canEdit: true, active: true });
    personViewId = await makeView({ name: `${testKey}-person`, scope: "UNIVERSITY", explicitNodeIds: [], audiences: [{ type: "PERSON", personId }], canEdit: true, active: true });
    // canEdit: true, deliberately — an EVERYONE audience matches every signed-in
    // account, including the shared seeded SYS_ADMIN other spec files' own fixtures
    // resolve by role and write through concurrently. A canEdit:false EVERYONE view
    // would (correctly, per mutate.ts's own invariant) refuse those writes for the
    // whole window this fixture exists — a real cross-test-file collision, not a
    // production bug. This block only asserts EVERYONE's SPECIFICITY ranking, which
    // canEdit plays no part in — see the dedicated, PERSON-scoped (hence isolated)
    // canEdit:false coverage below instead.
    everyoneViewId = await makeView({ name: `${testKey}-everyone`, scope: "MY_CUSTODY", explicitNodeIds: [], audiences: [{ type: "EVERYONE" }], canEdit: true, active: true });
  });

  it("a PERSON audience outranks a ROLE audience which outranks EVERYONE, with no explicit choice", async () => {
    const effective = await views.resolveEffectiveView(personId, null);
    expect(effective?.id).toBe(personViewId);
  });

  it("an explicit valid choice among the person's own views is honoured", async () => {
    const effective = await views.resolveEffectiveView(personId, roleViewId);
    expect(effective?.id).toBe(roleViewId);
  });

  it("an invalid or foreign view id silently falls back to the person's default — never honoured blindly", async () => {
    const effective = await views.resolveEffectiveView(personId, "not-a-real-view-id");
    expect(effective?.id).toBe(personViewId);
  });

  it("listSummariesForPerson returns every matching view, most specific first", async () => {
    const summaries = await views.listSummariesForPerson(personId);
    expect(summaries.map((v) => v.id)).toEqual([personViewId, roleViewId, everyoneViewId]);
  });
});

describe("EXPLICIT_NODES view + extraFilters — read scope, raw response body", () => {
  let personId: string;
  let seItemId: string;
  let chemItemId: string;

  beforeAll(async () => {
    personId = await makeUser("explicit-nodes", { homeNodeId: seNodeId, roles: ["CUSTODIAN"] });
    seItemId = await makeItem(seNodeId, personId, "SE Explicit-Nodes Item");
    chemItemId = await makeItem(chemNodeId, personId, "ChemE Explicit-Nodes Item");
  });

  it("scopes to exactly the hand-picked units, widening past the person's own MY_CUSTODY default", async () => {
    const viewId = await makeView({
      name: `${testKey}-explicit`,
      scope: "EXPLICIT_NODES",
      explicitNodeIds: [chemNodeId],
      audiences: [{ type: "PERSON", personId }],
      canEdit: true,
      active: true,
    });

    const result = await items.search(personId, {}, 1, 50, undefined, undefined);
    // Sanity: with the view not yet the ONLY one, MY_CUSTODY default still sees both
    // (custody spans both items) — the real assertion is the EXPLICIT_NODES override.
    const names = result.items.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(["SE Explicit-Nodes Item", "ChemE Explicit-Nodes Item"]));

    const view = await views.resolveEffectiveView(personId, viewId);
    expect(view?.mode).toBe("EXPLICIT_NODES");
    expect(view?.explicitNodeIds).toEqual([chemNodeId]);

    const scoped = await items.search(personId, {}, 1, 50, { mode: view!.mode, explicitNodeIds: view!.explicitNodeIds });
    const scopedNames = scoped.items.map((i) => i.name);
    expect(scopedNames).toContain("ChemE Explicit-Nodes Item");
    expect(scopedNames).not.toContain("SE Explicit-Nodes Item");
  });

  it("a saved extraFilters query narrows search AND summary identically", async () => {
    const extraFilters = { search: "ChemE Explicit-Nodes", join: "and" as const, rules: [] };
    const viewId = await makeView({
      name: `${testKey}-filtered`,
      scope: "UNIVERSITY",
      explicitNodeIds: [],
      extraFilters,
      audiences: [{ type: "PERSON", personId }],
      canEdit: true,
      active: true,
    });
    const view = await views.resolveEffectiveView(personId, viewId);
    expect(view?.extraFilters).toBeTruthy();

    const scopeOverride = { mode: view!.mode, explicitNodeIds: view!.explicitNodeIds };
    const search = await items.search(personId, {}, 1, 50, scopeOverride, view!.extraFilters);
    const summary = await items.summary(personId, scopeOverride, {}, view!.extraFilters);

    const names = search.items.map((i) => i.name);
    expect(names).toContain("ChemE Explicit-Nodes Item");
    expect(names).not.toContain("SE Explicit-Nodes Item");
    expect(summary.total).toBe(search.total);
  });
});

describe("assertViewAllowsEdit — the write door's half of the invariant", () => {
  let personId: string;
  let itemId: string;
  let readOnlyViewId: string;

  beforeAll(async () => {
    personId = await makeUser("write-gate", { homeNodeId: seNodeId, roles: ["CUSTODIAN"] });
    itemId = await makeItem(seNodeId, personId, "Write-Gate Item");
  });

  it("with no view assigned, an ordinary custodian write applies exactly as it does today", async () => {
    const result = await mutate.applyChange(personId, { kind: "setName", itemIds: [itemId], value: "Write-Gate Item (renamed 1)" });
    expect(result.applied).toBe(1);
    expect(result.itemIds).toEqual([itemId]);
  });

  it("F-032: a canEdit:false view nobody CHOSE narrows reads only — it does not block a write", async () => {
    readOnlyViewId = await makeView({
      name: `${testKey}-readonly`,
      scope: "MY_CUSTODY",
      explicitNodeIds: [],
      audiences: [{ type: "PERSON", personId }],
      canEdit: false,
      active: true,
    });
    // No explicit viewId passed — this is the person's ONLY (hence default) view.
    // Before F-032, a canEdit:false view resolved as anyone's IMPLICIT default
    // blocked every write of theirs, for every role including SYS_ADMIN — with no
    // views seeded in production, one such EVERYONE-scoped view would have made
    // every custodian in the university read-only, and the outage would have
    // looked random (only accounts with a more specific view of their own kept
    // editing). An implicit default now narrows reads only.
    const result = await mutate.applyChange(personId, { kind: "setName", itemIds: [itemId], value: "Write-Gate Item (renamed 1b)" });
    expect(result.applied).toBe(1);
  });

  it("the SAME canEdit:false view, chosen EXPLICITLY, still refuses the write with 403", async () => {
    await expect(
      mutate.applyChange(personId, { kind: "setName", itemIds: [itemId], value: "Should not apply" }, { viewId: readOnlyViewId }),
    ).rejects.toMatchObject({ status: 403 });
    // Confirmed structurally, not just by the write's own failure: the item's name
    // is unchanged.
    const row = await prisma.item.findUniqueOrThrow({ where: { id: itemId }, select: { name: true } });
    expect(row.name).toBe("Write-Gate Item (renamed 1b)");
  });

  it("switching back to an editable view (an explicit viewId) unblocks the identical write", async () => {
    const editableViewId = await makeView({
      name: `${testKey}-editable-again`,
      scope: "MY_CUSTODY",
      explicitNodeIds: [],
      audiences: [{ type: "PERSON", personId }],
      canEdit: true,
      active: true,
    });
    await expect(
      mutate.applyChange(personId, { kind: "setName", itemIds: [itemId], value: "Write-Gate Item (renamed 2)" }, { viewId: editableViewId }),
    ).resolves.toBeTruthy();
  });

  it("a view can never widen a write: a UNIVERSITY, canEdit:true view assigned to a non-custodian does not grant them write on someone else's item", async () => {
    const outsiderId = await makeUser("write-gate-outsider", { homeNodeId: chemNodeId, roles: ["STAFF"] });
    const wideViewId = await makeView({
      name: `${testKey}-wide-but-no-custody`,
      scope: "UNIVERSITY",
      explicitNodeIds: [],
      audiences: [{ type: "PERSON", personId: outsiderId }],
      canEdit: true,
      active: true,
    });
    const canSee = await views.resolveEffectiveView(outsiderId, wideViewId);
    expect(canSee?.mode).toBe("UNIVERSITY"); // sees everything...
    await expect(
      mutate.applyChange(outsiderId, { kind: "setName", itemIds: [itemId], value: "Hijacked" }, { viewId: wideViewId }),
    ).rejects.toMatchObject({ status: 404 }); // ...but still cannot write it — assertCanMutate is unaffected.
  });
});

describe("F-033 — a view's references must resolve before it is saved", () => {
  const base = { scope: "EXPLICIT_NODES" as const, canEdit: true, active: true, audiences: [{ type: "EVERYONE" as const }] };

  it("refuses EXPLICIT_NODES with no units, and with an unknown unit id", async () => {
    await expect(views.upsert({ ...base, name: `${testKey}-f33-empty`, explicitNodeIds: [] })).rejects.toMatchObject({ status: 400 });
    await expect(views.upsert({ ...base, name: `${testKey}-f33-ghost`, explicitNodeIds: [seNodeId, "no-such-node"] })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an unknown or disabled PERSON audience with a 400, never a raw FK 500", async () => {
    const disabledEmail = `${testKey}-f33-off@astu.edu.et`;
    const disabled = await prisma.user.create({ data: { email: disabledEmail, emailLower: disabledEmail, name: "F33 Off", status: "DISABLED" } });
    createdUserIds.push(disabled.id);
    const v = { ...base, name: `${testKey}-f33-person`, explicitNodeIds: [seNodeId] };
    await expect(views.upsert({ ...v, audiences: [{ type: "PERSON", personId: "no-such-person" }] })).rejects.toMatchObject({ status: 400 });
    await expect(views.upsert({ ...v, audiences: [{ type: "PERSON", personId: disabled.id }] })).rejects.toMatchObject({ status: 400 });
  });

  it("an update of a view id that does not exist is a 404", async () => {
    await expect(views.upsert({ ...base, id: "no-such-view", name: `${testKey}-f33-404`, explicitNodeIds: [seNodeId] })).rejects.toMatchObject({ status: 404 });
  });

  it("still saves a valid view", async () => {
    const id = await makeView({ ...base, name: `${testKey}-f33-ok`, explicitNodeIds: [seNodeId, chemNodeId] });
    expect(id).toBeTruthy();
  });
});

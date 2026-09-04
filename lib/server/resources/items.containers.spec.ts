import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** DB-backed — scope resolution and custody-vs-visibility are not provable as pure
 *  logic. See mutate.spec.ts's header for the `.env`-loading detail; identical here. */
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
type PrismaModule = typeof import("../prisma");

let containers: ItemsModule["containers"];
let prisma: PrismaModule["prisma"];

let seCustodianId: string;
let seHeadId: string;
let chemCustodianId: string;

let groupId: string;
let openCategoryId: string; // ANYWHERE — the category being placed in most tests
let containerCategoryId: string; // ANYWHERE — a legal container for restrictedCategoryId
let otherCategoryId: string; // ANYWHERE — NOT on restrictedCategoryId's allow-list
let restrictedCategoryId: string; // ONLY_LISTED, allow-list = [containerCategoryId]

let seContainerItemId: string;
let seOtherItemId: string;
let chemContainerItemId: string;

const testKey = `__test-containers-${Date.now()}`;

beforeAll(async () => {
  ({ containers } = await import("./items"));
  ({ prisma } = await import("../prisma"));

  const [seCustodian, seHead, chemCustodian, seNode, chemNode] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { email: "custodian.se@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "head.se@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "custodian.chem@astu.edu.et" } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Software Engineering" } } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Chemical" } } }),
  ]);
  seCustodianId = seCustodian.id;
  seHeadId = seHead.id;
  chemCustodianId = chemCustodian.id;

  const group = await prisma.categoryGroup.create({ data: { name: testKey, sortOrder: 999 } });
  groupId = group.id;

  const [open, container, other] = await Promise.all([
    prisma.resourceCategory.create({ data: { key: `${testKey}-open`, name: "Containers Open", iconKey: "box", groupId, countingMode: "SERIALIZED" } }),
    prisma.resourceCategory.create({ data: { key: `${testKey}-container`, name: "Containers Container", iconKey: "box", groupId, countingMode: "SERIALIZED" } }),
    prisma.resourceCategory.create({ data: { key: `${testKey}-other`, name: "Containers Other", iconKey: "box", groupId, countingMode: "SERIALIZED" } }),
  ]);
  openCategoryId = open.id;
  containerCategoryId = container.id;
  otherCategoryId = other.id;

  const restricted = await prisma.resourceCategory.create({
    data: { key: `${testKey}-restricted`, name: "Containers Restricted", iconKey: "box", groupId, countingMode: "SERIALIZED", placement: "ONLY_LISTED" },
  });
  restrictedCategoryId = restricted.id;
  await prisma.categoryPlacementRule.create({ data: { childCategoryId: restrictedCategoryId, parentCategoryId: containerCategoryId } });

  const [seContainerItem, seOtherItem, chemContainerItem] = await Promise.all([
    prisma.item.create({
      data: { categoryId: containerCategoryId, name: "SE Container Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    }),
    prisma.item.create({
      data: { categoryId: otherCategoryId, name: "SE Other Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    }),
    prisma.item.create({
      data: { categoryId: containerCategoryId, name: "Chem Container Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: chemNode.id, currentOrgNodeId: chemNode.id, custodianId: chemCustodianId },
    }),
  ]);
  seContainerItemId = seContainerItem.id;
  seOtherItemId = seOtherItem.id;
  chemContainerItemId = chemContainerItem.id;
});

afterAll(async () => {
  const itemIds = [seContainerItemId, seOtherItemId, chemContainerItemId];
  await prisma.itemChange.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.categoryPlacementRule.deleteMany({ where: { childCategoryId: restrictedCategoryId } });
  await prisma.resourceCategory.deleteMany({ where: { id: { in: [openCategoryId, containerCategoryId, otherCategoryId, restrictedCategoryId] } } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.$disconnect();
});

describe("items.containers — in scope, write-eligible, placement-legal", () => {
  it("offers every custodied item as a destination for an ANYWHERE category, and never a foreign department's", async () => {
    const options = await containers(seCustodianId, openCategoryId);
    const ids = options.map((o) => o.id);
    expect(ids).toContain(seContainerItemId);
    expect(ids).toContain(seOtherItemId);
    expect(ids).not.toContain(chemContainerItemId);
  });

  it("restricts an ONLY_LISTED category to only the container categories on its allow-list", async () => {
    const options = await containers(seCustodianId, restrictedCategoryId);
    const ids = options.map((o) => o.id);
    expect(ids).toContain(seContainerItemId); // containerCategoryId is on the allow-list
    expect(ids).not.toContain(seOtherItemId); // otherCategoryId is not
    expect(ids).not.toContain(chemContainerItemId); // not visible to this custodian anyway
  });

  it("excludes an item the caller can see (org subtree reach) but does not custody — visibility alone is not write-eligibility", async () => {
    // seHead is SE's MANAGER: broad read reach over the whole SE subtree, but never
    // custodies these items directly — assertCanMutate's own policy this endpoint
    // must mirror, so the picker never offers a destination the write path would 404.
    const options = await containers(seHeadId, openCategoryId);
    const ids = options.map((o) => o.id);
    expect(ids).not.toContain(seContainerItemId);
    expect(ids).not.toContain(seOtherItemId);
  });

  it("excludeSubtreeIds drops the named item from the result, without disturbing the rest", async () => {
    const options = await containers(seCustodianId, openCategoryId, [seContainerItemId]);
    const ids = options.map((o) => o.id);
    expect(ids).not.toContain(seContainerItemId);
    expect(ids).toContain(seOtherItemId);
  });

  it("rejects an unknown categoryId", async () => {
    await expect(containers(seCustodianId, "not-a-real-category-id")).rejects.toMatchObject({ status: 400 });
  });
});

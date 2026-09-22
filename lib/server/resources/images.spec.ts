import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * DB- and filesystem-backed — mirrors mutate.spec.ts's own rationale: real
 * authorization, a real two-step upload session lifecycle, and real file cleanup
 * after a committed transaction are not provable as pure logic (image-sniff.spec.ts
 * already covers the one part that is). See mutate.spec.ts's header for the
 * `.env`-loading detail; identical here.
 */
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

function pngBytes(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

type ImagesModule = typeof import("./images");
type MutateModule = typeof import("./mutate");
type StorageModule = typeof import("./storage");
type PrismaModule = typeof import("../prisma");

let images: ImagesModule;
let applyChange: MutateModule["applyChange"];
let storage: StorageModule["storage"];
let prisma: PrismaModule["prisma"];

let sysAdminId: string;
let seCustodianId: string;
let seHeadId: string;
let chemHeadId: string;
let chemCustodianId: string;

let groupId: string;
let categoryId: string;
let seItemId: string;
let chemItemId: string;
let childItemId: string;

beforeAll(async () => {
  images = await import("./images");
  ({ applyChange } = await import("./mutate"));
  ({ storage } = await import("./storage"));
  ({ prisma } = await import("../prisma"));

  const [sysAdmin, seCustodian, seHead, chemHead, chemCustodian, seNode, chemNode] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } }),
    prisma.user.findFirstOrThrow({ where: { email: "custodian.se@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "head.se@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "head.chem@astu.edu.et" } }),
    prisma.user.findFirstOrThrow({ where: { email: "custodian.chem@astu.edu.et" } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Software Engineering" } } }),
    prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Chemical" } } }),
  ]);
  sysAdminId = sysAdmin.id;
  seCustodianId = seCustodian.id;
  seHeadId = seHead.id;
  chemHeadId = chemHead.id;
  chemCustodianId = chemCustodian.id;

  const group = await prisma.categoryGroup.create({ data: { name: `__test-images-${Date.now()}`, sortOrder: 999 } });
  groupId = group.id;
  const category = await prisma.resourceCategory.create({
    data: { key: `__test-images-${Date.now()}`, name: "Images Test Category", iconKey: "Package", groupId, countingMode: "SERIALIZED" },
  });
  categoryId = category.id;

  const [seItem, chemItem] = await Promise.all([
    prisma.item.create({
      data: { categoryId, name: "SE Images Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    }),
    prisma.item.create({
      data: { categoryId, name: "ChemE Images Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: chemNode.id, currentOrgNodeId: chemNode.id, custodianId: chemCustodianId },
    }),
  ]);
  seItemId = seItem.id;
  chemItemId = chemItem.id;
  const child = await prisma.item.create({
    data: { categoryId, name: "SE Images Child", parentId: seItemId, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
  });
  childItemId = child.id;
});

afterAll(async () => {
  await prisma.itemImage.deleteMany({ where: { itemId: { in: [seItemId, chemItemId, childItemId] } } });
  await prisma.imageUpload.deleteMany({ where: { itemId: { in: [seItemId, chemItemId, childItemId] } } });
  await prisma.itemChange.deleteMany({ where: { itemId: { in: [seItemId, chemItemId, childItemId] } } });
  await prisma.item.deleteMany({ where: { id: { in: [childItemId, seItemId, chemItemId] } } });
  await prisma.resourceCategory.delete({ where: { id: categoryId } });
  await prisma.categoryGroup.delete({ where: { id: groupId } });
  await prisma.$disconnect();
});

describe("images — upload-session authorization", () => {
  it("lets the item's own custodian create an upload session", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    expect(session.uploadSessionId).toBeTruthy();
    expect(session.uploadUrl).toBe(`/api/resources/images/upload/${session.uploadSessionId}`);
    const row = await prisma.imageUpload.findUniqueOrThrow({ where: { id: session.uploadSessionId } });
    expect(row.status).toBe("PENDING");
    expect(row.requestedById).toBe(seCustodianId);
  });

  it("refuses a MANAGER an upload session in their own department without custody (2026-09-22)", async () => {
    await expect(images.createUploadSession(seHeadId, seItemId)).rejects.toMatchObject({ status: 404 });
  });

  it("still refuses a MANAGER from a DIFFERENT department — the widening is subtree-scoped, not blanket", async () => {
    await expect(images.createUploadSession(chemHeadId, seItemId)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a custodian from a different department", async () => {
    await expect(images.createUploadSession(chemCustodianId, seItemId)).rejects.toMatchObject({ status: 404 });
  });

  it("lets SYS_ADMIN create a session on any item", async () => {
    const session = await images.createUploadSession(sysAdminId, seItemId);
    expect(session.uploadSessionId).toBeTruthy();
  });
});

describe("images — receiving bytes", () => {
  it("sniffs the real format/dimensions from the bytes, ignoring what a caller might have claimed", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    const result = await images.receiveUpload(seCustodianId, session.uploadSessionId, pngBytes(64, 48));
    expect(result).toEqual({ contentType: "image/png", byteSize: 24, width: 64, height: 48 });

    const row = await prisma.imageUpload.findUniqueOrThrow({ where: { id: session.uploadSessionId } });
    expect(row.status).toBe("UPLOADED");
    expect(row.contentType).toBe("image/png");
    const stored = await storage.read(row.storageKey);
    expect(stored?.equals(pngBytes(64, 48))).toBe(true);
    await storage.remove(row.storageKey);
    await prisma.imageUpload.delete({ where: { id: row.id } });
  });

  it("refuses an SVG (or any unrecognized bytes), leaving the session PENDING", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");
    await expect(images.receiveUpload(seCustodianId, session.uploadSessionId, svg)).rejects.toMatchObject({ status: 400 });

    const row = await prisma.imageUpload.findUniqueOrThrow({ where: { id: session.uploadSessionId } });
    expect(row.status).toBe("PENDING");
    await prisma.imageUpload.delete({ where: { id: row.id } });
  });

  it("refuses an image whose real dimensions exceed the server limit", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    await expect(images.receiveUpload(seCustodianId, session.uploadSessionId, pngBytes(9000, 9000))).rejects.toMatchObject({ status: 400 });
    await prisma.imageUpload.delete({ where: { id: session.uploadSessionId } });
  });

  it("refuses a different actor from uploading into someone else's session", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    await expect(images.receiveUpload(sysAdminId, session.uploadSessionId, pngBytes(10, 10))).rejects.toMatchObject({ status: 404 });
    await prisma.imageUpload.delete({ where: { id: session.uploadSessionId } });
  });

  it("refuses a second upload into an already-UPLOADED session", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    await images.receiveUpload(seCustodianId, session.uploadSessionId, pngBytes(10, 10));
    await expect(images.receiveUpload(seCustodianId, session.uploadSessionId, pngBytes(20, 20))).rejects.toMatchObject({ status: 409 });

    const row = await prisma.imageUpload.findUniqueOrThrow({ where: { id: session.uploadSessionId } });
    await storage.remove(row.storageKey);
    await prisma.imageUpload.delete({ where: { id: row.id } });
  });

  it("refuses an expired session outright, even with valid bytes", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    await prisma.imageUpload.update({ where: { id: session.uploadSessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(images.receiveUpload(seCustodianId, session.uploadSessionId, pngBytes(10, 10))).rejects.toMatchObject({ status: 409 });
    // The expired-session path deletes the row itself.
    await expect(prisma.imageUpload.findUnique({ where: { id: session.uploadSessionId } })).resolves.toBeNull();
  });
});

describe("images — finalizing through applyChange (addImage)", () => {
  async function uploadedSession(itemId: string, actorId = seCustodianId) {
    const session = await images.createUploadSession(actorId, itemId);
    await images.receiveUpload(actorId, session.uploadSessionId, pngBytes(80, 60));
    return session;
  }

  it("creates a real ItemImage with server-verified metadata, bumps version, and logs an audit line", async () => {
    const session = await uploadedSession(seItemId);
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });

    const result = await applyChange(seCustodianId, {
      kind: "addImage",
      itemIds: [seItemId],
      uploadSessionId: session.uploadSessionId,
      caption: "Front panel",
      expectedVersions: { [seItemId]: before.version },
    });
    expect(result.applied).toBe(1);

    const image = await prisma.itemImage.findFirstOrThrow({ where: { itemId: seItemId, storageKey: (await prisma.imageUpload.findUniqueOrThrow({ where: { id: session.uploadSessionId } })).storageKey } });
    expect(image).toMatchObject({ contentType: "image/png", byteSize: 24, width: 80, height: 60, caption: "Front panel" });

    const upload = await prisma.imageUpload.findUniqueOrThrow({ where: { id: session.uploadSessionId } });
    expect(upload.status).toBe("FINALIZED");

    const after = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    expect(after.version).toBe(before.version + 1);

    const audit = await prisma.itemChange.findFirst({ where: { itemId: seItemId, kind: "addImage" }, orderBy: { at: "desc" } });
    expect(audit).toMatchObject({ after: "Front panel" });

    await prisma.itemImage.delete({ where: { id: image.id } });
    await storage.remove(image.storageKey);
  });

  it("refuses to finalize the same session twice", async () => {
    const session = await uploadedSession(seItemId);
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await applyChange(seCustodianId, { kind: "addImage", itemIds: [seItemId], uploadSessionId: session.uploadSessionId, expectedVersions: { [seItemId]: before.version } });

    const mid = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await expect(
      applyChange(seCustodianId, { kind: "addImage", itemIds: [seItemId], uploadSessionId: session.uploadSessionId, expectedVersions: { [seItemId]: mid.version } }),
    ).rejects.toMatchObject({ status: 409 });

    const imageCount = await prisma.itemImage.count({ where: { itemId: seItemId } });
    expect(imageCount).toBe(1); // the second attempt created nothing

    const after = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    expect(after.version).toBe(mid.version); // refused, no partial bump

    const image = await prisma.itemImage.findFirstOrThrow({ where: { itemId: seItemId } });
    await prisma.itemImage.delete({ where: { id: image.id } });
    await storage.remove(image.storageKey);
  });

  it("refuses to finalize a session against a different item than it was created for", async () => {
    const session = await uploadedSession(seItemId);
    const before = await prisma.item.findUniqueOrThrow({ where: { id: childItemId } });
    await expect(
      applyChange(seCustodianId, { kind: "addImage", itemIds: [childItemId], uploadSessionId: session.uploadSessionId, expectedVersions: { [childItemId]: before.version } }),
    ).rejects.toMatchObject({ status: 400 });

    const upload = await prisma.imageUpload.findUniqueOrThrow({ where: { id: session.uploadSessionId } });
    await storage.remove(upload.storageKey);
    await prisma.imageUpload.delete({ where: { id: upload.id } });
  });

  it("refuses a session that was never uploaded into (still PENDING)", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await expect(
      applyChange(seCustodianId, { kind: "addImage", itemIds: [seItemId], uploadSessionId: session.uploadSessionId, expectedVersions: { [seItemId]: before.version } }),
    ).rejects.toMatchObject({ status: 400 });
    await prisma.imageUpload.delete({ where: { id: session.uploadSessionId } });
  });

  it("refuses a stale-version addImage and applies nothing", async () => {
    const session = await uploadedSession(seItemId);
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await expect(
      applyChange(seCustodianId, { kind: "addImage", itemIds: [seItemId], uploadSessionId: session.uploadSessionId, expectedVersions: { [seItemId]: before.version + 1 } }),
    ).rejects.toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });

    const after = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    expect(after.version).toBe(before.version);
    expect(await prisma.itemImage.count({ where: { itemId: seItemId } })).toBe(0);

    const upload = await prisma.imageUpload.findUniqueOrThrow({ where: { id: session.uploadSessionId } });
    expect(upload.status).toBe("UPLOADED"); // still claimable — the refusal never touched it
    await storage.remove(upload.storageKey);
    await prisma.imageUpload.delete({ where: { id: upload.id } });
  });
});

describe("images — cleanup after a committed transaction, never before", () => {
  it("deletes the file from storage when a photo is removed, only after the removal commits", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    await images.receiveUpload(seCustodianId, session.uploadSessionId, pngBytes(10, 10));
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await applyChange(seCustodianId, { kind: "addImage", itemIds: [seItemId], uploadSessionId: session.uploadSessionId, expectedVersions: { [seItemId]: before.version } });

    const image = await prisma.itemImage.findFirstOrThrow({ where: { itemId: seItemId } });
    expect(await storage.read(image.storageKey)).not.toBeNull();

    const mid = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await applyChange(seCustodianId, { kind: "removeImage", itemIds: [seItemId], imageId: image.id, expectedVersions: { [seItemId]: mid.version } });

    expect(await prisma.itemImage.findUnique({ where: { id: image.id } })).toBeNull();
    expect(await storage.read(image.storageKey)).toBeNull();
  });

  it("does not delete the file when removeImage is refused by a version conflict", async () => {
    const session = await images.createUploadSession(seCustodianId, seItemId);
    await images.receiveUpload(seCustodianId, session.uploadSessionId, pngBytes(10, 10));
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await applyChange(seCustodianId, { kind: "addImage", itemIds: [seItemId], uploadSessionId: session.uploadSessionId, expectedVersions: { [seItemId]: before.version } });
    const image = await prisma.itemImage.findFirstOrThrow({ where: { itemId: seItemId } });

    const mid = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await expect(
      applyChange(seCustodianId, { kind: "removeImage", itemIds: [seItemId], imageId: image.id, expectedVersions: { [seItemId]: mid.version + 1 } }),
    ).rejects.toMatchObject({ status: 409 });

    expect(await prisma.itemImage.findUnique({ where: { id: image.id } })).not.toBeNull();
    expect(await storage.read(image.storageKey)).not.toBeNull();

    await prisma.itemImage.delete({ where: { id: image.id } });
    await storage.remove(image.storageKey);
  });

  it("F-025: a deleted subtree is soft-deleted — every photo and pending upload stays exactly where it is, nothing physically removed", async () => {
    // A photo on the parent, an UPLOADED-but-never-finalized session on the child —
    // deleteItem is now a soft delete (deletedAt, the row and every photo behind
    // it kept, recoverable), not the hard delete this test used to prove wiped
    // storage clean — see mutate.ts's own applyDeleteItem note.
    const parentSession = await images.createUploadSession(seCustodianId, seItemId);
    await images.receiveUpload(seCustodianId, parentSession.uploadSessionId, pngBytes(10, 10));
    const before = await prisma.item.findUniqueOrThrow({ where: { id: seItemId } });
    await applyChange(seCustodianId, { kind: "addImage", itemIds: [seItemId], uploadSessionId: parentSession.uploadSessionId, expectedVersions: { [seItemId]: before.version } });
    const parentImage = await prisma.itemImage.findFirstOrThrow({ where: { itemId: seItemId } });

    const childSession = await images.createUploadSession(seCustodianId, childItemId);
    await images.receiveUpload(seCustodianId, childSession.uploadSessionId, pngBytes(10, 10));
    const childUpload = await prisma.imageUpload.findUniqueOrThrow({ where: { id: childSession.uploadSessionId } });

    expect(await storage.read(parentImage.storageKey)).not.toBeNull();
    expect(await storage.read(childUpload.storageKey)).not.toBeNull();

    await applyChange(seCustodianId, { kind: "deleteItem", itemIds: [seItemId] });

    expect(await storage.read(parentImage.storageKey)).not.toBeNull();
    expect(await storage.read(childUpload.storageKey)).not.toBeNull();
    const parentAfter = await prisma.item.findUnique({ where: { id: seItemId } });
    const childAfter = await prisma.item.findUnique({ where: { id: childItemId } });
    expect(parentAfter?.deletedAt).not.toBeNull();
    expect(childAfter?.deletedAt).not.toBeNull();
    expect(await prisma.itemImage.findUnique({ where: { id: parentImage.id } })).not.toBeNull(); // the row survives too

    await prisma.itemImage.delete({ where: { id: parentImage.id } });
    await storage.remove(parentImage.storageKey);
    await storage.remove(childUpload.storageKey);
    await prisma.item.deleteMany({ where: { id: { in: [seItemId, childItemId] } } });

    // Recreate the fixtures this describe block's own afterAll (the outer one)
    // expects to still exist, since this test deliberately deleted them.
    const seNode = await prisma.orgNode.findFirstOrThrow({ where: { name: { contains: "Software Engineering" } } });
    const seItem = await prisma.item.create({
      data: { categoryId, name: "SE Images Item", countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    });
    seItemId = seItem.id;
    const child = await prisma.item.create({
      data: { categoryId, name: "SE Images Child", parentId: seItemId, countingMode: "SERIALIZED", status: "WORKING", ownerOrgNodeId: seNode.id, currentOrgNodeId: seNode.id, custodianId: seCustodianId },
    });
    childItemId = child.id;
  });
});

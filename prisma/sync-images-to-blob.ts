/**
 * Makes sure every stored file the database points at — item photos, category default
 * images, outside-request letters — exists in Vercel Blob, uploading any that are
 * missing from local storage (.local-storage/images, or IMAGE_STORAGE_DIR).
 *
 * Needed once after seeding or restoring a database whose files were written to local
 * disk (the ChemE equipment photos were): production reads Blob only, so those files
 * were a 404 there.
 *
 *   DATABASE_URL=<production> BLOB_READ_WRITE_TOKEN=<token> npx tsx prisma/sync-images-to-blob.ts           # report only
 *   DATABASE_URL=<production> BLOB_READ_WRITE_TOKEN=<token> npx tsx prisma/sync-images-to-blob.ts --apply   # uploads
 *
 * Safe to re-run: files already in Blob are left alone. Same `images/` pathname and
 * private access as lib/server/resources/storage/vercel-blob-driver.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { head, put } from "@vercel/blob";

const apply = process.argv.includes("--apply");
const ROOT = process.env.IMAGE_STORAGE_DIR ? path.resolve(process.env.IMAGE_STORAGE_DIR) : path.resolve(process.cwd(), ".local-storage", "images");

async function inBlob(key: string): Promise<boolean> {
  try {
    await head(`images/${key}`);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
  const prisma = new PrismaClient();
  try {
    const [images, categories, letters] = await Promise.all([
      prisma.itemImage.findMany({ select: { storageKey: true } }),
      prisma.resourceCategory.findMany({ where: { defaultImageKey: { not: null } }, select: { defaultImageKey: true } }),
      prisma.externalRequest.findMany({ select: { letterStorageKey: true } }),
    ]);
    const keys = [...new Set([...images.map((i) => i.storageKey), ...categories.map((c) => c.defaultImageKey!), ...letters.map((l) => l.letterStorageKey)])];

    let present = 0;
    let uploaded = 0;
    const missing: string[] = [];
    for (const key of keys) {
      if (await inBlob(key)) {
        present += 1;
        continue;
      }
      const bytes = await readFile(path.join(ROOT, key)).catch(() => null);
      if (!bytes) {
        missing.push(key);
        continue;
      }
      if (apply) await put(`images/${key}`, bytes, { access: "private", addRandomSuffix: false, allowOverwrite: true });
      uploaded += 1;
      console.log(`${apply ? "uploaded" : "would upload"} ${key} (${bytes.length} bytes)`);
    }
    console.log(`\n${keys.length} files referenced: ${present} already in Blob, ${uploaded} ${apply ? "uploaded" : "to upload"}, ${missing.length} in neither place.`);
    for (const key of missing) console.log(`  not found anywhere: ${key}`);
    if (!apply && uploaded) console.log("Run again with --apply to upload.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

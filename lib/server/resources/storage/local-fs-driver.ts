import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageDriver } from "./driver";

/**
 * The development/test storage backend — plain files on disk. This is the required
 * interim implementation while no production object-store target (S3, MinIO, ...) has
 * been chosen; it is not a placeholder to "get back to" so much as a real, working
 * driver that a later production driver sits alongside, selected by
 * `IMAGE_STORAGE_DRIVER` (see `index.ts`).
 *
 * Directory is `IMAGE_STORAGE_DIR` if set, else `.local-storage/images` under the repo
 * root — gitignored (`.local-storage/`), never committed, matching the "uploaded files
 * must not be committed to Git" requirement even before any file is written.
 */
const ROOT = process.env.IMAGE_STORAGE_DIR ? path.resolve(process.env.IMAGE_STORAGE_DIR) : path.resolve(process.cwd(), ".local-storage", "images");

/** Keys are always server-generated (`crypto.randomUUID()`, see images.ts) — this
 *  charset check is defense in depth against a key ever reaching here malformed, not
 *  the primary guarantee. Rejects anything that could path-traverse (`..`, `/`, `\`). */
function pathFor(key: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`Refusing to touch storage for an invalid key: ${JSON.stringify(key)}`);
  return path.join(ROOT, key);
}

export const localFsDriver: StorageDriver = {
  async write(key, bytes) {
    await mkdir(ROOT, { recursive: true });
    await writeFile(pathFor(key), bytes);
  },
  async read(key) {
    try {
      return await readFile(pathFor(key));
    } catch {
      return null;
    }
  },
  async remove(key) {
    await rm(pathFor(key), { force: true });
  },
};

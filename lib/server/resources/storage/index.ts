import "server-only";
import type { StorageDriver } from "./driver";
import { localFsDriver } from "./local-fs-driver";
import { vercelBlobDriver } from "./vercel-blob-driver";

/**
 * The storage backend is chosen once, here, by `IMAGE_STORAGE_DRIVER` — everywhere
 * else in the app imports `storage` from this module and never knows or cares which
 * backend is behind it. `local` is the dev/test driver; `vercel-blob`
 * (`vercel-blob-driver.ts`) is the production one — `local`'s filesystem writes do
 * not survive Vercel's read-only, ephemeral filesystem. Adding a further production
 * target later means writing one new file next to these two and adding one branch
 * below, nothing else in the codebase changes.
 */
function selectDriver(): StorageDriver {
  const kind = process.env.IMAGE_STORAGE_DRIVER ?? "local";
  switch (kind) {
    case "local":
      return localFsDriver;
    case "vercel-blob":
      return vercelBlobDriver;
    default:
      throw new Error(`Unknown IMAGE_STORAGE_DRIVER "${kind}" — no driver registered for it. Use "local" or "vercel-blob", or add one to lib/server/resources/storage/.`);
  }
}

export const storage: StorageDriver = selectDriver();
export type { StorageDriver } from "./driver";

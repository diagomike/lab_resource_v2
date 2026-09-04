import "server-only";
import type { StorageDriver } from "./driver";
import { localFsDriver } from "./local-fs-driver";

/**
 * The storage backend is chosen once, here, by `IMAGE_STORAGE_DRIVER` — everywhere
 * else in the app imports `storage` from this module and never knows or cares which
 * backend is behind it. No production object-store target has been selected yet
 * (S3, MinIO, ...); that is deliberately not a blocker — `local` is a complete,
 * correct interim driver, and adding a production one later means writing one new
 * file next to `local-fs-driver.ts` and adding one branch below, nothing else in the
 * codebase changes.
 */
function selectDriver(): StorageDriver {
  const kind = process.env.IMAGE_STORAGE_DRIVER ?? "local";
  switch (kind) {
    case "local":
      return localFsDriver;
    default:
      throw new Error(`Unknown IMAGE_STORAGE_DRIVER "${kind}" — no driver registered for it. Use "local", or add one to lib/server/resources/storage/.`);
  }
}

export const storage: StorageDriver = selectDriver();
export type { StorageDriver } from "./driver";

import "server-only";
import { del, get, put } from "@vercel/blob";
import type { StorageDriver } from "./driver";

/**
 * The production storage backend on Vercel — the local-filesystem driver
 * (`local-fs-driver.ts`) cannot survive there: Vercel's filesystem is read-only
 * outside `/tmp`, and `/tmp` itself does not persist across invocations, so every
 * uploaded photo would vanish. Selected by `IMAGE_STORAGE_DRIVER=vercel-blob` (see
 * `index.ts`'s selector); needs `BLOB_READ_WRITE_TOKEN` in the environment (Vercel
 * sets this automatically once a Blob store is attached to the project).
 *
 * `access: "private"` on every call — this SDK version supports it (`get`'s own
 * `{ access: "private" }` example), so there is no residual "leaked-URL bypasses
 * scope" risk to carry: a private blob's bytes are unreachable without the
 * `BLOB_READ_WRITE_TOKEN` this server holds, matching local-fs-driver's own
 * unreachable-outside-the-server guarantee. The app's own read route
 * (`app/api/resources/images/[storageKey]`) still re-resolves the key to its item and
 * runs `assertCanSeeItem` before ever calling `storage.read` — that check is the
 * actual security model and does not change because the backend did.
 *
 * Keys are always server-generated (`crypto.randomUUID()`, see `images.ts`) — namespaced
 * under `images/` as this driver's own pathname prefix, matching local-fs-driver's
 * `ROOT` concept, so a Blob store shared with any other future use of Vercel Blob in
 * this project would not collide.
 */
const PREFIX = "images/";

function pathFor(key: string): string {
  return `${PREFIX}${key}`;
}

export const vercelBlobDriver: StorageDriver = {
  async write(key, bytes) {
    // allowOverwrite: true matches the interface's own contract ("writes OR
    // OVERWRITES") — in practice every key is a freshly minted UUID and this never
    // fires, but the driver must not throw on the case its own interface promises.
    await put(pathFor(key), bytes, { access: "private", addRandomSuffix: false, allowOverwrite: true });
  },
  async read(key) {
    try {
      const result = await get(pathFor(key), { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch {
      // A missing key and any other read failure are the same case to every caller —
      // matching local-fs-driver's own `read()` contract exactly.
      return null;
    }
  },
  async remove(key) {
    try {
      await del(pathFor(key));
    } catch {
      // Best-effort — cleanup code must not fail the request that triggered it,
      // matching local-fs-driver's own `remove({ force: true })` discipline.
    }
  },
};

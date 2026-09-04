import "server-only";

/**
 * The one seam every image byte passes through. Nothing outside `storage/**` ever
 * touches a filesystem path or an object-store SDK directly — `images.ts` (the upload
 * session service) and the image-serving Route Handler both speak this interface only,
 * so swapping the backend (a real S3/MinIO driver, once one is chosen) means writing
 * one new file here and changing `index.ts`'s selector, nothing else in the app.
 *
 * Deliberately minimal: `write`/`read`/`remove` on an opaque key the caller already
 * generated (`images.ts`'s job, never the client's). No listing, no metadata storage
 * here — Prisma (`ItemImage`/`ImageUpload`) is the metadata store; this interface is
 * bytes only, exactly the "images and thumbnails must never enter Postgres" boundary.
 */
export interface StorageDriver {
  /** Writes (or overwrites) the bytes under `key`. */
  write(key: string, bytes: Buffer): Promise<void>;
  /** Reads bytes back, or `null` if nothing is stored under `key`. Never throws for a
   *  missing key — a missing file and an unknown key are the same case to every caller. */
  read(key: string): Promise<Buffer | null>;
  /** Deletes whatever is stored under `key`. Never throws if already absent — cleanup
   *  code (removeImage, a deleted subtree, an expired-upload sweep) calls this
   *  best-effort and must not fail the request that triggered it. */
  remove(key: string): Promise<void>;
}

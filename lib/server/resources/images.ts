import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { sniffImage } from "./image-sniff";
import { storage } from "./storage";

/**
 * The two-step upload — the server, not the client, owns every fact that matters.
 * Step 1 (`createUploadSession`) authorizes the upload and mints an opaque,
 * server-generated storage key the client never sees a way to choose or override.
 * Step 2 (`receiveUpload`) is the only place bytes are trusted: the declared
 * Content-Type is informational only, the real format/dimensions come from
 * `image-sniff.ts` reading the bytes themselves, and only THOSE server-derived facts
 * ever get written to `ImageUpload`. Step 3 — turning an UPLOADED session into a real
 * `ItemImage` — is `mutate.ts`'s `applyAddImage`, the one write door every other
 * mutation already goes through; this module never writes `ItemImage` itself.
 *
 * A session is single-use and time-boxed (`UPLOAD_TTL_MS`): `receiveUpload` only
 * accepts a PENDING session, `applyAddImage` only accepts an UPLOADED one, and both
 * refuse an expired one — closing the "repeated finalization" and "expired upload"
 * cases explicitly rather than leaving them to accident.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB — generous; the client already downscales before this is ever hit
export const MAX_DIMENSION = 8000; // guards against a decompression-bomb-shaped header, not a real photo
const UPLOAD_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for a slow mobile upload, short enough that an abandoned session doesn't linger

export interface UploadSessionDto {
  uploadSessionId: string;
  uploadUrl: string;
  expiresAt: string;
}

/** A bounded, opportunistic cleanup: sweeps this ITEM's own abandoned sessions
 *  (PENDING that never received bytes, or UPLOADED that never got finalized) whenever
 *  a new one is requested for it, so a session that a user picks a file for and then
 *  never applies does not sit as a permanent orphaned file. Bytes for any UPLOADED
 *  session are removed from storage before the row is deleted — the file must not
 *  outlive the only database record that named it. Not a substitute for a real
 *  scheduled sweep at production scale, but exact and correct at this scale, and
 *  directly callable/testable on its own. */
async function sweepExpiredForItem(itemId: string): Promise<void> {
  const now = new Date();
  const expired = await prisma.imageUpload.findMany({
    where: { itemId, status: { in: ["PENDING", "UPLOADED"] }, expiresAt: { lt: now } },
    select: { id: true, storageKey: true, status: true },
  });
  for (const row of expired) {
    if (row.status === "UPLOADED") await storage.remove(row.storageKey).catch(() => undefined);
  }
  if (expired.length) {
    await prisma.imageUpload.deleteMany({ where: { id: { in: expired.map((r) => r.id) } } });
  }
}

/** Step 1. Authorization here is the SAME custody-based write gate every other
 *  mutation uses (`scope.assertCanMutate`) — being able to see an item is not being
 *  able to attach a photo to it, exactly the policy the rest of the app already
 *  enforces; this is not a parallel, weaker check. */
export async function createUploadSession(actorId: string, itemId: string): Promise<UploadSessionDto> {
  await scope.assertCanMutate(actorId, [itemId]);
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item || item.deletedAt) throw new HttpError(400, "That resource no longer exists.");

  await sweepExpiredForItem(itemId);

  const storageKey = randomUUID();
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
  const row = await prisma.imageUpload.create({
    data: { itemId, storageKey, status: "PENDING", requestedById: actorId, expiresAt },
  });
  return { uploadSessionId: row.id, uploadUrl: `/api/resources/images/upload/${row.id}`, expiresAt: expiresAt.toISOString() };
}

/** Step 2. The only place a claimed Content-Type is compared against reality — and
 *  only for a friendlier error message; the STORED `contentType` always comes from
 *  `sniffImage`, never from `declaredContentType`. */
export async function receiveUpload(actorId: string, uploadSessionId: string, bytes: Buffer): Promise<{ contentType: string; byteSize: number; width: number; height: number }> {
  const row = await prisma.imageUpload.findUnique({ where: { id: uploadSessionId } });
  if (!row || row.requestedById !== actorId) throw new HttpError(404, "Upload session not found");
  if (row.status !== "PENDING") {
    throw new HttpError(409, "Upload session already used", {
      message: "This upload session has already been used or has expired.",
      code: "UPLOAD_SESSION_CONSUMED",
      status: row.status,
    });
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.imageUpload.delete({ where: { id: row.id } });
    throw new HttpError(409, "Upload session expired", { message: "This upload session has expired — choose the file again.", code: "UPLOAD_SESSION_EXPIRED" });
  }
  if (bytes.length === 0) throw new HttpError(400, "That file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(400, `That file is too large — the limit is ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);

  const sniffed = sniffImage(bytes);
  if (!sniffed) throw new HttpError(400, "Choose a JPEG, PNG, or WebP image — that file is not a recognized image format.");
  if (sniffed.width > MAX_DIMENSION || sniffed.height > MAX_DIMENSION) {
    throw new HttpError(400, `That image is too large — ${sniffed.width}×${sniffed.height} exceeds the ${MAX_DIMENSION}px limit per side.`);
  }

  await storage.write(row.storageKey, bytes);
  await prisma.imageUpload.update({
    where: { id: row.id },
    data: { status: "UPLOADED", contentType: sniffed.mimeType, byteSize: bytes.length, width: sniffed.width, height: sniffed.height, uploadedAt: new Date() },
  });

  return { contentType: sniffed.mimeType, byteSize: bytes.length, width: sniffed.width, height: sniffed.height };
}

export type ImageServingLookup = { scope: "item"; itemId: string; contentType: string } | { scope: "category"; contentType: null } | null;

/** The image-serving endpoint's own lookup — scope is enforced by the caller (the
 *  Route Handler) via `scope.assertCanSeeItem` against the returned `itemId` BEFORE
 *  bytes are ever read from storage; this function only resolves metadata. A
 *  category's own `defaultImageKey` (Phase 9 wires the read path only — no admin UI
 *  uploads one yet, see PROGRESS.md) is shared vocabulary, readable by anyone signed
 *  in, so it carries no item to scope-check against and no stored content type
 *  either; the Route Handler sniffs it from the bytes it already has to read. */
export async function findImageForServing(storageKey: string): Promise<ImageServingLookup> {
  const image = await prisma.itemImage.findUnique({ where: { storageKey }, select: { itemId: true, contentType: true } });
  if (image) return { scope: "item", itemId: image.itemId, contentType: image.contentType };
  const category = await prisma.resourceCategory.findFirst({ where: { defaultImageKey: storageKey }, select: { id: true } });
  if (category) return { scope: "category", contentType: null };
  return null;
}

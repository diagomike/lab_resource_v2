import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PurchaseAttachment } from "@prisma/client";
import { ATTACHMENT_LIMITS, type PurchaseAttachmentDto } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import * as scope from "./scope";
import { REFUSAL_MESSAGE, cleanFileName, sniffDocument } from "./attachment-sniff";
import { normalizeDocumentImage } from "./image-normalize";
import { attachmentStorage } from "./storage";

/**
 * Documents on purchase requests — the minutes and stamped letters of authority a
 * head sends with a submission, and the letter an approver cites when approving,
 * rejecting or sending one back.
 *
 * Two steps, so a file can be chosen before the request or decision it goes with
 * exists:
 *  1. `stage` — the bytes are checked (`attachment-sniff.ts`), an image is re-encoded
 *     (`normalizeDocumentImage`: upright, metadata stripped, at most 2200px, JPEG),
 *     hashed, stored under `attachments/`, and recorded STAGED against the uploader.
 *  2. `claim` — inside the action's own transaction, the action's PurchaseEvent takes
 *     the uploader's own staged files. A failed action rolls the claim back with it.
 *
 * Size is managed at every level (`ATTACHMENT_LIMITS`): a per-file cap below the
 * hosting platform's request limit, a per-action count, a per-request count and total,
 * and a cap on what one person may have staged but not sent. Unsent files expire
 * after STAGE_TTL_MS and are swept whenever anyone uploads.
 */

const STAGE_TTL_MS = 12 * 60 * 60 * 1000;
/** A decompression-bomb guard for images, not a real page size. */
const MAX_IMAGE_PIXELS = 12000 * 12000;
const SWEEP_BATCH = 50;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const attachmentSelect = {
  id: true,
  fileName: true,
  kind: true,
  contentType: true,
  byteSize: true,
  uploadedById: true,
  createdAt: true,
  uploadedBy: { select: { name: true } },
} satisfies Prisma.PurchaseAttachmentSelect;

export type AttachmentRow = Prisma.PurchaseAttachmentGetPayload<{ select: typeof attachmentSelect }>;

/** For `requestInclude`'s events — what a request's history needs of each file. */
export const eventAttachmentsInclude = { orderBy: { createdAt: "asc" }, select: attachmentSelect } satisfies Prisma.PurchaseEvent$attachmentsArgs;

export function toAttachmentDto(row: AttachmentRow): PurchaseAttachmentDto {
  return {
    id: row.id,
    fileName: row.fileName,
    kind: row.kind,
    contentType: row.contentType,
    byteSize: row.byteSize,
    uploadedById: row.uploadedById,
    uploadedByName: row.uploadedBy.name,
    createdAt: row.createdAt.toISOString(),
    url: `/api/resources/purchase-attachments/${row.id}`,
  };
}

/** Removes staged files whose time ran out. Row first, bytes second, and only when
 *  the row really was deleted — a file claimed a moment ago is ATTACHED, not STAGED,
 *  so its bytes are never touched. Bounded per call; runs on every upload. */
export async function sweepExpired(now = new Date()): Promise<number> {
  const rows = await prisma.purchaseAttachment.findMany({
    where: { status: "STAGED", expiresAt: { lt: now } },
    select: { id: true, storageKey: true },
    take: SWEEP_BATCH,
  });
  let removed = 0;
  for (const row of rows) {
    const { count } = await prisma.purchaseAttachment.deleteMany({ where: { id: row.id, status: "STAGED" } });
    if (count) {
      await attachmentStorage.remove(row.storageKey);
      removed++;
    }
  }
  return removed;
}

/** Anyone who can take part in a purchase request may upload — including an occupant
 *  with no role at all (a post is what makes a dean an approver); a requester-portal
 *  account never can. Whether a file may go on a particular request is
 *  decided when an action claims it (the action's own authorization). */
async function assertMayUpload(actorId: string): Promise<void> {
  const roles = await scope.rolesOf(actorId);
  if (roles.length && roles.every((r) => r === "EXTERNAL")) throw new HttpError(403, "Your account can't attach documents to purchase requests.");
}

export async function stage(actorId: string, rawFileName: string | null, bytes: Buffer): Promise<PurchaseAttachmentDto> {
  await assertMayUpload(actorId);
  if (bytes.length === 0) throw new HttpError(400, "That file is empty.");
  if (bytes.length > ATTACHMENT_LIMITS.fileBytes) {
    throw new HttpError(
      400,
      `That file is ${formatBytes(bytes.length)} — the limit is ${formatBytes(ATTACHMENT_LIMITS.fileBytes)} a file. Scan at 150–200 dpi (grayscale for plain text), or split a long document into parts.`,
    );
  }

  await sweepExpired();

  const now = new Date();
  const pending = await prisma.purchaseAttachment.aggregate({
    where: { uploadedById: actorId, status: "STAGED", expiresAt: { gt: now } },
    _count: true,
    _sum: { byteSize: true },
  });
  if (pending._count >= ATTACHMENT_LIMITS.stagedFiles || (pending._sum.byteSize ?? 0) + bytes.length > ATTACHMENT_LIMITS.stagedBytes) {
    throw new HttpError(
      409,
      `You have ${pending._count} file${pending._count === 1 ? "" : "s"} (${formatBytes(pending._sum.byteSize ?? 0)}) uploaded but not yet sent. Send or remove them first — unsent files are cleared after 12 hours.`,
    );
  }

  const sniffed = sniffDocument(bytes);
  if (!sniffed.ok) throw new HttpError(400, REFUSAL_MESSAGE[sniffed.reason]);

  let stored: Buffer;
  let contentType: string;
  let ext: string;
  if (sniffed.doc.kind === "IMAGE") {
    const normalized = await normalizeDocumentImage(bytes, MAX_IMAGE_PIXELS);
    stored = normalized.bytes;
    contentType = normalized.contentType;
    ext = "jpg";
  } else {
    stored = bytes;
    contentType = sniffed.doc.contentType;
    ext = sniffed.doc.ext;
  }

  const storageKey = randomUUID();
  await attachmentStorage.write(storageKey, stored);
  try {
    const row = await prisma.purchaseAttachment.create({
      data: {
        storageKey,
        fileName: cleanFileName(rawFileName, ext),
        kind: sniffed.doc.kind,
        contentType,
        byteSize: stored.length,
        sha256: createHash("sha256").update(stored).digest("hex"),
        uploadedById: actorId,
        expiresAt: new Date(now.getTime() + STAGE_TTL_MS),
      },
      select: attachmentSelect,
    });
    return toAttachmentDto(row);
  } catch (err) {
    await attachmentStorage.remove(storageKey);
    throw err;
  }
}

/** The uploader takes back a file they haven't sent. */
export async function discard(actorId: string, attachmentId: string): Promise<void> {
  const row = await prisma.purchaseAttachment.findUnique({ where: { id: attachmentId }, select: { uploadedById: true, status: true, storageKey: true } });
  if (!row || row.uploadedById !== actorId) throw new HttpError(404, "File not found");
  if (row.status !== "STAGED") throw new HttpError(409, "That file has already been sent with the request and is part of its record.");
  const { count } = await prisma.purchaseAttachment.deleteMany({ where: { id: attachmentId, status: "STAGED" } });
  if (count) await attachmentStorage.remove(row.storageKey);
}

/**
 * Ties the actor's staged files to one action on one request. Runs inside that
 * action's transaction, after its PurchaseEvent is written, so the files and the
 * action stand or fall together. Refuses a file that isn't the actor's, has expired
 * or was already sent; more than `perAction` files; a request that would pass
 * `perRequest` or `requestBytes`; and a file whose exact bytes are already on the
 * request (the same letter attached twice).
 */
export async function claim(tx: Prisma.TransactionClient, actorId: string, attachmentIds: readonly string[] | undefined, purchaseId: string, eventId: string): Promise<number> {
  const ids = [...new Set(attachmentIds ?? [])];
  if (!ids.length) return 0;
  if (ids.length > ATTACHMENT_LIMITS.perAction) throw new HttpError(400, `Attach at most ${ATTACHMENT_LIMITS.perAction} files with one action.`);

  const now = new Date();
  const rows = await tx.purchaseAttachment.findMany({ where: { id: { in: ids } } });
  const usable = (r: PurchaseAttachment) => r.uploadedById === actorId && r.status === "STAGED" && r.expiresAt !== null && r.expiresAt > now;
  if (rows.length !== ids.length || !rows.every(usable)) {
    throw new HttpError(409, "One of the files has expired or was already sent. Remove it and attach it again.");
  }

  const existing = await tx.purchaseAttachment.findMany({ where: { purchaseId, status: "ATTACHED" }, select: { sha256: true, fileName: true, byteSize: true } });
  const count = existing.length + rows.length;
  if (count > ATTACHMENT_LIMITS.perRequest) {
    throw new HttpError(400, `A request can carry at most ${ATTACHMENT_LIMITS.perRequest} files; this one already has ${existing.length}.`);
  }
  const total = existing.reduce((n, r) => n + r.byteSize, 0) + rows.reduce((n, r) => n + r.byteSize, 0);
  if (total > ATTACHMENT_LIMITS.requestBytes) {
    throw new HttpError(
      400,
      `These files would bring the request to ${formatBytes(total)}; the limit is ${formatBytes(ATTACHMENT_LIMITS.requestBytes)} across all of its documents.`,
    );
  }

  const seen = new Map(existing.map((r) => [r.sha256, r.fileName]));
  for (const r of rows) {
    const already = seen.get(r.sha256);
    if (already) throw new HttpError(409, `“${r.fileName}” is already on this request${already === r.fileName ? "" : ` (as “${already}”)`}. Remove it and send the rest.`);
    seen.set(r.sha256, r.fileName);
  }

  const { count: claimed } = await tx.purchaseAttachment.updateMany({
    where: { id: { in: ids }, uploadedById: actorId, status: "STAGED", expiresAt: { gt: now } },
    data: { status: "ATTACHED", purchaseId, eventId, expiresAt: null },
  });
  if (claimed !== ids.length) throw new HttpError(409, "One of the files has expired or was already sent. Remove it and attach it again.");
  return claimed;
}

export type AttachmentForServing = { purchaseId: string | null; uploadedById: string; status: PurchaseAttachment["status"]; storageKey: string; fileName: string; contentType: string; kind: PurchaseAttachment["kind"] };

/** Metadata only — the Route Handler decides who may read it (the uploader for a
 *  staged file, whoever may read the request for an attached one) before any byte is
 *  fetched from storage. */
export async function findForServing(attachmentId: string): Promise<AttachmentForServing | null> {
  return prisma.purchaseAttachment.findUnique({
    where: { id: attachmentId },
    select: { purchaseId: true, uploadedById: true, status: true, storageKey: true, fileName: true, contentType: true, kind: true },
  });
}

export async function readBytes(storageKey: string): Promise<Buffer | null> {
  return attachmentStorage.read(storageKey);
}

"use client";

import { useRef, useState } from "react";
import type { ItemDetailDto, ItemRowDto, ResourceCategoryDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { categoryIconFor } from "@/lib/domain/icons";
import { Button } from "@/components/ui";

/**
 * What an item looks like — behaviorally ported from
 * temp_works/src/components/ItemImages.tsx and src/lib/images.ts's `downscale()`,
 * against this app's real two-step upload (lib/server/resources/images.ts) instead of
 * that sandbox's IndexedDB. An item shows its own photographs; one with none falls
 * back to its category's representative picture if it has one, which is what keeps
 * twenty-five identical workstation setups from each needing their own upload. Table
 * thumbnails still fall back to the category icon; the Inspector deliberately renders
 * no large media block at all when neither an item nor its category has a picture.
 */

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;

/** Shrinks a photo client-side before it ever leaves the browser — nothing in this UI
 *  renders a photo above ~600px, so there is no reason to upload a 4000px phone photo
 *  untouched. Ported behaviorally from temp_works' own `downscale()`; skips anything
 *  already small, and any browser missing `createImageBitmap` still gets to upload
 *  (the file goes up as-is, server-side dimension/size limits still apply). */
async function downscale(file: File): Promise<Blob> {
  if (typeof createImageBitmap === "undefined" || !file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 400_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    return blob ?? file;
  } catch {
    return file; // A browser without createImageBitmap still gets to upload.
  }
}

export interface UploadOutcome {
  ok: boolean;
  uploadSessionId?: string;
  message?: string;
}

/** Steps 1+2 of the upload: create the server-authorized session, then PUT the
 *  (downscaled) bytes to it. Returns the session id for the caller to finalize via the
 *  normal `request()`/`submitChange` `addImage` path (step 3) — version-conflict and
 *  authorization handling for the actual database write stays exactly where every
 *  other change already lives, not duplicated here. */
export async function uploadImageBytes(itemId: string, file: File): Promise<UploadOutcome> {
  try {
    const blob = await downscale(file);
    const session = await api.post<{ uploadSessionId: string; uploadUrl: string }>(`/resources/items/${itemId}/images/upload-sessions`);
    await api.putFile(session.uploadUrl, blob);
    return { ok: true, uploadSessionId: session.uploadSessionId };
  } catch (e) {
    return { ok: false, message: e instanceof ApiError ? e.message : "That photo could not be uploaded." };
  }
}

function fallbackUrl(category: ResourceCategoryDto | null | undefined): string | null {
  return category?.defaultImageKey ? `/api/resources/images/${category.defaultImageKey}` : null;
}

/** Small square for a table cell — read-only, no upload/remove affordance. */
export function ItemThumb({ row, category, className = "" }: { row: ItemRowDto; category?: ResourceCategoryDto | null; className?: string }) {
  const url = row.thumbnailUrl ?? fallbackUrl(category);
  const Icon = categoryIconFor(row.categoryIconKey);
  return (
    <span className={`grid place-items-center size-24 flex-none overflow-hidden rounded-2 border border-border2 bg-panel2 ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- served from our own API route, never optimizable by next/image's remote-pattern allowlist without naming every storage backend.
        <img src={url} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Icon className="size-13 text-faint" />
      )}
    </span>
  );
}

/** The Inspector's header block: one large picture with a thumbnail strip, upload and
 *  remove. Always editable when rendered — this app's own established rule (Phase 7)
 *  is that the SERVER refuses an unauthorized write; the UI does not pre-hide controls
 *  a signed-in reader might not be allowed to use, it lets the attempt fail cleanly. */
export function ItemImageGallery({
  item,
  category,
  expectedVersions,
  onAdd,
  onRemove,
  readOnly = false,
}: {
  item: ItemDetailDto;
  category: ResourceCategoryDto | null;
  expectedVersions: Record<string, number>;
  /** Called with the finalized upload's session id — the caller submits the actual
   *  `addImage` change (through the shared `request()`/`usePendingChange` machinery)
   *  and reloads on success. */
  onAdd: (uploadSessionId: string, caption: string) => Promise<void>;
  /** Called with the image id to remove — the caller submits `removeImage` the same
   *  way. */
  onRemove: (imageId: string) => void;
  /** The university browse's read-only drill-through — the main image and thumbnail
   *  strip still render, "+ Add photo"/"Remove" don't. */
  readOnly?: boolean;
}) {
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const shown = Math.min(active, Math.max(0, item.images.length - 1));
  const image = item.images[shown];
  const fallback = item.images.length === 0 ? fallbackUrl(category) : null;
  const url = image?.url ?? fallback;

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadImageBytes(item.id, file);
      if (!uploaded.ok || !uploaded.uploadSessionId) {
        setError(uploaded.message ?? "That photo could not be uploaded.");
        return;
      }
      await onAdd(uploaded.uploadSessionId, file.name.replace(/\.[^.]+$/, ""));
      setActive(item.images.length);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {url && (
        <div className="relative aspect-[16/10] w-full grid place-items-center overflow-hidden rounded-2 border border-border2 bg-panel2">
          {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API route. */}
          <img src={url} alt={image?.caption ?? item.name} className="absolute inset-0 size-full object-contain" />
          {fallback && (
            <span className="absolute bottom-6 left-6 rounded-2 bg-panel/85 px-6 py-3 text-9.5 text-dim">Category picture</span>
          )}
        </div>
      )}

      {(item.images.length > 0 || !readOnly) && (
        <div className="flex flex-wrap items-center gap-6">
          {item.images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              className={`size-32 flex-none overflow-hidden rounded-2 border bg-panel2 ${i === shown ? "border-accent" : "border-border2 hover:border-dim"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API route. */}
              <img src={img.url} alt="" className="size-full object-cover" loading="lazy" />
            </button>
          ))}
          {!readOnly && (
            <>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onPick(e.target.files)} />
              <Button onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? "Saving…" : "+ Add photo"}
              </Button>
              {image && (
                <Button variant="danger" onClick={() => onRemove(image.id)} disabled={busy}>
                  Remove
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {image?.caption && <p className="text-10.5 text-dim">{image.caption}</p>}
      {error && <p className="text-10.5 text-bad">{error}</p>}
    </div>
  );
}

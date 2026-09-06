"use client";

import type { ItemChangeInput, ItemChangeResultDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { getActiveViewId } from "./active-view";

/** `?view=<id>` — the person's currently active access view (Track 1), so the
 *  server's write-side `canEdit: false` gate (mutate.ts's `assertViewAllowsEdit`)
 *  checks the SAME view the sidebar picker and the read side are using, not
 *  whatever their default happens to be. Omitted entirely when no view is chosen —
 *  `resolveEffectiveView` then falls back to the person's own default exactly as it
 *  always has. */
function viewParam(): string {
  const id = getActiveViewId();
  return id ? `?view=${encodeURIComponent(id)}` : "";
}

export interface VersionConflict {
  itemId: string;
  expectedVersion: number;
  actualVersion: number;
}

export type SubmitResult =
  | { ok: true; result: ItemChangeResultDto }
  | { ok: false; conflict: true; conflicts: VersionConflict[]; message: string }
  | { ok: false; conflict: false; message: string };

function toResult(e: unknown, fallback: string): SubmitResult {
  if (e instanceof ApiError && e.status === 409 && e.body?.code === "VERSION_CONFLICT") {
    return { ok: false, conflict: true, conflicts: (e.body.conflicts as VersionConflict[] | undefined) ?? [], message: e.message };
  }
  return { ok: false, conflict: false, message: e instanceof ApiError ? e.message : fallback };
}

/** The one write door's single client entry point — every edit surface (inline
 *  commit, ItemActionModal, BulkPropModal, AddModal) submits through this, never
 *  `api.post` directly, so a 409 VERSION_CONFLICT is handled the same way everywhere
 *  rather than reimplemented per component. */
export async function submitChange(input: ItemChangeInput): Promise<SubmitResult> {
  try {
    const result = await api.post<ItemChangeResultDto>(`/resources/items/changes${viewParam()}`, input);
    return { ok: true, result };
  } catch (e) {
    return toResult(e, "Could not save this change.");
  }
}

/** The dry-run variant — validates and reports what WOULD happen (counts, and the
 *  same version-conflict/authorization checks the real write runs) without
 *  committing anything. Used to catch a doomed change before a confirm dialog even
 *  shows it, and to preview a bulk edit's blast radius. */
export async function previewItemChange(input: ItemChangeInput): Promise<SubmitResult> {
  try {
    const result = await api.post<ItemChangeResultDto>(`/resources/items/changes/preview${viewParam()}`, { change: input });
    return { ok: true, result };
  } catch (e) {
    return toResult(e, "Could not preview this change.");
  }
}

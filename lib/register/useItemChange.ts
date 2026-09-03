"use client";

import type { ItemChangeInput, ItemChangeResultDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";

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
    const result = await api.post<ItemChangeResultDto>("/resources/items/changes", input);
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
    const result = await api.post<ItemChangeResultDto>("/resources/items/changes/preview", { change: input });
    return { ok: true, result };
  } catch (e) {
    return toResult(e, "Could not preview this change.");
  }
}

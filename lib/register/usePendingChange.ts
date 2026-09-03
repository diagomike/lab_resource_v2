"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { ItemChangeInput, ItemChangeResultDto } from "@/lib/shared";
import { needsConfirm } from "@/lib/domain/types";
import { submitChange, type SubmitResult } from "./useItemChange";

export interface PendingChange {
  input: ItemChangeInput;
  title: string;
  /** Rendered as ConfirmDialog's message — plain text or a small JSX fragment. */
  message: ReactNode;
  tone?: "danger" | "warn" | "primary";
  confirmLabel?: string;
}

/**
 * The one state machine every edit surface in the register shares — the inline
 * table/inspector cells, the bulk-selection toolbar, and (indirectly, since they call
 * `submitChange` themselves once their own form is the confirmation step) AddModal
 * and BulkPropModal. Mirrors OrgStudioPage.tsx's `PendingAction`/`ConfirmDialog`
 * pattern exactly: `request()` either applies immediately (an uncomplicated
 * correction — `lib/domain/types.ts`'s `needsConfirm` says no) or opens the confirm
 * step first; nothing here invents a second dialog.
 */
export function usePendingChange(onApplied: (result: ItemChangeResultDto, input: ItemChangeInput) => void) {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async (change: PendingChange): Promise<SubmitResult | { ok: true; deferred: true }> => {
      setError(null);
      const itemCount = "itemIds" in change.input ? change.input.itemIds.length : 1;
      if (!needsConfirm(change.input.kind, itemCount)) {
        setBusy(true);
        const r = await submitChange(change.input);
        setBusy(false);
        if (r.ok) onApplied(r.result, change.input);
        else setError(r.message);
        return r;
      }
      setPending(change);
      return { ok: true, deferred: true };
    },
    [onApplied],
  );

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const r = await submitChange(pending.input);
    setBusy(false);
    if (!r.ok) {
      setError(r.conflict ? "This resource changed since you loaded it. Close and reopen to see the current version." : r.message);
      return;
    }
    setPending(null);
    onApplied(r.result, pending.input);
  }, [pending, onApplied]);

  const cancel = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  return { pending, busy, error, request, confirm, cancel };
}

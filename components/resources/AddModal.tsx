"use client";

import { useEffect, useState } from "react";
import type { ItemRowDto, ResourceCategoryDto } from "@/lib/shared";
import { api } from "@/lib/api";
import { Modal, Button, ErrorNote } from "@/components/ui";
import { submitChange } from "@/lib/register/useItemChange";

/** How many rows one instantiation of this category actually produces, parts
 *  included — the wire-DTO-shaped twin of lib/domain/edit-impact.ts's
 *  `templateSize` (that one runs against the domain `Category` map the server
 *  builds; this runs against the plain `ResourceCategoryDto[]` the categories
 *  endpoint returns, which is all a create-preview needs). */
function templateSize(categories: ResourceCategoryDto[], id: string, depth = 0): number {
  const c = categories.find((x) => x.id === id);
  if (!c || depth > 10) return 1;
  return 1 + c.templateChildren.reduce((a, ch) => a + ch.qty * templateSize(categories, ch.childCategoryId, depth + 1), 0);
}

/**
 * Creating a resource — ported from temp_works/src/components/AddModal.tsx, adapted:
 * this form IS the confirmation step (matching that component's own design — no
 * second ConfirmDialog on top, since createItem is always consequential per
 * lib/domain/types.ts's CONFIRMED_CHANGES and a multi-field form already stops to ask
 * before anything commits). Only a SYS_ADMIN may leave "Into" at the top level — see
 * PROGRESS.md's Phase 7 write-role entry: custody grants no root-level reach, so a
 * root create is refused server-side (404) for anyone else regardless of what this
 * picker offers; hidden here rather than offered and then bounced.
 */
export function AddModal({
  open,
  onClose,
  onCreated,
  containers,
  canCreateRoot,
  defaultParentId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  containers: ItemRowDto[];
  canCreateRoot: boolean;
  defaultParentId?: string | null;
}) {
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [parent, setParent] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setParent(defaultParentId ?? "");
    setCategoryId("");
    setCount(1);
    setError(null);
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then((rows) => setCategories(rows.filter((c) => c.active)))
      .catch(() => setCategories([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preview = categoryId ? templateSize(categories, categoryId) : 0;

  async function submit() {
    if (!categoryId) return;
    setBusy(true);
    setError(null);
    const r = await submitChange({
      kind: "createItem",
      parentId: parent || null,
      categoryId,
      count,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onCreated();
    onClose();
  }

  if (!open) return null;

  return (
    <Modal title="Add resources" onClose={onClose} width="480px">
      {error && <ErrorNote>{error}</ErrorNote>}
      <label className="block">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Into</div>
        <select
          value={parent}
          onChange={(e) => setParent(e.target.value)}
          className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
        >
          {canCreateRoot && <option value="">Top level (a new lab, store, building…)</option>}
          {containers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {!canCreateRoot && containers.length === 0 && (
          <div className="text-10.5 text-warn mt-4">You have no container in your custody to add into yet.</div>
        )}
      </label>
      <label className="block">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Category</div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
        >
          <option value="">Choose…</option>
          {categories
            .slice()
            .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.groupName} · {c.name}
              </option>
            ))}
        </select>
      </label>
      <label className="block">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">How many</div>
        <input
          type="number"
          min={1}
          max={200}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 font-mono outline-none focus:border-accent"
        />
      </label>
      {categoryId && (
        <p className="text-10.5 text-dim">
          Creates {count} × {categories.find((c) => c.id === categoryId)?.name}
          {preview > 1 && (
            <>
              , each with its full default subtree — <strong className="text-text font-mono">{count * preview}</strong> rows in total.
            </>
          )}
        </p>
      )}
      <div className="flex items-center gap-8">
        <Button variant="primary" disabled={!categoryId || busy} onClick={submit}>
          {busy ? "Creating…" : "Confirm & create"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

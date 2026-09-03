"use client";

import { useMemo, useState } from "react";
import type { CategoryFieldDto, ItemPropValue } from "@/lib/shared";
import { Modal, Button, ErrorNote } from "@/components/ui";
import { submitChange } from "@/lib/register/useItemChange";

/**
 * Bulk spec correction — "all 23 of these are Desktops". Ported from
 * temp_works/src/components/BulkPropModal.tsx: a single-cell correction is typed
 * straight into the inspector with no dialog (Inspector.tsx's `commitProp`); this
 * exists because the risk in a BULK edit is the size of the selection, not the field
 * — lib/domain/types.ts's `needsConfirm` confirms every multi-item edit regardless of
 * kind. The form itself is the confirmation step, same as AddModal.
 *
 * `field` must be one every selected item's category actually defines — the caller
 * (the register's selection toolbar) is expected to only offer fields common to the
 * selection; the server refuses (and rolls back the whole batch) if it isn't.
 */
export function BulkPropModal({
  itemIds,
  field,
  onClose,
  onApplied,
}: {
  itemIds: string[];
  field: CategoryFieldDto | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    if (!field) return null;
    if (field.type === "ENUM") return field.options.map((o) => ({ value: o, label: o }));
    if (field.type === "BOOLEAN") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
    return null;
  }, [field]);

  if (!field) return null;

  function coerce(): ItemPropValue {
    if (value === "") return null;
    if (field!.type === "NUMBER") return Number(value);
    if (field!.type === "BOOLEAN") return value === "true";
    return value;
  }

  async function apply() {
    setBusy(true);
    setError(null);
    const r = await submitChange({
      kind: "setProperty",
      itemIds,
      propKey: field!.key,
      value: coerce(),
      note: note.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onApplied();
    onClose();
  }

  return (
    <Modal title={`Set ${field.label.toLowerCase()} on ${itemIds.length} items`} onClose={onClose} width="440px">
      {error && <ErrorNote>{error}</ErrorNote>}
      <p className="text-10.5 text-dim">One value, written to every selected row, as one grouped entry in the change log.</p>
      <label className="block">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">New {field.label.toLowerCase()}</div>
        {options ? (
          <select
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
          >
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            autoFocus
            type={field.type === "NUMBER" ? "number" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.unit ? `Value in ${field.unit}` : "New value"}
            className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
          />
        )}
      </label>
      <label className="block">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Note (optional)</div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. corrected from the delivery note"
          className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
        />
      </label>
      <p className="text-10 text-faint">
        Values already set on a row are overwritten. Rows whose category does not define this property refuse the whole batch rather
        than being silently skipped.
      </p>
      <div className="flex items-center gap-8">
        <Button variant="primary" disabled={value === "" || busy} onClick={apply}>
          {busy ? "Applying…" : `Apply to ${itemIds.length} items`}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { ItemChangeDto, ItemDetailDto } from "@/lib/shared";
import { CHANGE_LABEL } from "@/lib/domain/types";
import { api, ApiError } from "@/lib/api";
import { Modal, ErrorNote } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { StatusChip } from "./StatusChip";

/**
 * Read-only for now — inline/bulk editing is Phase 7 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md. This is the browse+inspect half of
 * the register on its own: what an item is, where it sits, who answers for it, and
 * its own change history.
 */
export function Inspector({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const [item, setItem] = useState<ItemDetailDto | null>(null);
  const [changes, setChanges] = useState<ItemChangeDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) return;
    setItem(null);
    setChanges(null);
    setError(null);
    Promise.all([api.get<ItemDetailDto>(`/resources/items/${itemId}`), api.get<ItemChangeDto[]>(`/resources/items/${itemId}/changes`)])
      .then(([i, c]) => {
        setItem(i);
        setChanges(c);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this resource"));
  }, [itemId]);

  if (!itemId) return null;

  return (
    <Modal title={item?.name ?? "Resource"} onClose={onClose} width="560px">
      {error && <ErrorNote>{error}</ErrorNote>}
      {!item ? (
        <PanelLoading rows={4} />
      ) : (
        <>
          <div className="flex items-start justify-between gap-10">
            <div>
              <div className="text-13 font-semibold">{item.name}</div>
              <div className="text-10.5 text-dim mt-2">{item.categoryName}</div>
              {item.path.length > 0 && <div className="text-10 text-faint mt-2">{item.path.join(" › ")}</div>}
            </div>
            <StatusChip status={item.effectiveStatus} />
          </div>

          {item.readOnlyContext && (
            <div className="text-10.5 text-warn bg-warnbg border border-warn rounded-2 px-8 py-6">
              You are seeing this as the container of something you can act on — not something you hold yourself.
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-14 gap-y-8 text-11">
            <Field label="Quantity" value={item.countingMode === "BULK" ? item.qty.toLocaleString() : "1 unit"} />
            <Field label="Custodian" value={item.custodianName} />
            <Field label="Owning unit" value={item.ownerOrgNodeName} />
            <Field label="Current unit" value={item.currentOrgNodeName} />
            <Field label="Version" value={String(item.version)} />
            <Field label="Critical to parent" value={item.critical ? "Yes" : "No"} />
          </div>

          {Object.keys(item.props).length > 0 && (
            <div>
              <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-6">Properties</div>
              <div className="grid grid-cols-2 gap-x-14 gap-y-6 text-11">
                {Object.entries(item.props)
                  .filter(([, v]) => v !== null)
                  .map(([key, value]) => (
                    <Field key={key} label={key} value={String(value)} />
                  ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-6">History</div>
            {changes === null ? (
              <PanelLoading rows={2} />
            ) : changes.length === 0 ? (
              <div className="text-10.5 text-faint">No changes recorded yet.</div>
            ) : (
              <div className="flex flex-col gap-6">
                {changes.slice(0, 20).map((c) => (
                  <div key={c.id} className="text-10.5 border-b border-border pb-6">
                    <span className="text-dim">{CHANGE_LABEL[c.kind]}</span>
                    {c.field && <span className="text-faint"> · {c.field}</span>}
                    {(c.before !== null || c.after !== null) && (
                      <span className="text-faint">
                        {" "}
                        · {String(c.before ?? "—")} → {String(c.after ?? "—")}
                      </span>
                    )}
                    <div className="text-9.5 text-faint mt-1">
                      {c.actorName} · {new Date(c.at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-9.5 uppercase tracking-label text-faint font-semibold">{label}</div>
      <div className="text-11 mt-2">{value}</div>
    </div>
  );
}

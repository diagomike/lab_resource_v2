"use client";

import { useEffect, useState } from "react";
import type { ChainStepDto, RequestTransferResultDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Modal, Button, ErrorNote } from "@/components/ui";

type Store = { id: string; name: string; custodianName: string };
type Preview = { outcome: "APPLIED" | "ROUTED" | "DENIED"; reason: string; steps?: ChainStepDto[] };

/**
 * Sending resources back into the Main Store — surplus, or no longer needed. The
 * owning head agrees, Property Administration approves it coming back in, and the store
 * keeper accepts it; from then on the university owns it again, in the keeper's custody.
 * The chain is built by the server (lib/server/resources/approvals.ts); this only picks
 * the store and shows the chain before asking.
 */
export function ReturnToStoreModal({ itemIds, label, onClose, onDone }: { itemIds: string[]; label: string; onClose: () => void; onDone: () => void }) {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storeId, setStoreId] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RequestTransferResultDto | null>(null);

  useEffect(() => {
    api
      .get<Store[]>("/resources/transfers/stores")
      .then((list) => {
        setStores(list);
        if (list.length === 1) setStoreId(list[0].id);
      })
      .catch(() => setStores([]));
  }, []);

  const input = () => ({
    kind: "transferItem" as const,
    itemIds,
    note: note.trim() || undefined,
    transfer: { targetParentId: storeId, targetOrgNodeId: "", targetCustodianId: null },
  });

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!storeId) return;
    api
      .post<Preview>("/resources/transfers/preview", { input: input() })
      .then(setPreview)
      .catch((e) => setPreviewError(e instanceof ApiError ? e.message : "Could not resolve this request"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setDone(await api.post<RequestTransferResultDto>("/resources/transfers", { input: input() }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not request this return");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Return requested" onClose={onDone} width="440px">
        <div className="text-11.5 text-dim">
          {done.outcome === "APPLIED" ? "Returned — it is in the store now." : "Requested. Once it is approved, the store keeper accepts it into the store. Track it under Approvals → Raised by me."}
        </div>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title={`Return ${label} to the store`} onClose={onClose} width="480px">
      <div className="flex flex-col gap-6">
        <label className="text-9.5 uppercase tracking-label text-faint font-semibold">Into</label>
        {stores === null ? (
          <span className="text-10.5 text-faint">Loading…</span>
        ) : stores.length === 0 ? (
          <span className="text-10.5 text-bad">There is no Main Store in the register yet.</span>
        ) : (
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="h-28 px-6 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
          >
            <option value="">Choose a store…</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — kept by {s.custodianName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <label className="text-9.5 uppercase tracking-label text-faint font-semibold">Why (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. surplus after the lab refit"
          className="px-8 py-6 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
        />
      </div>

      {storeId && (
        <div className="text-10.5 border border-border2 rounded-2 px-8 py-6">
          {previewError ? (
            <ErrorNote>{previewError}</ErrorNote>
          ) : !preview ? (
            <span className="text-faint">Checking…</span>
          ) : preview.outcome === "DENIED" ? (
            <span className="text-bad">{preview.reason}</span>
          ) : preview.outcome === "APPLIED" ? (
            <span className="text-dim">Applies immediately — no approval needed.</span>
          ) : (
            <span className="text-dim">
              Needs: {preview.steps?.filter((s) => s.status !== "SKIPPED").map((s) => (s.approverName ? `${s.label} (${s.approverName})` : s.label)).join(" → ")}
            </span>
          )}
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-8">
        <Button variant="primary" onClick={submit} disabled={!storeId || !preview || preview.outcome === "DENIED" || busy}>
          {busy ? "Working…" : "Request return"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

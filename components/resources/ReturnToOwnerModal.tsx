"use client";

import { useEffect, useState } from "react";
import type { ChainStepDto, RequestTransferResultDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Modal, Button, ErrorNote } from "@/components/ui";

type Target = { suggested: { id: string; name: string } | null; options: Array<{ id: string; name: string }>; side: "LENDER" | "BORROWER" };
type Preview = { outcome: "APPLIED" | "ROUTED" | "DENIED"; reason: string; steps?: ChainStepDto[] };

/**
 * Sending something on loan back to the unit that owns it. Either side may: the lender
 * asks for it back (the borrower lets it go, then the owner confirms it arrived), or the
 * borrower returns it on their own (then only the owner confirms). The place it came
 * from is offered first. The chain is the server's (lib/server/resources/approvals.ts).
 */
export function ReturnToOwnerModal({ itemId, label, onClose, onDone }: { itemId: string; label: string; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [placeId, setPlaceId] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RequestTransferResultDto | null>(null);

  useEffect(() => {
    api
      .get<Target>(`/resources/transfers/return-target?itemId=${encodeURIComponent(itemId)}`)
      .then((t) => {
        setTarget(t);
        setPlaceId(t.suggested?.id ?? (t.options.length === 1 ? t.options[0].id : ""));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not find where it goes back to"));
  }, [itemId]);

  const input = () => ({
    kind: "transferItem" as const,
    itemIds: [itemId],
    note: note.trim() || undefined,
    transfer: { targetParentId: placeId, targetOrgNodeId: "", targetCustodianId: null },
  });

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!placeId) return;
    api
      .post<Preview>("/resources/transfers/preview", { input: input() })
      .then(setPreview)
      .catch((e) => setPreviewError(e instanceof ApiError ? e.message : "Could not resolve this return"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeId]);

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

  const borrower = target?.side === "BORROWER";

  if (done) {
    return (
      <Modal title="Return requested" onClose={onDone} width="440px">
        <div className="text-11.5 text-dim">
          {done.outcome === "APPLIED"
            ? "Returned. It is back with its owner."
            : borrower
              ? "Sent back. The owner confirms it arrived, and then it is theirs again in the register. Follow it under Approvals → Sent by me."
              : "Asked for. The lab holding it lets it go, then you confirm it arrived. Follow it under Approvals → Sent by me."}
        </div>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title={`${borrower ? "Return" : "Ask for"} ${label} ${borrower ? "to its owner" : "back"}`} onClose={onClose} width="480px" dirty={!!note.trim()}>
      <div className="flex flex-col gap-6">
        <label className="text-10.5 uppercase tracking-label text-faint font-semibold">Back to</label>
        {!target ? (
          <span className="text-11 text-faint">{error ? "" : "Loading…"}</span>
        ) : target.options.length === 0 ? (
          <span className="text-11 text-bad">The owning unit has no lab or store to return it into. Ask its head to add one.</span>
        ) : (
          <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} className="h-28 px-6 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent">
            <option value="">Choose a place…</option>
            {target.options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === target.suggested?.id ? " (where it came from)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <label className="text-10.5 uppercase tracking-label text-faint font-semibold">Why (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={borrower ? "e.g. the course ended" : "e.g. we need it for the lab exam"}
          className="px-8 py-6 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
        />
      </div>

      {placeId && (
        <div className="text-11 border border-border2 rounded-2 px-8 py-6">
          {previewError ? (
            <ErrorNote>{previewError}</ErrorNote>
          ) : !preview ? (
            <span className="text-faint">Checking…</span>
          ) : preview.outcome === "DENIED" ? (
            <span className="text-bad">{preview.reason}</span>
          ) : preview.outcome === "APPLIED" ? (
            <span className="text-dim">Applies immediately. No one else needs to agree.</span>
          ) : (
            <span className="text-dim">
              Needs: {preview.steps?.filter((s) => s.status !== "SKIPPED").map((s) => (s.approverName ? `${s.label} (${s.approverName})` : s.label)).join(" → ")}
            </span>
          )}
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-8">
        <Button variant="primary" onClick={submit} disabled={!placeId || !preview || preview.outcome === "DENIED" || busy}>
          {busy ? "Working…" : borrower ? "Return it" : "Ask for it back"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

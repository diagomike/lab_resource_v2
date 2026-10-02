"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChainStepDto, ChangeRequestDto, ContainerOptionDto, RequestTransferResultDto } from "@/lib/shared";
import { TreePicker, containerTreeOptions } from "@/components/TreePicker";
import { api, ApiError } from "@/lib/api";
import { Modal, Button, ErrorNote } from "@/components/ui";

type Preview = { outcome: "APPLIED" | "ROUTED" | "DENIED"; reason: string; movement: ChangeRequestDto["movement"]; steps?: ChainStepDto[] };

/**
 * Track 5 — transfers are PULLED. Someone who found what they need in the Register's
 * whole-university view asks for it into a place they already hold; the item's
 * custodian, its owning head, the requester's own head and finally the requester's
 * receipt decide it.
 *
 * Two kinds of pull (the requester chooses):
 *  - a LOAN: the owning unit and the custodian stay as they are;
 *  - a PERMANENT transfer: ownership and custody move to the requester's unit, and the
 *    College Managing Director approves it too (Property Administration as well when
 *    it leaves its college).
 * Anything pulled out of the Main Store is given, never lent — the server treats it as
 * a request from the store (Property Administration approves), whatever is chosen here.
 *
 * Destinations come from the same container picker Add/Move use — already filtered to
 * what the requester may write and to what these categories may legally sit inside —
 * intersected across every selected category. The server re-derives the receiving
 * unit from the destination, so none is sent from here.
 */
export function PullTransferModal({
  items,
  onClose,
  onDone,
}: {
  items: Array<{ id: string; name: string; categoryId: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [targets, setTargets] = useState<ContainerOptionDto[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState("");
  const [permanent, setPermanent] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RequestTransferResultDto | null>(null);

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const label = items.length === 1 ? `"${items[0].name}"` : `${items.length} resources`;

  useEffect(() => {
    const categoryIds = [...new Set(items.map((i) => i.categoryId))];
    const exclude = encodeURIComponent(itemIds.join(","));
    let cancelled = false;
    Promise.all(categoryIds.map((c) => api.get<ContainerOptionDto[]>(`/resources/items/containers?categoryId=${encodeURIComponent(c)}&exclude=${exclude}`)))
      .then((lists) => {
        if (cancelled) return;
        const [first = [], ...rest] = lists;
        const pathLabel = (o: ContainerOptionDto) => [...o.path, o.name].join(" / ");
        setTargets(first.filter((o) => rest.every((list) => list.some((x) => x.id === o.id))).sort((a, b) => a.path.length - b.path.length || pathLabel(a).localeCompare(pathLabel(b))));
      })
      .catch(() => !cancelled && setTargets([]));
    return () => {
      cancelled = true;
    };
  }, [items, itemIds]);

  function input(destinationId: string) {
    return {
      kind: "transferItem" as const,
      itemIds,
      note: note.trim() || undefined,
      transfer: { targetParentId: destinationId, targetOrgNodeId: "", targetCustodianId: null, ...(permanent ? { permanent: true } : {}) },
    };
  }

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!targetId) return;
    api
      .post<Preview>("/resources/transfers/preview", { input: input(targetId) })
      .then(setPreview)
      .catch((e) => setPreviewError(e instanceof ApiError ? e.message : "Could not resolve this request"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, permanent]);

  const fromStore = preview?.movement === "FROM_STORE";

  async function submit() {
    if (!targetId) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api.post<RequestTransferResultDto>("/resources/transfers", { input: input(targetId) }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not request this transfer");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Transfer requested" onClose={onDone} width="440px">
        <div className="text-11.5 text-dim">
          {done.outcome === "APPLIED"
            ? "Applied. It is already in your lab."
            : done.request.movement === "LOAN"
              ? "Requested. The holding unit decides first; you confirm receipt once it arrives. Track it under Approvals → Raised by me."
              : "Requested. The holding side and the offices on its chain decide first; you confirm receipt once it arrives, and it is then yours. Track it under Approvals → Raised by me."}
        </div>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title={`Request ${label} to my lab`} onClose={onClose} width="480px" dirty={!!note.trim() || permanent}>
      <div className="flex flex-col gap-6">
        <label className="text-10.5 uppercase tracking-label text-faint font-semibold">Into</label>
        {targets === null ? (
          <span className="text-11 text-faint">Loading your labs…</span>
        ) : targets.length === 0 ? (
          <span className="text-11 text-bad">You don't hold a lab or container these resources may be placed in.</span>
        ) : (
          <TreePicker options={containerTreeOptions(targets)} value={targetId} onChange={setTargetId} placeholder="Choose where it should go…" />
        )}
      </div>

      <div className="flex flex-col gap-6">
        <label className="text-10.5 uppercase tracking-label text-faint font-semibold">How</label>
        {fromStore ? (
          <span className="text-11 text-dim">From the Main Store. It becomes your unit's, with you as its custodian.</span>
        ) : (
          <div className="flex flex-col gap-4">
            {[
              { value: false, title: "Loan", help: "Borrow it. The owning unit and its custodian stay as they are." },
              { value: true, title: "Permanent transfer", help: "It becomes your unit's, with you as custodian. The College Managing Director approves too." },
            ].map((o) => (
              <label key={o.title} className="flex items-start gap-8 text-11 cursor-pointer">
                <input type="radio" name="pull-kind" checked={permanent === o.value} onChange={() => setPermanent(o.value)} className="mt-2" />
                <span>
                  <span className="font-medium">{o.title}</span>
                  <span className="block text-11 text-faint">{o.help}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <label className="text-10.5 uppercase tracking-label text-faint font-semibold">Why (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="e.g. needed for the fall practical sessions"
          className="px-8 py-6 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
        />
      </div>

      {targetId && (
        <div className="text-11 border border-border2 rounded-2 px-8 py-6">
          {previewError ? (
            <ErrorNote>{previewError}</ErrorNote>
          ) : !preview ? (
            <span className="text-faint">Checking…</span>
          ) : preview.outcome === "DENIED" ? (
            <span className="text-bad">{preview.reason}</span>
          ) : preview.outcome === "APPLIED" ? (
            <span className="text-dim">Applies immediately. No approval needed.</span>
          ) : (
            <span className="text-dim">
              Needs: {preview.steps?.filter((s) => s.status !== "SKIPPED").map((s) => (s.approverName ? `${s.label} (${s.approverName})` : s.label)).join(" → ")}
            </span>
          )}
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-8">
        <Button variant="primary" onClick={submit} disabled={!targetId || !preview || preview.outcome === "DENIED" || busy}>
          {busy ? "Working…" : "Request transfer"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

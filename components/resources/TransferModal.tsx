"use client";

import { useEffect, useState } from "react";
import type { ChainStepDto, RequestTransferResultDto, TransferDestinationDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Modal, Button, ErrorNote } from "@/components/ui";

type Preview = { outcome: "APPLIED" | "ROUTED" | "DENIED"; reason: string; steps?: ChainStepDto[] };

/**
 * Track 3 — request a cross-lab transfer. Deliberately keeps the current custodian
 * (`targetCustodianId: null`) rather than also offering a cross-department people
 * picker in this first pass — see
 * ~/.claude/plans/lets-merge-the-work-memoized-journal.md §6.6. Once a transfer
 * lands, the receiving custodian/head can reassign custody directly like any other
 * item in their own custody chain; nothing about that needs solving here.
 */
export function TransferModal({
  itemId,
  itemName,
  onClose,
  onDone,
}: {
  itemId: string;
  itemName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<TransferDestinationDto[]>([]);
  const [selected, setSelected] = useState<TransferDestinationDto | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RequestTransferResultDto | null>(null);

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<TransferDestinationDto[]>(`/resources/transfers/destinations?itemIds=${encodeURIComponent(itemId)}&q=${encodeURIComponent(query)}`)
        .then((rows) => !cancelled && setOptions(rows))
        .catch(() => !cancelled && setOptions([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected, itemId]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    setPreviewError(null);
    api
      .post<Preview>("/resources/transfers/preview", { input: transferInput(selected) })
      .then(setPreview)
      .catch((e) => setPreviewError(e instanceof ApiError ? e.message : "Could not resolve this transfer"));
  }, [selected]);

  function transferInput(destination: TransferDestinationDto) {
    return {
      kind: "transferItem" as const,
      itemIds: [itemId],
      transfer: { targetParentId: destination.id, targetOrgNodeId: destination.orgNodeId, targetCustodianId: null },
    };
  }

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<RequestTransferResultDto>("/resources/transfers", { input: transferInput(selected) });
      setDone(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not request this transfer");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Transfer" onClose={onDone} width="440px">
        <div className="text-11.5 text-dim">
          {done.outcome === "APPLIED"
            ? "Applied — the register is already updated."
            : "Requested. It now waits for approval — see Approvals."}
        </div>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title={`Transfer "${itemName}"`} onClose={onClose} width="460px">
      <div className="flex flex-col gap-8">
        <label className="text-9.5 uppercase tracking-label text-faint font-semibold">Destination</label>
        <input
          value={selected ? selected.name : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="Search another department's lab or store…"
          className="h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
        />
        {!selected && options.length > 0 && (
          <div className="border border-border2 rounded-2 max-h-[180px] overflow-y-auto">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setSelected(o);
                  setQuery("");
                }}
                className="w-full text-left px-8 py-6 text-11 hover:bg-panel2 border-b border-border last:border-0"
              >
                <div>{o.name}</div>
                <div className="text-9.5 text-faint">
                  {o.orgNodeName}
                  {o.path.length > 0 ? ` · ${o.path.join(" / ")}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
        {!selected && query.trim().length >= 2 && options.length === 0 && (
          <div className="text-10.5 text-faint">No matching destination found.</div>
        )}
      </div>

      {selected && (
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
              Needs approval: {preview.steps?.filter((s) => s.status !== "SKIPPED").map((s) => s.label).join(" → ")}
            </span>
          )}
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-8">
        <Button variant="primary" onClick={submit} disabled={!selected || preview?.outcome === "DENIED" || busy}>
          {busy ? "Working…" : "Request transfer"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

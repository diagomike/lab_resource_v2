"use client";

import { useEffect, useState } from "react";
import type { ChainStepDto, RequestTransferResultDto, TransferDestinationDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Modal, Button, ErrorNote } from "@/components/ui";

type Preview = { outcome: "APPLIED" | "ROUTED" | "DENIED"; reason: string; steps?: ChainStepDto[] };

/**
 * The main store handing stock over to a department — the one transfer that is still
 * PUSHED. Every other transfer is pulled from University resources
 * (`PullTransferModal`, Track 5 of
 * ~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md), so this modal
 * is offered to store keepers and SYS_ADMIN only.
 *
 * A handover names the destination's own custodian as the new custodian AND moves
 * ownership to the receiving unit. The seeded policy routes it through the receiving
 * head, then the receiving custodian's acceptance; approvals.ts refuses the ownership
 * move for anyone but a store keeper or SYS_ADMIN, whatever this modal offers.
 */
export function TransferModal({
  itemIds,
  label,
  onClose,
  onDone,
}: {
  itemIds: string[];
  /** What is being transferred, for the title — an item name, or "3 resources". */
  label: string;
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
  const idsParam = itemIds.join(",");

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<TransferDestinationDto[]>(`/resources/transfers/destinations?itemIds=${encodeURIComponent(idsParam)}&q=${encodeURIComponent(query)}`)
        .then((rows) => !cancelled && setOptions(rows))
        .catch(() => !cancelled && setOptions([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected, idsParam]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    setPreview(null);
    setPreviewError(null);
    api
      .post<Preview>("/resources/transfers/preview", { input: transferInput(selected) })
      .then(setPreview)
      .catch((e) => setPreviewError(e instanceof ApiError ? e.message : "Could not resolve this transfer"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function transferInput(destination: TransferDestinationDto) {
    return {
      kind: "transferItem" as const,
      itemIds,
      transfer: { targetParentId: destination.id, targetOrgNodeId: destination.orgNodeId, targetCustodianId: destination.custodianId, transferOwnership: true },
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
      <Modal title="Hand over" onClose={onDone} width="440px">
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
    <Modal title={`Hand over ${label}`} onClose={onClose} width="460px">
      <div className="flex flex-col gap-8">
        <label className="text-9.5 uppercase tracking-label text-faint font-semibold">Destination</label>
        <input
          value={selected ? selected.name : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="Search the lab to hand this over to…"
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
                  {o.custodianName ? ` · held by ${o.custodianName}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
        {!selected && query.trim().length >= 2 && options.length === 0 && (
          <div className="text-10.5 text-faint">No matching destination found.</div>
        )}
      </div>

      <div className="text-10.5 text-dim">
        Custody and ownership move{selected ? ` to ${selected.custodianName} and ${selected.orgNodeName}` : " to the receiving lab"} once its head approves and its
        custodian accepts.
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
        <Button variant="primary" onClick={submit} disabled={!selected || !preview || preview.outcome === "DENIED" || busy}>
          {busy ? "Working…" : "Request handover"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

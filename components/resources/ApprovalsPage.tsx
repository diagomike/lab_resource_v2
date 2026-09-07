"use client";

import { useEffect, useState } from "react";
import type { ItemChangeInput, LabCommitRequestDto } from "@/lib/shared";
import { CHANGE_LABEL } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote, Button, Tag, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";

function describeChange(payload: unknown, targetKind: string): string {
  if (targetKind === "IDEAL") {
    const p = payload as { categoryId: string; qty: number };
    return `Ideal target → ${p.qty}`;
  }
  const p = payload as ItemChangeInput;
  const label = CHANGE_LABEL[p.kind] ?? p.kind;
  if (p.kind === "setName") return `${label} → "${p.value}"`;
  if (p.kind === "setStatus") return `${label} → ${STATUS_LABEL[p.value as keyof typeof STATUS_LABEL] ?? p.value}`;
  if (p.kind === "setQuantity") return `${label} → ${p.value}`;
  return label;
}

const STATUS_TONE: Record<string, "warn" | "good" | "bad" | "neutral"> = {
  PENDING: "warn",
  APPLIED: "good",
  REJECTED: "bad",
  CANCELLED: "neutral",
  STALE: "bad",
};

function RequestCard({ request, onDecided, canAct }: { request: LabCommitRequestDto; onDecided: () => void; canAct: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"APPROVE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");

  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/lab-commits/${request.id}/decide`, { decision, note: note || undefined });
      setConfirming(null);
      setNote("");
      onDecided();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record this decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-3 p-12 flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-11.5 font-medium">{request.labName}</div>
          <div className="text-10.5 text-dim">
            {request.targetKind === "IDEAL" ? "Ideal target" : "Visible register"} · by {request.requesterName} ·{" "}
            {new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
        <Tag tone={STATUS_TONE[request.status] ?? "neutral"}>{request.status}</Tag>
      </div>

      <div className="flex flex-col gap-4">
        {request.changes.map((c) => (
          <div key={c.id} className="text-10.5 text-dim">
            {describeChange(c.payload, c.targetKind)}
          </div>
        ))}
      </div>

      {request.resolution && <div className="text-10.5 text-dim italic">"{request.resolution}"</div>}
      {error && <ErrorNote>{error}</ErrorNote>}

      {request.status === "PENDING" && canAct && (
        <div className="flex items-center gap-8 pt-4">
          <Button variant="primary" onClick={() => setConfirming("APPROVE")} disabled={busy}>
            Approve
          </Button>
          <Button variant="danger" onClick={() => setConfirming("REJECT")} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
      {request.status === "PENDING" && !canAct && (
        <div className="text-10.5 text-faint">Waiting on {request.labName}'s department head.</div>
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming === "APPROVE" ? "Approve this commit" : "Reject this commit"}
          tone={confirming === "APPROVE" ? "primary" : "danger"}
          confirmLabel={confirming === "APPROVE" ? "Approve" : "Reject"}
          busy={busy}
          error={null}
          message={
            <div className="flex flex-col gap-8">
              <span>
                {confirming === "APPROVE"
                  ? request.targetKind === "IDEAL"
                    ? "Applies these target quantities for the lab."
                    : "Applies every staged change to the live register, exactly as a direct edit would."
                  : "The custodian's draft stays intact — they can revise and resubmit."}
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note"
                className="h-24 px-8 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
              />
            </div>
          }
          onConfirm={() => decide(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<"inbox" | "mine">("inbox");
  const [rows, setRows] = useState<LabCommitRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setRows(null);
    setError(null);
    api
      .get<LabCommitRequestDto[]>(`/resources/lab-commits?box=${tab}`)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load requests"));
  }

  useEffect(load, [tab]);

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel
        title="Lab commits"
        actions={
          <div className="flex items-center gap-4">
            {(["inbox", "mine"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{ background: tab === t ? "var(--accent)" : "var(--panel2)", color: tab === t ? "#fff" : "var(--dim)" }}
                className="border-0 text-10.5 font-medium px-9 py-4 rounded-2"
              >
                {t === "inbox" ? "Routed to me" : "Raised by me"}
              </button>
            ))}
          </div>
        }
      >
        {rows === null ? (
          <PanelLoading rows={3} />
        ) : rows.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">
            {tab === "inbox" ? "Nothing waiting on your decision." : "You haven't submitted anything for approval."}
          </div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {rows.map((r) => (
              <RequestCard key={r.id} request={r} onDecided={load} canAct={tab === "inbox"} />
            ))}
          </div>
        )}
      </Panel>
    </Screen>
  );
}

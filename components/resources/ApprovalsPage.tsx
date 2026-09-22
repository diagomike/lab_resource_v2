"use client";

import { useEffect, useState } from "react";
import type { ChainStepDto, ChangeRequestDto, ClashDto, ItemChangeInput, LabCommitRequestDto, PurchaseRequestDto, ReservationDto, ResourceCategoryDto } from "@/lib/shared";
import { CHANGE_LABEL } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Panel, Screen, ErrorNote, Button, Tag, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { HistoryTimeline } from "./PurchasingPage";
import { LabCommitCard } from "./LabCommitCard";
import { ClashList } from "@/components/scheduling/SchedulePage";
import { STATE_LABEL } from "@/components/scheduling/WeekCalendar";

const STATUS_TONE: Record<string, "warn" | "good" | "bad" | "neutral"> = {
  PENDING: "warn",
  APPLIED: "good",
  REJECTED: "bad",
  CANCELLED: "neutral",
  STALE: "bad",
};

function TabBar({ tab, onChange }: { tab: "inbox" | "mine"; onChange: (t: "inbox" | "mine") => void }) {
  return (
    <div className="flex items-center gap-4">
      {(["inbox", "mine"] as const).map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{ background: tab === t ? "var(--accent)" : "var(--panel2)", color: tab === t ? "#fff" : "var(--dim)" }}
          className="border-0 text-10.5 font-medium px-9 py-4 rounded-2"
        >
          {t === "inbox" ? "Routed to me" : "Raised by me"}
        </button>
      ))}
    </div>
  );
}

// ── Lab commits (a Draft to merge, or an Ideal proposal — one decider: the lab's head) ────

function LabCommitsPanel() {
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
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel title="Lab commits" actions={<TabBar tab={tab} onChange={setTab} />}>
        {rows === null ? (
          <PanelLoading rows={3} />
        ) : rows.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">
            {tab === "inbox" ? "Nothing waiting on your decision." : "You haven't submitted anything for approval."}
          </div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {rows.map((r) => (
              <LabCommitCard key={r.id} request={r} onDecided={load} />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Track 3 — transfers (multi-step chain: owner head → target head → receipt) ────

const STEP_TONE: Record<ChainStepDto["status"], "warn" | "good" | "bad" | "neutral"> = {
  PENDING: "warn",
  WAITING: "neutral",
  APPROVED: "good",
  REJECTED: "bad",
  SKIPPED: "neutral",
};

function ChainTrail({ steps }: { steps: ChainStepDto[] }) {
  return (
    <div className="flex flex-wrap items-center gap-6">
      {steps.map((s, i) => (
        <span key={s.id} className="flex items-center gap-6">
          {i > 0 && <span className="text-faint">→</span>}
          <Tag tone={STEP_TONE[s.status]}>
            {s.label}
            {s.status === "PENDING" && !s.approverId ? " (vacant)" : s.approverName ? ` · ${s.approverName}` : ""}
          </Tag>
        </span>
      ))}
    </div>
  );
}

function TransferRequestCard({ request, viewerId, onDecided }: { request: ChangeRequestDto; viewerId: string; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"APPROVE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");

  const currentStep = request.steps.find((s) => s.status === "PENDING");
  const canDecide = request.status === "PENDING" && currentStep?.approverId === viewerId;
  const isReceipt = currentStep?.selector === "REQUESTER_RECEIPT";
  const isAcceptance = currentStep?.selector === "TARGET_CUSTODIAN";
  const approveLabel = isReceipt ? "Confirm receipt" : isAcceptance ? "Accept into my custody" : "Approve";

  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/transfers/${request.id}/decide`, { decision, note: note || undefined });
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
          <div className="text-11.5 font-medium">{request.summary}</div>
          <div className="text-10.5 text-dim">
            by {request.requesterName} · {new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
        <Tag tone={STATUS_TONE[request.status] ?? "neutral"}>{request.status}</Tag>
      </div>

      <ChainTrail steps={request.steps} />

      {request.resolution && <div className="text-10.5 text-dim italic">"{request.resolution}"</div>}
      {error && <ErrorNote>{error}</ErrorNote>}

      {canDecide && (
        <div className="flex items-center gap-8 pt-4">
          <Button variant="primary" onClick={() => setConfirming("APPROVE")} disabled={busy}>
            {approveLabel}
          </Button>
          <Button variant="danger" onClick={() => setConfirming("REJECT")} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
      {request.status === "PENDING" && !canDecide && currentStep && (
        <div className="text-10.5 text-faint">
          {currentStep.approverId ? `Waiting on ${currentStep.approverName ?? currentStep.label}.` : `Waiting — ${currentStep.label} is currently vacant.`}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming === "APPROVE" ? (isReceipt || isAcceptance ? approveLabel : "Approve this step") : "Reject this request"}
          tone={confirming === "APPROVE" ? "primary" : "danger"}
          confirmLabel={confirming === "APPROVE" ? approveLabel : "Reject"}
          busy={busy}
          error={null}
          message={
            <div className="flex flex-col gap-8">
              <span>
                {confirming === "APPROVE"
                  ? isReceipt
                    ? "Confirms the resource has physically arrived — this is what applies the transfer to the register."
                    : isAcceptance
                      ? "Confirms it has arrived and you now answer for it — this is what applies the handover to the register."
                      : "Advances this request to its next step."
                  : "Ends this request outright — the requester can raise a new one if circumstances change."}
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

function TransfersPanel({ viewerId }: { viewerId: string }) {
  const [tab, setTab] = useState<"inbox" | "mine">("inbox");
  const [rows, setRows] = useState<ChangeRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setRows(null);
    setError(null);
    api
      .get<ChangeRequestDto[]>(`/resources/transfers?box=${tab}`)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load requests"));
  }

  useEffect(load, [tab]);

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel title="Transfers" actions={<TabBar tab={tab} onChange={setTab} />}>
        {rows === null ? (
          <PanelLoading rows={3} />
        ) : rows.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">
            {tab === "inbox" ? "Nothing waiting on your decision." : "You haven't requested any transfers."}
          </div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {rows.map((r) => (
              <TransferRequestCard key={r.id} request={r} viewerId={viewerId} onDecided={load} />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Track 6 — lab bookings (one decider: the room's custodian) ─────────────────

function BookingCard({ booking, onDecided }: { booking: ReservationDto; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<ClashDto[]>([]);
  const [note, setNote] = useState("");

  async function act(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    setClashes([]);
    try {
      await api.post(path, body);
      setNote("");
      onDecided();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update this booking");
      setClashes(((e instanceof ApiError ? e.body : undefined) as { clashes?: ClashDto[] } | undefined)?.clashes ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-3 p-12 flex flex-col gap-8">
      <div className="flex items-center justify-between gap-8">
        <div>
          <div className="text-11.5 font-medium">{booking.title}</div>
          <div className="text-10.5 text-dim">
            <span className="font-mono">
              {booking.date} {booking.start}–{booking.end}
            </span>{" "}
            · {booking.labName} · {booking.resources.map((r) => r.name).join(", ")}
            {booking.requestedByName ? ` · by ${booking.requestedByName}` : ""}
          </div>
          {booking.onBehalfOfNote && <div className="text-10.5 text-dim">On behalf of: {booking.onBehalfOfNote}</div>}
        </div>
        <Tag tone={booking.state === "CONFIRMED" ? "good" : booking.state === "REQUESTED" ? "warn" : booking.state === "DECLINED" ? "bad" : "neutral"}>{STATE_LABEL[booking.state]}</Tag>
      </div>
      {booking.note && <div className="text-10.5 text-dim italic">"{booking.note}"</div>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <ClashList clashes={clashes} heading="In the way" />
      {(booking.canDecide || booking.canCancel) && (
        <div className="flex flex-wrap items-center gap-8 pt-4">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className="h-24 px-8 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent" />
          {booking.canDecide && (
            <>
              <Button variant="primary" disabled={busy} onClick={() => act(`/scheduling/bookings/${booking.id}/decide`, { decision: "APPROVE", note: note || undefined })}>
                Approve
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => act(`/scheduling/bookings/${booking.id}/decide`, { decision: "DECLINE", note: note || undefined })}>
                Decline
              </Button>
            </>
          )}
          {!booking.canDecide && booking.canCancel && (
            <Button variant="danger" disabled={busy} onClick={() => act(`/scheduling/bookings/${booking.id}/cancel`, { note: note || undefined })}>
              Cancel booking
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function BookingsPanel() {
  const [tab, setTab] = useState<"inbox" | "mine">("inbox");
  const [rows, setRows] = useState<ReservationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setRows(null);
    setError(null);
    api
      .get<ReservationDto[]>(`/scheduling/bookings?box=${tab}`)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load bookings"));
  }

  useEffect(load, [tab]);

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel title="Lab bookings" actions={<TabBar tab={tab} onChange={setTab} />}>
        {rows === null ? (
          <PanelLoading rows={2} />
        ) : rows.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">{tab === "inbox" ? "Nothing waiting on your decision." : "You haven't booked anything."}</div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {rows.map((r) => (
              <BookingCard key={r.id} booking={r} onDecided={load} />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Track 4 — purchase requests (the org chart as the ladder: head → every ancestor
// up to the university root → Procurement). Decide gains a third option, REVISE,
// that transfers/lab-commits don't have — sends it back to the raiser to edit and
// resubmit rather than only approve/reject. ──────────────────────────────────────

function PurchaseRequestCard({ request, viewerId, onDecided }: { request: PurchaseRequestDto; viewerId: string; onDecided: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"APPROVE" | "REJECT" | "REVISE" | null>(null);
  const [note, setNote] = useState("");

  const currentStep = request.steps.find((s) => s.status === "PENDING");
  const canDecide = request.stage === "APPROVING" && currentStep?.approverId === viewerId;

  async function decide(decision: "APPROVE" | "REJECT" | "REVISE") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/decide`, { decision, note: note || undefined });
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
          <div className="text-11.5 font-medium">
            {request.reference} · {request.title}
          </div>
          <div className="text-10.5 text-dim">
            {request.orgNodeName} · by {request.raisedByName} · {new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
        <Tag tone={request.stage === "REJECTED" ? "bad" : request.stage === "REVISING" ? "warn" : request.stage === "APPROVING" ? "warn" : "good"}>{request.stage}</Tag>
      </div>

      <ChainTrail steps={request.steps} />

      <div className="flex flex-col gap-3">
        {request.lines.map((l) => (
          <div key={l.id} className="text-10.5 text-dim">
            {l.name} · {l.qty}
            {l.unit ? ` ${l.unit}` : ""}
            {l.estimatedUnitCost !== null ? ` · ~${l.estimatedUnitCost}/unit` : ""}
            {l.justification ? <span className="text-faint"> — {l.justification}</span> : null}
          </div>
        ))}
      </div>

      {request.feedback && <div className="text-10.5 text-dim italic">"{request.feedback}"</div>}
      <HistoryTimeline history={request.history} />
      {error && <ErrorNote>{error}</ErrorNote>}

      {canDecide && (
        <div className="flex items-center gap-8 pt-4">
          <Button variant="primary" onClick={() => setConfirming("APPROVE")} disabled={busy}>
            Approve
          </Button>
          <Button variant="danger" onClick={() => setConfirming("REJECT")} disabled={busy}>
            Reject
          </Button>
          <Button onClick={() => setConfirming("REVISE")} disabled={busy}>
            Send back for revision
          </Button>
        </div>
      )}
      {request.stage === "APPROVING" && !canDecide && currentStep && (
        <div className="text-10.5 text-faint">
          {currentStep.approverId ? `Waiting on ${currentStep.approverName ?? currentStep.label}.` : `Waiting — ${currentStep.label} is currently vacant.`}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming === "APPROVE" ? "Approve this step" : confirming === "REJECT" ? "Reject this request" : "Send back for revision"}
          tone={confirming === "REJECT" ? "danger" : "primary"}
          confirmLabel={confirming === "APPROVE" ? "Approve" : confirming === "REJECT" ? "Reject" : "Send back"}
          busy={busy}
          error={null}
          message={
            <div className="flex flex-col gap-8">
              <span>
                {confirming === "APPROVE"
                  ? "Advances this request to its next step."
                  : confirming === "REJECT"
                    ? "Ends this request outright — the requester can raise a new one if circumstances change."
                    : "Sends this back to the requester to edit and resubmit — the approval chain restarts once they do."}
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

function PurchasingPanel({ viewerId }: { viewerId: string }) {
  const [tab, setTab] = useState<"inbox" | "mine">("inbox");
  const [rows, setRows] = useState<PurchaseRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setRows(null);
    setError(null);
    api
      .get<PurchaseRequestDto[]>(`/resources/purchase-requests?box=${tab}`)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load requests"));
  }

  useEffect(load, [tab]);

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel title="Purchasing" actions={<TabBar tab={tab} onChange={setTab} />}>
        {rows === null ? (
          <PanelLoading rows={3} />
        ) : rows.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">
            {tab === "inbox" ? "Nothing waiting on your decision." : "You haven't compiled any purchase requests."}
          </div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {rows.map((r) => (
              <PurchaseRequestCard key={r.id} request={r} viewerId={viewerId} onDecided={load} />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <Screen>
      <TransfersPanel viewerId={user.id} />
      <LabCommitsPanel />
      <PurchasingPanel viewerId={user.id} />
      {user.roles.some((r) => r === "SYS_ADMIN" || r === "MANAGER" || r === "CUSTODIAN" || r === "STAFF") && <BookingsPanel />}
    </Screen>
  );
}

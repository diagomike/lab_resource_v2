"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  ChainStepDto,
  ChangeRequestDto,
  ClashDto,
  LabCommitRequestDto,
  PurchaseAttachmentDto,
  PurchaseRequestDto,
  ReservationDto,
  CategoryChangeDto,
  CategoryChangesDto,
} from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useHomeCounts } from "@/lib/home-counts";
import { parseFocus, type ApprovalKind } from "@/lib/paths";
import { Panel, Screen, ErrorNote, Button, Tag, ConfirmDialog, Tabs } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { HistoryTimeline } from "./PurchasingPage";
import { AttachmentPicker, RequestDocuments, discardAttachments } from "./PurchaseAttachments";
import { STAGE_LABEL } from "@/lib/domain/purchasing";
import { LabCommitCard } from "./LabCommitCard";
import { CategoryChangeCard } from "./CategoryChangeCard";
import { ClashList } from "@/components/scheduling/SchedulePage";
import { STATE_LABEL } from "@/components/scheduling/WeekCalendar";
import { useToast } from "@/components/toast";

const STATUS_TONE: Record<string, "warn" | "good" | "bad" | "neutral"> = {
  PENDING: "warn",
  APPLIED: "good",
  REJECTED: "bad",
  CANCELLED: "neutral",
  STALE: "bad",
};

const STATUS_TEXT: Record<string, string> = {
  PENDING: "Waiting",
  APPLIED: "Done",
  REJECTED: "Rejected",
  CANCELLED: "Withdrawn",
  STALE: "Couldn't be applied",
};

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
  const toast = useToast();
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
      toast.success(decision === "REJECT" ? `Rejected: ${request.summary}` : isReceipt || isAcceptance ? `Received: ${request.summary}` : `Approved: ${request.summary}`);
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
          <div className="text-11 text-dim">
            by {request.requesterName} · {new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
        <Tag tone={STATUS_TONE[request.status] ?? "neutral"}>{STATUS_TEXT[request.status] ?? request.status}</Tag>
      </div>

      <ChainTrail steps={request.steps} />

      {request.resolution && <div className="text-11 text-dim italic">"{request.resolution}"</div>}
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
        <div className="text-11 text-faint">
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
                      ? "Confirms it has arrived and you now answer for it — this is what applies it to the register."
                      : "Advances this request to its next step."
                  : "Ends this request outright — the requester can raise a new one if circumstances change."}
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note"
                className="h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
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

// ── Track 6 — lab bookings (one decider: the room's custodian) ─────────────────

function BookingCard({ booking, onDecided }: { booking: ReservationDto; onDecided: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<ClashDto[]>([]);
  const [note, setNote] = useState("");

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    setClashes([]);
    try {
      await api.post(path, body);
      setNote("");
      toast.success(done);
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
          <div className="text-11 text-dim">
            <span className="font-mono">
              {booking.date} {booking.start}–{booking.end}
            </span>{" "}
            · <Link href={`/places/${booking.labItemId}`} className="text-dim hover:text-accent">{booking.labName}</Link>
            {booking.resources.some((r) => r.name !== booking.labName) ? ` · ${booking.resources.map((r) => r.name).join(", ")}` : " · whole room"}
            {booking.requestedByName ? ` · by ${booking.requestedByName}` : ""}
          </div>
          {booking.onBehalfOfNote && <div className="text-11 text-dim">On behalf of: {booking.onBehalfOfNote}</div>}
        </div>
        <Tag tone={booking.state === "CONFIRMED" ? "good" : booking.state === "REQUESTED" ? "warn" : booking.state === "DECLINED" ? "bad" : "neutral"}>{STATE_LABEL[booking.state]}</Tag>
      </div>
      {booking.note && <div className="text-11 text-dim italic">"{booking.note}"</div>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <ClashList clashes={clashes} heading="In the way" />
      {(booking.canDecide || booking.canCancel) && (
        <div className="flex flex-wrap items-center gap-8 pt-4">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className="h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent" />
          {booking.canDecide && (
            <>
              <Button variant="primary" disabled={busy} onClick={() => act(`/scheduling/bookings/${booking.id}/decide`, { decision: "APPROVE", note: note || undefined }, `Booking confirmed: ${booking.labName}, ${booking.date}`)}>
                Approve
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => act(`/scheduling/bookings/${booking.id}/decide`, { decision: "DECLINE", note: note || undefined }, `Booking declined: ${booking.labName}, ${booking.date}`)}>
                Decline
              </Button>
            </>
          )}
          {!booking.canDecide && booking.canCancel && (
            <Button variant="danger" disabled={busy} onClick={() => act(`/scheduling/bookings/${booking.id}/cancel`, { note: note || undefined }, `Booking cancelled: ${booking.labName}, ${booking.date}`)}>
              Cancel booking
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Track 4 — purchase requests (the org chart as the ladder: head → every ancestor
// up to the university root → Procurement). Decide gains a third option, REVISE,
// that transfers/lab-commits don't have — sends it back to the raiser to edit and
// resubmit rather than only approve/reject. ──────────────────────────────────────

function PurchaseRequestCard({ request, viewerId, onDecided }: { request: PurchaseRequestDto; viewerId: string; onDecided: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"APPROVE" | "REJECT" | "REVISE" | null>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<PurchaseAttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);

  const currentStep = request.steps.find((s) => s.status === "PENDING");
  const canDecide = request.stage === "APPROVING" && currentStep?.approverId === viewerId;

  async function decide(decision: "APPROVE" | "REJECT" | "REVISE") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/decide`, { decision, note: note || undefined, attachmentIds: files.map((f) => f.id) });
      setConfirming(null);
      setNote("");
      setFiles([]);
      toast.success(decision === "APPROVE" ? `Approved ${request.reference}` : decision === "REJECT" ? `Rejected ${request.reference}` : `${request.reference} sent back for revision`);
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
          <div className="text-11 text-dim">
            {request.orgNodeName} · by {request.raisedByName} · {new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
        <Tag tone={request.stage === "REJECTED" ? "bad" : request.stage === "REVISING" ? "warn" : request.stage === "APPROVING" ? "warn" : "good"}>{STAGE_LABEL[request.stage] ?? request.stage}</Tag>
      </div>

      <ChainTrail steps={request.steps} />

      <div className="flex flex-col gap-3">
        {request.lines.map((l) => (
          <div key={l.id} className="text-11 text-dim">
            {l.name} · {l.qty}
            {l.unit ? ` ${l.unit}` : ""}
            {l.estimatedUnitCost !== null ? ` · ~${l.estimatedUnitCost}/unit` : ""}
            {l.justification ? <Justification text={l.justification} /> : null}
          </div>
        ))}
      </div>

      {request.feedback && <div className="text-11 text-dim italic">"{request.feedback}"</div>}
      <RequestDocuments history={request.history} />
      <HistoryTimeline history={request.history} />
      {error && !confirming && <ErrorNote>{error}</ErrorNote>}

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
        <div className="text-11 text-faint">
          {currentStep.approverId ? `Waiting on ${currentStep.approverName ?? currentStep.label}.` : `Waiting — ${currentStep.label} is currently vacant.`}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming === "APPROVE" ? "Approve this step" : confirming === "REJECT" ? "Reject this request" : "Send back for revision"}
          tone={confirming === "REJECT" ? "danger" : "primary"}
          confirmLabel={confirming === "APPROVE" ? "Approve" : confirming === "REJECT" ? "Reject" : "Send back"}
          busy={busy || uploading}
          error={error}
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
                className="h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
              />
              <AttachmentPicker
                value={files}
                onChange={setFiles}
                onBusyChange={setUploading}
                disabled={busy}
                label={confirming === "APPROVE" ? "Attach minutes or a letter" : "Attach the letter you're citing"}
                hint="Optional — kept with your decision on the request"
              />
            </div>
          }
          onConfirm={() => decide(confirming)}
          onCancel={() => {
            discardAttachments(files);
            setConfirming(null);
            setFiles([]);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

// ── One inbox ────────────────────────────────────────────────────────────────────
//
// Everything waiting for this person's decision in one list, oldest first, with chips
// to narrow it to one kind; and a second tab for what they sent. Links from email, the
// bell and Home say which item to open: `?focus=transfer:<id>` scrolls to it and marks
// it; `?box=mine` opens "Sent by me"; `?kind=` picks the chip.

type Box = "inbox" | "mine";

type Entry =
  | { kind: "transfer"; id: string; at: string; row: ChangeRequestDto }
  | { kind: "lab-commit"; id: string; at: string; row: LabCommitRequestDto }
  | { kind: "purchase"; id: string; at: string; row: PurchaseRequestDto }
  | { kind: "booking"; id: string; at: string; row: ReservationDto }
  | { kind: "category-change"; id: string; at: string; row: CategoryChangeDto };

const KIND_LABEL: Record<ApprovalKind, string> = {
  transfer: "Transfers",
  "lab-commit": "Lab changes",
  purchase: "Purchases",
  booking: "Bookings",
  "category-change": "Category changes",
};
const KINDS = Object.keys(KIND_LABEL) as ApprovalKind[];

const EMPTY: Record<Box, string> = {
  inbox: "Nothing is waiting for your decision.",
  mine: "Nothing you sent is in the last while. Transfers, lab changes, purchase requests, bookings and category changes you send show here.",
};

/** Loads one box from every source. A source that refuses this person (they don't
 *  book, say) is simply empty; one that fails is named so it can be retried. */
async function loadBox(box: Box, mayBook: boolean): Promise<{ entries: Entry[]; failed: string[] }> {
  const failed: string[] = [];
  const get = async <T,>(label: string, path: string, fallback: T): Promise<T> => {
    try {
      return await api.get<T>(path);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 403)) failed.push(label);
      return fallback;
    }
  };
  const [transfers, commits, purchases, bookings, changes] = await Promise.all([
    get<ChangeRequestDto[]>("transfers", `/resources/transfers?box=${box}`, []),
    get<LabCommitRequestDto[]>("lab changes", `/resources/lab-commits?box=${box}`, []),
    get<PurchaseRequestDto[]>("purchase requests", `/resources/purchase-requests?box=${box}`, []),
    mayBook ? get<ReservationDto[]>("bookings", `/scheduling/bookings?box=${box}`, []) : Promise.resolve([]),
    get<CategoryChangesDto>("category changes", "/resources/category-changes", { waiting: [], mine: [] }),
  ]);
  const entries: Entry[] = [
    ...transfers.map((row) => ({ kind: "transfer" as const, id: row.id, at: row.createdAt, row })),
    ...commits.map((row) => ({ kind: "lab-commit" as const, id: row.id, at: row.createdAt, row })),
    ...purchases.map((row) => ({ kind: "purchase" as const, id: row.id, at: row.createdAt, row })),
    ...bookings.map((row) => ({ kind: "booking" as const, id: row.id, at: row.startsAt, row })),
    ...(box === "inbox" ? changes.waiting : changes.mine).map((row) => ({ kind: "category-change" as const, id: row.id, at: row.createdAt, row })),
  ];
  // Waiting: oldest first (it has waited longest). Sent: newest first.
  entries.sort((a, b) => (box === "inbox" ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at)));
  return { entries, failed };
}

function EntryCard({ entry, viewerId, onChanged }: { entry: Entry; viewerId: string; onChanged: () => void }) {
  switch (entry.kind) {
    case "transfer":
      return <TransferRequestCard request={entry.row} viewerId={viewerId} onDecided={onChanged} />;
    case "lab-commit":
      return <LabCommitCard request={entry.row} onDecided={onChanged} />;
    case "purchase":
      return <PurchaseRequestCard request={entry.row} viewerId={viewerId} onDecided={onChanged} />;
    case "booking":
      return <BookingCard booking={entry.row} onDecided={onChanged} />;
    case "category-change":
      return <CategoryChangeCard change={entry.row} onChanged={onChanged} />;
  }
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`border rounded-full h-24 px-10 text-11 flex items-center gap-5 whitespace-nowrap ${on ? "border-accent bg-soft text-accent font-medium" : "border-border2 bg-panel text-dim hover:text-text"}`}
    >
      {children}
    </button>
  );
}

function Inbox() {
  const { user } = useAuth();
  const { refresh: refreshCounts } = useHomeCounts();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const focus = useMemo(() => parseFocus(params.get("focus")), [params]);
  const box: Box = params.get("box") === "mine" ? "mine" : "inbox";
  const kindParam = params.get("kind") as ApprovalKind | null;
  const kind: ApprovalKind | null = kindParam && KINDS.includes(kindParam) ? kindParam : null;
  const mayBook = !!user?.roles.some((r) => r === "SYS_ADMIN" || r === "MANAGER" || r === "CUSTODIAN");

  const [data, setData] = useState<{ box: Box; entries: Entry[]; failed: string[] } | null>(null);
  const [waitingCount, setWaitingCount] = useState<number | null>(null);
  const scrolledTo = useRef<string | null>(null);

  /** Changes the query (box, kind, focus) without a new history entry or a jump. */
  const setQuery = useCallback(
    (next: { box?: Box; kind?: ApprovalKind | null; focus?: string | null }) => {
      const q = new URLSearchParams(params.toString());
      const put = (key: string, value: string | null | undefined) => (value ? q.set(key, value) : q.delete(key));
      if ("box" in next) put("box", next.box === "mine" ? "mine" : null);
      if ("kind" in next) put("kind", next.kind ?? null);
      if ("focus" in next) put("focus", next.focus ?? null);
      const qs = q.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const load = useCallback(() => {
    loadBox(box, mayBook).then((r) => {
      setData({ box, ...r });
      if (box === "inbox") setWaitingCount(r.entries.length);
    });
  }, [box, mayBook]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  // The waiting count for the tab, even while "Sent by me" is open.
  useEffect(() => {
    if (box === "mine" && waitingCount === null) loadBox("inbox", mayBook).then((r) => setWaitingCount(r.entries.length));
  }, [box, mayBook, waitingCount]);

  const onChanged = useCallback(() => {
    load();
    refreshCounts();
  }, [load, refreshCounts]);

  const entries = data?.box === box ? data.entries : null;
  const focused = entries && focus ? entries.find((e) => e.kind === focus.kind && e.id === focus.id) ?? null : null;

  // A link to something already decided, or sent by this person: look in the other box.
  useEffect(() => {
    if (!entries || !focus || focused || box === "mine") return;
    loadBox("mine", mayBook).then((r) => {
      if (r.entries.some((e) => e.kind === focus.kind && e.id === focus.id)) setQuery({ box: "mine" });
    });
  }, [entries, focus, focused, box, mayBook, setQuery]);

  // Scroll the linked item into view once, after it renders.
  useEffect(() => {
    if (!focused) return;
    const key = `${focused.kind}:${focused.id}`;
    if (scrolledTo.current === key) return;
    scrolledTo.current = key;
    requestAnimationFrame(() => document.getElementById(`approval-${focused.kind}-${focused.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [focused]);

  if (!user) return null;

  const counts = new Map<ApprovalKind, number>();
  for (const e of entries ?? []) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const shown = (entries ?? []).filter((e) => !kind || e.kind === kind || (focused && e === focused));
  const missingFocus = entries && focus && !focused;

  return (
    <Screen>
      <Tabs<Box>
        label="Approvals"
        value={box}
        onChange={(b) => setQuery({ box: b, kind: null, focus: null })}
        tabs={[
          { key: "inbox", label: "Waiting for me", count: waitingCount ?? undefined },
          { key: "mine", label: "Sent by me" },
        ]}
      />

      {entries && entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-6" role="group" aria-label="Show only">
          <Chip on={!kind} onClick={() => setQuery({ kind: null })}>
            All <span className="font-mono">{entries.length}</span>
          </Chip>
          {KINDS.filter((k) => counts.get(k)).map((k) => (
            <Chip key={k} on={kind === k} onClick={() => setQuery({ kind: k })}>
              {KIND_LABEL[k]} <span className="font-mono">{counts.get(k)}</span>
            </Chip>
          ))}
        </div>
      )}

      {data?.failed.length ? (
        <ErrorNote>
          Couldn&apos;t load {data.failed.join(", ")}.{" "}
          <button type="button" onClick={load} className="border-0 bg-transparent p-0 text-bad underline cursor-pointer text-11">
            Try again
          </button>
        </ErrorNote>
      ) : null}

      {missingFocus && (
        <div className="flex gap-10 border border-border2 bg-panel2 rounded-3 px-12 py-9 text-11.5 text-dim">
          <span className="w-3 bg-warn rounded-2 flex-none" />
          <span className="flex-1">The item you followed isn&apos;t waiting for you any more — it was decided, withdrawn, or moved on to someone else.</span>
          <button type="button" onClick={() => setQuery({ focus: null })} className="border-0 bg-transparent text-accent cursor-pointer text-11.5 p-0">
            Dismiss
          </button>
        </div>
      )}

      <Panel>
        {entries === null ? (
          <PanelLoading rows={4} />
        ) : shown.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim leading-loose">{kind ? `No ${KIND_LABEL[kind].toLowerCase()} here.` : EMPTY[box]}</div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {shown.map((e) => {
              const on = e === focused;
              return (
                <div
                  key={`${e.kind}-${e.id}`}
                  id={`approval-${e.kind}-${e.id}`}
                  className={`flex flex-col gap-4 rounded-4 ${on ? "border-2 border-accent bg-soft p-4" : ""}`}
                  aria-current={on ? "true" : undefined}
                >
                  <div className="flex items-center gap-6 text-11 uppercase tracking-label font-semibold text-faint px-2">
                    {KIND_LABEL[e.kind]}
                    {on && <span className="text-accent normal-case tracking-normal">· the one you followed</span>}
                  </div>
                  <EntryCard entry={e} viewerId={user.id} onChanged={onChanged} />
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </Screen>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<Screen><Panel><PanelLoading rows={4} /></Panel></Screen>}>
      <Inbox />
    </Suspense>
  );
}

/** A request line's justification. Short ones read inline; long ones (a line compiled
 *  from thirty labs' ideals) show their first sentence-worth and open on demand, so an
 *  approver can scan the lines without wading through every lab's breakdown. */
function Justification({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const LIMIT = 140;
  if (text.length <= LIMIT) return <span className="text-faint"> — {text}</span>;
  return (
    <span className="text-faint">
      {" "}
      — {open ? text : `${text.slice(0, LIMIT).trimEnd()}…`}{" "}
      <button type="button" className="text-accent hover:underline" onClick={() => setOpen(!open)}>
        {open ? "less" : "more"}
      </button>
    </span>
  );
}

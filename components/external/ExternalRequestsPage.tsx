"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClashDto, ExternalAssignmentDto, ExternalRequestDto, ExternalRequestSummaryDto } from "@/lib/shared";
import { addDays, instantToCivil } from "@/lib/domain/civil-time";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote, Button, Tag, Modal } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { ClashList } from "@/components/scheduling/SchedulePage";
import { STATE_LABEL } from "@/components/scheduling/WeekCalendar";
import { EXTERNAL_STATUS_LABEL, externalStatusTone, formatEtb, parseEtb } from "./labels";

/**
 * Track 7 — the staff side of an outside institution's request
 * (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md).
 *
 * One screen for three roles, each seeing only its own buttons (the server decides):
 *  - the AVP's office forwards to departments, sends the quote, or declines;
 *  - a custodian of an assigned department holds slots on their room's calendar;
 *  - a department head accepts with a pricing sheet link and amount, or declines.
 */

const inputClass = "h-26 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent";
const labelClass = "text-9.5 uppercase tracking-label text-faint font-semibold";

function message(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

function clashesOf(e: unknown): ClashDto[] {
  return ((e instanceof ApiError ? e.body : undefined) as { clashes?: ClashDto[] } | undefined)?.clashes ?? [];
}

function useAction(onDone: (next: ExternalRequestDto) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<ClashDto[]>([]);
  async function run(path: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    setClashes([]);
    try {
      onDone(await api.post<ExternalRequestDto>(path, body));
      return true;
    } catch (e) {
      setError(message(e, "That did not work"));
      setClashes(clashesOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, clashes, run };
}

// ── AVP: forward ─────────────────────────────────────────────────────────────

function ForwardModal({ request, onClose, onDone }: { request: ExternalRequestDto; onClose: () => void; onDone: (r: ExternalRequestDto) => void }) {
  const already = new Set(request.assignments.map((a) => a.orgNodeId));
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    onDone(r);
    onClose();
  });
  return (
    <Modal title={`Forward ${request.reference}`} onClose={onClose} width="480px">
      <div className="flex flex-col gap-4 max-h-[260px] overflow-y-auto">
        {request.departments.map((d) => (
          <label key={d.id} className={`flex items-center gap-6 text-11 ${already.has(d.id) ? "opacity-50" : ""}`}>
            <input type="checkbox" disabled={already.has(d.id)} checked={already.has(d.id) || chosen.includes(d.id)} onChange={() => setChosen(chosen.includes(d.id) ? chosen.filter((x) => x !== d.id) : [...chosen, d.id])} />
            {d.name}
            <span className="text-faint">{d.headName ? `· ${d.headName}` : "· no head"}</span>
            {already.has(d.id) && <span className="text-faint">(already sent)</span>}
          </label>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the heads (optional)" className={inputClass} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex gap-8">
        <Button variant="primary" disabled={action.busy || !chosen.length} onClick={() => action.run(`/external-requests/${request.id}/forward`, { orgNodeIds: chosen, note: note || undefined })}>
          Forward
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ── AVP: quote / decline ─────────────────────────────────────────────────────

function QuoteModal({ request, onClose, onDone }: { request: ExternalRequestDto; onClose: () => void; onDone: (r: ExternalRequestDto) => void }) {
  const sum = request.assignments.filter((a) => a.status === "ACCEPTED").reduce((s, a) => s + (a.amountSantim ?? 0), 0);
  const [amount, setAmount] = useState((sum / 100).toFixed(2));
  const [deadline, setDeadline] = useState(addDays(instantToCivil(new Date()).date, 7));
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    onDone(r);
    onClose();
  });
  const santim = parseEtb(amount);
  return (
    <Modal title={`Send quote — ${request.reference}`} onClose={onClose} width="460px">
      <div className="text-11 text-dim">Accepted departments total {formatEtb(sum)}. The requester receives this amount, every accepted pricing sheet link and the payment account; holds last until the deadline.</div>
      <div className="flex flex-wrap gap-8">
        <label className="flex flex-col gap-4">
          <span className={labelClass}>Amount (ETB)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-4">
          <span className={labelClass}>Pay by</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
        </label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the requester (optional)" className={inputClass} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex gap-8">
        <Button variant="primary" disabled={action.busy || santim === null} onClick={() => action.run(`/external-requests/${request.id}/quote`, { amountSantim: santim, paymentDeadline: deadline, note: note || undefined })}>
          Send quote
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

function DeclineModal({ request, onClose, onDone }: { request: ExternalRequestDto; onClose: () => void; onDone: (r: ExternalRequestDto) => void }) {
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    onDone(r);
    onClose();
  });
  return (
    <Modal title={`Decline ${request.reference}`} onClose={onClose} width="440px">
      <div className="text-11 text-dim">Every held slot is released and the requester is emailed this reason.</div>
      <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" className="px-8 py-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent" />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex gap-8">
        <Button variant="danger" disabled={action.busy || note.trim().length < 3} onClick={() => action.run(`/external-requests/${request.id}/decline`, { note })}>
          Decline request
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ── Custodian: hold a slot ───────────────────────────────────────────────────

function HoldModal({ request, onClose, onDone }: { request: ExternalRequestDto; onClose: () => void; onDone: (r: ExternalRequestDto) => void }) {
  const [roomId, setRoomId] = useState(request.holdRooms[0]?.id ?? "");
  const room = request.holdRooms.find((r) => r.id === roomId);
  const [machines, setMachines] = useState<string[]>([]);
  const [windowIndex, setWindowIndex] = useState(0);
  const w = request.windows[windowIndex];
  const [date, setDate] = useState(w?.date ?? "");
  const [start, setStart] = useState(w?.start ?? "09:00");
  const [end, setEnd] = useState(w?.end ?? "17:00");
  const action = useAction((r) => {
    onDone(r);
    onClose();
  });

  useEffect(() => {
    const next = request.windows[windowIndex];
    if (!next) return;
    setDate(next.date);
    setStart(next.start);
    setEnd(next.end);
  }, [windowIndex, request.windows]);

  const itemIds = machines.length ? machines : roomId ? [roomId] : [];
  return (
    <Modal title={`Hold a slot — ${request.reference}`} onClose={onClose} width="520px">
      <div className="text-11 text-dim">A hold blocks the calendar for this request. It lapses on its own unless the request is quoted and paid.</div>
      <label className="flex flex-col gap-4">
        <span className={labelClass}>Room</span>
        <select
          value={roomId}
          onChange={(e) => {
            setRoomId(e.target.value);
            setMachines([]);
          }}
          className={inputClass}
        >
          {request.holdRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {room && room.equipment.length > 0 && (
        <div className="flex flex-col gap-4">
          <span className={labelClass}>Only these machines (leave empty to hold the whole room)</span>
          <div className="flex flex-wrap gap-4 max-h-[120px] overflow-y-auto">
            {room.equipment.map((m) => (
              <label key={m.id} className={`flex items-center gap-4 rounded-2 border px-6 py-3 text-10.5 cursor-pointer ${machines.includes(m.id) ? "border-accent bg-soft" : "border-border2"}`}>
                <input type="checkbox" checked={machines.includes(m.id)} onChange={() => setMachines(machines.includes(m.id) ? machines.filter((x) => x !== m.id) : [...machines, m.id])} />
                {m.name}
              </label>
            ))}
          </div>
        </div>
      )}
      {request.windows.length > 1 && (
        <label className="flex flex-col gap-4">
          <span className={labelClass}>Requested window</span>
          <select value={windowIndex} onChange={(e) => setWindowIndex(Number(e.target.value))} className={inputClass}>
            {request.windows.map((x, i) => (
              <option key={i} value={i}>
                {x.date} {x.start}–{x.end}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-8">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
      </div>
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <ClashList clashes={action.clashes} heading="Already on the calendar" />
      <div className="flex gap-8">
        <Button variant="primary" disabled={action.busy || !itemIds.length} onClick={() => action.run(`/external-requests/${request.id}/hold`, { itemIds, date, start, end })}>
          Hold slot
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ── Head: accept / decline ───────────────────────────────────────────────────

function AssignmentRow({ assignment, onDone }: { assignment: ExternalAssignmentDto; onDone: (r: ExternalRequestDto) => void }) {
  const [open, setOpen] = useState<"ACCEPT" | "DECLINE" | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [noCalendar, setNoCalendar] = useState(false);
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    setOpen(null);
    onDone(r);
  });
  const a = assignment;
  const santim = parseEtb(amount);

  return (
    <div className="px-14 py-8 border-b border-border last:border-0 flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-8">
        <div className="flex-1 min-w-[200px]">
          <div className="text-11.5 font-medium">{a.orgNodeName}</div>
          <div className="text-10.5 text-dim">
            Head: {a.headName ?? "vacant"} · {a.holdCount} slot{a.holdCount === 1 ? "" : "s"} held
            {a.amountSantim !== null ? ` · ${formatEtb(a.amountSantim)}` : ""}
            {a.noCalendarNeeded ? " · no calendar needed" : ""}
          </div>
          {a.sheetUrl && (
            <a href={a.sheetUrl} target="_blank" rel="noreferrer" className="text-10.5 text-accent underline break-all">
              Pricing sheet
            </a>
          )}
          {a.note && <div className="text-10.5 text-dim italic">"{a.note}"</div>}
        </div>
        <Tag tone={a.status === "ACCEPTED" ? "good" : a.status === "DECLINED" ? "bad" : "warn"}>{a.status}</Tag>
        {a.canDecide && !open && (
          <>
            <Button variant="primary" onClick={() => setOpen("ACCEPT")}>
              Accept…
            </Button>
            <Button variant="danger" onClick={() => setOpen("DECLINE")}>
              Decline…
            </Button>
          </>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-6 border border-border2 rounded-2 p-8">
          {open === "ACCEPT" && (
            <>
              <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/… (pricing breakdown)" className={inputClass} />
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Your department's amount, ETB" className={inputClass} />
              {a.holdCount === 0 && (
                <label className="flex items-center gap-6 text-10.5">
                  <input type="checkbox" checked={noCalendar} onChange={(e) => setNoCalendar(e.target.checked)} />
                  Nothing of ours needs a calendar slot (e.g. consumables only)
                </label>
              )}
            </>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={inputClass} />
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex gap-8">
            <Button
              variant={open === "ACCEPT" ? "primary" : "danger"}
              disabled={action.busy || (open === "ACCEPT" && (santim === null || !sheetUrl))}
              onClick={() =>
                action.run(`/external-requests/assignments/${a.id}/decide`, {
                  decision: open,
                  sheetUrl: open === "ACCEPT" ? sheetUrl : undefined,
                  amountSantim: open === "ACCEPT" ? santim : undefined,
                  noCalendarNeeded: open === "ACCEPT" ? noCalendar : undefined,
                  note: note || undefined,
                })
              }
            >
              {open === "ACCEPT" ? "Accept" : "Decline"}
            </Button>
            <Button onClick={() => setOpen(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function RequestDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [request, setRequest] = useState<ExternalRequestDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"forward" | "quote" | "decline" | "hold" | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<ExternalRequestDto>(`/external-requests/${id}`)
      .then(setRequest)
      .catch((e) => setError(message(e, "Could not load this request")));
  }, [id]);
  useEffect(load, [load]);

  function updated(next: ExternalRequestDto) {
    setRequest(next);
    onChanged();
  }

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!request) return <PanelLoading rows={6} />;
  const r = request;

  return (
    <>
      <Panel
        title={`${r.reference} · ${r.organizationName}`}
        actions={
          <div className="flex flex-wrap items-center gap-6">
            <Tag tone={externalStatusTone(r.status)}>{EXTERNAL_STATUS_LABEL[r.status]}</Tag>
            {r.can.forward && <Button onClick={() => setModal("forward")}>Forward…</Button>}
            {r.can.placeHold && <Button onClick={() => setModal("hold")}>Hold a slot…</Button>}
            {r.can.quote && (
              <Button variant="primary" onClick={() => setModal("quote")}>
                Send quote…
              </Button>
            )}
            {r.can.close && (
              <Button variant="danger" onClick={() => setModal("decline")}>
                Decline…
              </Button>
            )}
          </div>
        }
      >
        <div className="px-14 py-10 grid grid-cols-1 md:grid-cols-2 gap-10 text-11.5">
          <div className="flex flex-col gap-4">
            <div className={labelClass}>Requester</div>
            <div>{r.contactName}</div>
            <div className="text-dim">
              {r.contactEmail} · {r.contactPhone}
            </div>
            <a href={r.letter.url} target="_blank" rel="noreferrer" className="text-accent underline">
              Official letter ({r.letter.fileName}, {Math.ceil(r.letter.byteSize / 1024)} KB)
            </a>
          </div>
          <div className="flex flex-col gap-4">
            <div className={labelClass}>When</div>
            {r.windows.map((w, i) => (
              <div key={i} className="font-mono">
                {w.date} {w.start}–{w.end}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-4 md:col-span-2">
            <div className={labelClass}>Purpose</div>
            <div className="text-dim whitespace-pre-wrap">{r.purpose}</div>
          </div>
          <div className="flex flex-col gap-4 md:col-span-2">
            <div className={labelClass}>Asked for</div>
            {r.lines.map((l, i) => (
              <div key={i}>
                <span className="font-mono">{l.quantity} ×</span> {l.description}
                {l.categoryName ? <span className="text-faint"> ({l.categoryName})</span> : null}
              </div>
            ))}
          </div>
          {r.quoteAmountSantim !== null && (
            <div className="flex flex-col gap-4 md:col-span-2">
              <div className={labelClass}>Quote</div>
              <div>
                <span className="font-mono font-semibold">{formatEtb(r.quoteAmountSantim)}</span>
                {r.paymentDeadline ? ` · pay by ${new Date(r.paymentDeadline).toLocaleDateString()}` : ""}
              </div>
            </div>
          )}
          {r.closingNote && <div className="md:col-span-2 text-bad">{r.closingNote}</div>}
        </div>
      </Panel>

      <Panel title={`Departments (${r.assignments.length})`}>
        {r.assignments.length === 0 ? (
          <div className="px-14 py-10 text-11 text-dim">Not forwarded to any department yet.</div>
        ) : (
          r.assignments.map((a) => <AssignmentRow key={a.id} assignment={a} onDone={updated} />)
        )}
      </Panel>

      <Panel title={`Held slots (${r.holds.filter((h) => h.state === "HELD" || h.state === "CONFIRMED").length})`}>
        {r.holds.length === 0 ? (
          <div className="px-14 py-10 text-11 text-dim">Nothing held on any calendar yet.</div>
        ) : (
          r.holds.map((h) => (
            <div key={h.id} className="px-14 py-7 border-b border-border last:border-0 flex flex-wrap items-center gap-8 text-11">
              <span className="font-mono">
                {h.date} {h.start}–{h.end}
              </span>
              <span>{h.labName}</span>
              <span className="text-dim">{h.resources.map((x) => x.name).join(", ")}</span>
              <Tag tone={h.state === "CONFIRMED" ? "good" : h.state === "HELD" ? "cross" : "neutral"}>{STATE_LABEL[h.state]}</Tag>
              {h.holdExpiresAt && h.state === "HELD" && <span className="text-faint text-10">until {new Date(h.holdExpiresAt).toLocaleDateString()}</span>}
            </div>
          ))
        )}
      </Panel>

      <Panel title="History">
        <div className="px-14 py-8 flex flex-col gap-4">
          {r.events.map((e, i) => (
            <div key={i} className="text-10.5">
              <span className="font-mono text-dim">{new Date(e.at).toLocaleString()}</span> · {e.actorLabel} · {e.kind.replace(/_/g, " ").toLowerCase()}
              {e.note ? <span className="text-dim"> — {e.note}</span> : null}
            </div>
          ))}
        </div>
      </Panel>

      {modal === "forward" && <ForwardModal request={r} onClose={() => setModal(null)} onDone={updated} />}
      {modal === "quote" && <QuoteModal request={r} onClose={() => setModal(null)} onDone={updated} />}
      {modal === "decline" && <DeclineModal request={r} onClose={() => setModal(null)} onDone={updated} />}
      {modal === "hold" && <HoldModal request={r} onClose={() => setModal(null)} onDone={updated} />}
    </>
  );
}

export default function ExternalRequestsPage() {
  const [rows, setRows] = useState<ExternalRequestSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<ExternalRequestSummaryDto[]>("/external-requests")
      .then((list) => {
        setRows(list);
        setSelected((s) => s ?? list[0]?.id ?? null);
      })
      .catch((e) => setError(message(e, "Could not load requests")));
  }, []);
  useEffect(load, [load]);

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-14 items-start">
        <Panel title="Requests">
          {rows === null ? (
            <PanelLoading rows={4} />
          ) : rows.length === 0 ? (
            <div className="px-14 py-10 text-11 text-dim">No external requests involve you.</div>
          ) : (
            rows.map((row) => (
              <button key={row.id} onClick={() => setSelected(row.id)} className={`w-full text-left px-14 py-8 border-b border-border last:border-0 hover:bg-panel2 ${selected === row.id ? "bg-soft" : ""}`}>
                <div className="flex items-center justify-between gap-6">
                  <span className="text-11 font-mono font-semibold">{row.reference}</span>
                  <Tag tone={externalStatusTone(row.status)}>{EXTERNAL_STATUS_LABEL[row.status]}</Tag>
                </div>
                <div className="text-11 truncate">{row.organizationName}</div>
                <div className="text-10 text-faint">
                  {row.firstWindow ? `${row.firstWindow.date}${row.windowCount > 1 ? ` +${row.windowCount - 1}` : ""}` : ""} · {row.acceptedCount}/{row.assignmentCount} departments
                </div>
              </button>
            ))
          )}
        </Panel>
        <div className="flex flex-col gap-14 min-w-0">{selected ? <RequestDetail key={selected} id={selected} onChanged={load} /> : null}</div>
      </div>
    </Screen>
  );
}

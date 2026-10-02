"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ClashDto, ExternalAssignmentDto, ExternalContactDto, ExternalRequestDto, ExternalRequestSummaryDto, ExternalTaskDto } from "@/lib/shared";
import { addDays, instantToCivil } from "@/lib/domain/civil-time";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote, Button, Tag, Modal } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { ClashList } from "@/components/scheduling/SchedulePage";
import { STATE_LABEL } from "@/components/scheduling/WeekCalendar";
import { EXTERNAL_STATUS_LABEL, KIND_LABEL, TASK_STATUS_LABEL, assignmentStatusLabel, assignmentTone, externalStatusTone, formatEtb, parseEtb } from "./labels";
import { PAYMENT_STATUS_LABEL, paymentTone } from "@/components/portal/PaymentPanel";

/**
 * The staff side of an outside institution's request, along the university's own line
 * (2026-09-28): AVP → dean → head → custodians, and back up. One screen for every role,
 * each seeing only its own buttons (the server decides — `can` on the request and on each
 * unit's part):
 *  - the AVP's office forwards to colleges, approves or sends back each college's answer,
 *    sends the quote, checks payments and confirms them, or declines;
 *  - a dean forwards to their departments, approves or sends back each department's
 *    answer, and submits the college's answer — or declines the college's part;
 *  - a head asks custodians to hold rooms or machines, then submits the booked rooms, the
 *    cost breakdown and the contact persons — or declines;
 *  - a custodian holds slots on the rooms they keep and reports back.
 */

const inputClass = "h-26 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent";
const labelClass = "text-10.5 uppercase tracking-label text-faint font-semibold";

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

// ── Forward: the AVP to colleges, a dean to departments ─────────────────────

function ForwardModal({
  title,
  path,
  targets,
  onClose,
  onDone,
}: {
  title: string;
  path: string;
  targets: ExternalRequestDto["forwardTargets"];
  onClose: () => void;
  onDone: (r: ExternalRequestDto) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    onDone(r);
    onClose();
  });
  return (
    <Modal title={title} onClose={onClose} width="480px">
      {targets.length === 0 ? (
        <div className="text-11 text-dim">It has already been sent to every unit that can take it.</div>
      ) : (
        <div className="flex flex-col gap-4 max-h-[260px] overflow-y-auto">
          {targets.map((d) => (
            <label key={d.id} className="flex items-center gap-6 text-11">
              <input type="checkbox" checked={chosen.includes(d.id)} onChange={() => setChosen(chosen.includes(d.id) ? chosen.filter((x) => x !== d.id) : [...chosen, d.id])} />
              {d.name}
              <span className="text-faint">{d.headName ? `· ${d.headName}` : "· vacant"}</span>
            </label>
          ))}
        </div>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to them (optional)" className={inputClass} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex gap-8">
        <Button variant="primary" disabled={action.busy || !chosen.length} onClick={() => action.run(path, { orgNodeIds: chosen, note: note || undefined })}>
          Forward
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

/** A note, then one action — declines, send-backs, a custodian's "done" or "can't". */
function NoteModal({
  title,
  intro,
  confirmLabel,
  tone = "primary",
  noteRequired = false,
  path,
  body,
  onClose,
  onDone,
}: {
  title: string;
  intro: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  noteRequired?: boolean;
  path: string;
  body: Record<string, unknown>;
  onClose: () => void;
  onDone: (r: ExternalRequestDto) => void;
}) {
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    onDone(r);
    onClose();
  });
  return (
    <Modal title={title} onClose={onClose} width="440px">
      <div className="text-11 text-dim">{intro}</div>
      <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={noteRequired ? "Reason" : "Note (optional)"} className="px-8 py-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent" />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex gap-8">
        <Button variant={tone} disabled={action.busy || (noteRequired && note.trim().length < 3)} onClick={() => action.run(path, { ...body, note: note.trim() || undefined })}>
          {confirmLabel}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ── Head: ask custodians, submit the answer ─────────────────────────────────

function AssignModal({ request, assignment, onClose, onDone }: { request: ExternalRequestDto; assignment: ExternalAssignmentDto; onClose: () => void; onDone: (r: ExternalRequestDto) => void }) {
  const people = request.custodians.filter((c) => c.assignmentId === assignment.id);
  const [wants, setWants] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    onDone(r);
    onClose();
  });
  const tasks = Object.entries(wants)
    .filter(([, want]) => want.trim().length >= 2)
    .map(([custodianId, want]) => ({ custodianId, want: want.trim() }));
  return (
    <Modal title={`Ask custodians — ${assignment.orgNodeName}`} onClose={onClose} width="520px">
      <div className="text-11 text-dim">
        Ask as many custodians as it takes. Say what each should hold on the requested dates{request.kind === "SAMPLE_ANALYSIS" ? " — which machine" : " — which labs, how many"}. They hold the slots and report back to you.
      </div>
      {people.length === 0 ? (
        <div className="text-11 text-dim">Every custodian of the department has been asked already.</div>
      ) : (
        <div className="flex flex-col gap-6 max-h-[300px] overflow-y-auto">
          {people.map((p) => (
            <label key={p.id} className="flex flex-col gap-3">
              <span className="text-11">{p.name}</span>
              <input value={wants[p.id] ?? ""} onChange={(e) => setWants({ ...wants, [p.id]: e.target.value })} placeholder="Leave empty to not ask them" className={inputClass} />
            </label>
          ))}
        </div>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to them (optional)" className={inputClass} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex gap-8">
        <Button variant="primary" disabled={action.busy || !tasks.length} onClick={() => action.run(`/external-requests/assignments/${assignment.id}/assign`, { tasks, note: note || undefined })}>
          Ask {tasks.length || ""} custodian{tasks.length === 1 ? "" : "s"}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

const blankContact = (): ExternalContactDto => ({ name: "", role: "", phone: "", email: "" });

function SubmitDepartmentModal({ assignment, onClose, onDone }: { assignment: ExternalAssignmentDto; onClose: () => void; onDone: (r: ExternalRequestDto) => void }) {
  const [sheetUrl, setSheetUrl] = useState(assignment.sheetUrl ?? "");
  const [amount, setAmount] = useState(assignment.amountSantim !== null ? (assignment.amountSantim / 100).toFixed(2) : "");
  const [contacts, setContacts] = useState<ExternalContactDto[]>(assignment.contacts.length ? assignment.contacts : [blankContact()]);
  const [noCalendar, setNoCalendar] = useState(false);
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    onDone(r);
    onClose();
  });
  const santim = parseEtb(amount);
  const cleaned = contacts
    .map((c) => ({ name: c.name.trim(), role: c.role?.trim() || undefined, phone: c.phone.trim(), email: c.email?.trim() || undefined }))
    .filter((c) => c.name && c.phone);
  const update = (i: number, patch: Partial<ExternalContactDto>) => setContacts(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <Modal title={`Send the answer to the dean — ${assignment.orgNodeName}`} onClose={onClose} width="560px">
      <div className="text-11 text-dim">
        {assignment.holdCount} slot{assignment.holdCount === 1 ? "" : "s"} held by your custodians. Add the cost breakdown, and who the requester should call once they have paid — they see these people only after the AVP confirms the payment.
      </div>
      <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/… (cost breakdown)" className={inputClass} />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Your department's amount, ETB" className={inputClass} />
      <div className={labelClass}>Contact persons</div>
      {contacts.map((c, i) => (
        <div key={i} className="grid grid-cols-2 gap-6">
          <input value={c.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" className={inputClass} />
          <input value={c.role ?? ""} onChange={(e) => update(i, { role: e.target.value })} placeholder="Role (e.g. lab assistant)" className={inputClass} />
          <input value={c.phone} onChange={(e) => update(i, { phone: e.target.value })} placeholder="Phone" className={inputClass} />
          <input value={c.email ?? ""} onChange={(e) => update(i, { email: e.target.value })} placeholder="Email (optional)" className={inputClass} />
        </div>
      ))}
      <div>
        <button type="button" className="text-11 text-accent" onClick={() => setContacts([...contacts, blankContact()])}>
          + Another contact
        </button>
      </div>
      {assignment.holdCount === 0 && (
        <label className="flex items-center gap-6 text-11">
          <input type="checkbox" checked={noCalendar} onChange={(e) => setNoCalendar(e.target.checked)} />
          Nothing of ours needs a calendar slot (e.g. consumables only)
        </label>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to the dean (optional)" className={inputClass} />
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex gap-8">
        <Button
          variant="primary"
          disabled={action.busy || santim === null || !sheetUrl || !cleaned.length}
          onClick={() => action.run(`/external-requests/assignments/${assignment.id}/submit`, { sheetUrl, amountSantim: santim, contacts: cleaned, noCalendarNeeded: noCalendar || undefined, note: note || undefined })}
        >
          Send to the dean
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ── AVP: quote / decline ─────────────────────────────────────────────────────

function QuoteModal({ request, onClose, onDone }: { request: ExternalRequestDto; onClose: () => void; onDone: (r: ExternalRequestDto) => void }) {
  const sum = request.suggestedQuoteSantim ?? 0;
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
      <div className="text-11 text-dim">Approved departments total {formatEtb(sum)}. The requester sees this amount, each department's cost breakdown and the university's bank account; holds last until the deadline.</div>
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
              <label key={m.id} className={`flex items-center gap-4 rounded-2 border px-6 py-3 text-11 cursor-pointer ${machines.includes(m.id) ? "border-accent bg-soft" : "border-border2"}`}>
                <input type="checkbox" checked={machines.includes(m.id)} onChange={() => setMachines(machines.includes(m.id) ? machines.filter((x) => x !== m.id) : [...machines, m.id])} />
                {m.place ? `${m.place} › ` : ""}
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

// ── The line: each unit's part ─────────────────────────────────────────────

type Pending =
  | { kind: "forward"; assignment: ExternalAssignmentDto }
  | { kind: "assign"; assignment: ExternalAssignmentDto }
  | { kind: "submit-dept"; assignment: ExternalAssignmentDto }
  | { kind: "note"; title: string; intro: string; confirmLabel: string; tone?: "primary" | "danger"; noteRequired?: boolean; path: string; body: Record<string, unknown> };

function TaskLine({ task, onAct }: { task: ExternalTaskDto; onAct: (p: Pending) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-8 text-11 pl-12">
      <span className="min-w-[160px]">{task.custodianName}</span>
      <span className="text-dim flex-1 min-w-[160px]">
        {task.want} · {task.holdCount} held{task.note ? ` · "${task.note}"` : ""}
      </span>
      <Tag tone={task.status === "DONE" ? "good" : task.status === "DECLINED" ? "bad" : "warn"}>{TASK_STATUS_LABEL[task.status]}</Tag>
      {task.mine && task.status === "PENDING" && (
        <>
          <Button
            variant="primary"
            onClick={() => onAct({ kind: "note", title: "Report back: held", intro: "Tell your head you have held what they asked for. Your holds stay on the calendar.", confirmLabel: "Done", path: `/external-requests/tasks/${task.id}/finish`, body: { outcome: "DONE" } })}
          >
            Done…
          </Button>
          <Button
            variant="danger"
            onClick={() => onAct({ kind: "note", title: "Report back: can't", intro: "Tell your head you can't hold what they asked for, and why.", confirmLabel: "Can't hold it", tone: "danger", noteRequired: true, path: `/external-requests/tasks/${task.id}/finish`, body: { outcome: "DECLINED" } })}
          >
            Can't…
          </Button>
        </>
      )}
    </div>
  );
}

function PartLine({ assignment: a, onAct }: { assignment: ExternalAssignmentDto; onAct: (p: Pending) => void }) {
  const college = a.level === "COLLEGE";
  const who = college ? "Dean" : "Head";
  const decline = () =>
    onAct({
      kind: "note",
      title: `Decline — ${a.orgNodeName}`,
      intro: college ? "The college's part ends, its departments' too, and anything they held is released." : "Your department's part ends and anything held for it is released.",
      confirmLabel: "Decline",
      tone: "danger",
      noteRequired: true,
      path: `/external-requests/assignments/${a.id}/decline`,
      body: {},
    });
  const review = (decision: "APPROVE" | "RETURN") =>
    onAct({
      kind: "note",
      title: `${decision === "APPROVE" ? "Approve" : "Send back"} — ${a.orgNodeName}`,
      intro: decision === "APPROVE" ? "Their answer goes into the next step up." : `It goes back to the ${college ? "dean" : "head"} to answer again.`,
      confirmLabel: decision === "APPROVE" ? "Approve" : "Send back",
      tone: decision === "APPROVE" ? "primary" : "danger",
      noteRequired: decision === "RETURN",
      path: `/external-requests/assignments/${a.id}/review`,
      body: { decision },
    });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-8">
        <div className="flex-1 min-w-[220px]">
          <div className="text-11.5 font-medium">
            {college ? "College" : "Department"} — {a.orgNodeName}
          </div>
          <div className="text-11 text-dim">
            {who}: {a.headName ?? "vacant"} · {a.holdCount} slot{a.holdCount === 1 ? "" : "s"} held
            {a.amountSantim !== null ? ` · ${formatEtb(a.amountSantim)}` : ""}
            {a.noCalendarNeeded ? " · no calendar needed" : ""}
          </div>
          {a.sheetUrl && (
            <a href={a.sheetUrl} target="_blank" rel="noreferrer" className="text-11 text-accent underline break-all">
              Cost breakdown
            </a>
          )}
          {a.contacts.length > 0 && (
            <div className="text-11 text-dim">
              Contacts: {a.contacts.map((c) => `${c.name}${c.role ? ` (${c.role})` : ""} · ${c.phone}`).join("; ")}
            </div>
          )}
          {a.note && <div className="text-11 text-dim italic">"{a.note}"</div>}
        </div>
        <Tag tone={assignmentTone(a.status)}>{assignmentStatusLabel(a.level, a.status)}</Tag>
        {a.can.forward && <Button onClick={() => onAct({ kind: "forward", assignment: a })}>Forward to departments…</Button>}
        {a.can.assign && <Button onClick={() => onAct({ kind: "assign", assignment: a })}>Ask custodians…</Button>}
        {a.can.submit && !college && (
          <Button variant="primary" onClick={() => onAct({ kind: "submit-dept", assignment: a })}>
            Send to the dean…
          </Button>
        )}
        {a.can.submit && college && (
          <Button
            variant="primary"
            onClick={() =>
              onAct({ kind: "note", title: `Send to the AVP — ${a.orgNodeName}`, intro: "The college's answer — every approved department's rooms, costs and contacts — goes to the AVP's office.", confirmLabel: "Send to the AVP", path: `/external-requests/assignments/${a.id}/submit`, body: {} })
            }
          >
            Send to the AVP…
          </Button>
        )}
        {a.can.review && (
          <>
            {a.status !== "APPROVED" && (
              <Button variant="primary" onClick={() => review("APPROVE")}>
                Approve…
              </Button>
            )}
            <Button onClick={() => review("RETURN")}>Send back…</Button>
          </>
        )}
        {a.can.decline && (
          <Button variant="danger" onClick={decline}>
            Decline…
          </Button>
        )}
      </div>
      {a.tasks.map((t) => (
        <TaskLine key={t.id} task={t} onAct={onAct} />
      ))}
    </div>
  );
}

function TheLine({ request, onAct }: { request: ExternalRequestDto; onAct: (p: Pending) => void }) {
  const top = request.assignments.filter((a) => a.parentId === null);
  return (
    <Panel title="Line of communication">
      {top.length === 0 ? (
        <div className="px-14 py-10 text-11 text-dim">Not forwarded to any college yet.</div>
      ) : (
        top.map((c) => (
          <div key={c.id} className="px-14 py-10 border-b border-border last:border-0 flex flex-col gap-10">
            <PartLine assignment={c} onAct={onAct} />
            {request.assignments
              .filter((d) => d.parentId === c.id)
              .map((d) => (
                <div key={d.id} className="ml-14 pl-12 border-l-2 border-border2">
                  <PartLine assignment={d} onAct={onAct} />
                </div>
              ))}
          </div>
        ))
      )}
    </Panel>
  );
}

// ── AVP: payments ────────────────────────────────────────────────────────────

type PaymentRow = ExternalRequestDto["payments"][number];

function PaymentRowView({ payment, onDone }: { payment: PaymentRow; onDone: (r: ExternalRequestDto) => void }) {
  const [open, setOpen] = useState<"APPROVE" | "REJECT" | null>(null);
  const [amount, setAmount] = useState(payment.amountSantim !== null ? (payment.amountSantim / 100).toFixed(2) : "");
  const [note, setNote] = useState("");
  const action = useAction((r) => {
    setOpen(null);
    onDone(r);
  });
  const p = payment;
  const santim = parseEtb(amount);
  return (
    <div className="px-14 py-8 border-b border-border last:border-0 flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-8 text-11">
        <span className="font-mono">{p.reference}</span>
        <span className="text-dim">{p.provider}</span>
        {p.amountSantim !== null && <span className="font-mono">{formatEtb(p.amountSantim)}</span>}
        <Tag tone={paymentTone(p.status)}>{PAYMENT_STATUS_LABEL[p.status]}</Tag>
        <span className="text-faint text-11">{new Date(p.createdAt).toLocaleString()}</span>
        {p.receiptUrl && (
          <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-11 text-accent underline">
            Bank receipt
          </a>
        )}
        <div className="flex-1" />
        {p.canReview && !open && (
          <>
            <Button variant="primary" onClick={() => setOpen("APPROVE")}>
              Accept…
            </Button>
            <Button variant="danger" onClick={() => setOpen("REJECT")}>
              Reject…
            </Button>
          </>
        )}
      </div>
      <div className="text-11 text-dim flex flex-col gap-2">
        {(p.payerName || p.receiverName || p.receiverAccount) && (
          <span>
            {p.payerName ? `From ${p.payerName}` : ""}
            {p.receiverName || p.receiverAccount ? ` → ${[p.receiverName, p.receiverAccount].filter(Boolean).join(" · ")}` : ""}
            {p.paidAt ? ` · paid ${new Date(p.paidAt).toLocaleString()}` : ""}
          </span>
        )}
        {p.requesterNote && <span className="italic">Requester: "{p.requesterNote}"</span>}
        {p.reason && <span>{p.reviewedByName ? `${p.reviewedByName}: ` : ""}{p.reason}</span>}
      </div>
      {open && (
        <div className="flex flex-col gap-6 border border-border2 rounded-2 p-8">
          {open === "APPROVE" ? (
            <div className="text-11 text-dim">Check the bank statement for this reference. Accept the amount actually received — it counts towards the quote; once the total is reached, you confirm the payment.</div>
          ) : (
            <div className="text-11 text-dim">The requester is emailed this reason and may submit another reference.</div>
          )}
          {open === "APPROVE" && <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount received, ETB" className={inputClass} />}
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={open === "APPROVE" ? "Note (optional)" : "Reason"} className={inputClass} />
          {action.error && <ErrorNote>{action.error}</ErrorNote>}
          <div className="flex gap-8">
            <Button
              variant={open === "APPROVE" ? "primary" : "danger"}
              disabled={action.busy || (open === "APPROVE" ? santim === null : note.trim().length < 3)}
              onClick={() => action.run(`/external-requests/payments/${p.id}/review`, { decision: open, amountSantim: open === "APPROVE" ? santim : undefined, note: note.trim() || undefined })}
            >
              {open === "APPROVE" ? "Accept payment" : "Reject payment"}
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
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useAction((next) => updated(next));

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
            <Tag tone="neutral">{KIND_LABEL[r.kind]}</Tag>
            {r.can.forward && <Button onClick={() => setModal("forward")}>Forward to colleges…</Button>}
            {r.can.placeHold && <Button onClick={() => setModal("hold")}>Hold a slot…</Button>}
            {r.can.confirm && (
              <Button variant="primary" disabled={confirm.busy} onClick={() => confirm.run(`/external-requests/${r.id}/confirm`, {})}>
                Confirm payment
              </Button>
            )}
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
          {r.sample && (
            <div className="flex flex-col gap-4 md:col-span-2">
              <div className={labelClass}>Samples</div>
              <div>
                <span className="font-mono">{r.sample.sampleCount} ×</span> {r.sample.analysis}
                {r.sample.categoryName ? <span className="text-faint"> (on a {r.sample.categoryName})</span> : null}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-4 md:col-span-2">
            <div className={labelClass}>Asked for</div>
            {r.lines.length === 0 && <div className="text-dim">—</div>}
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

      {confirm.error && <ErrorNote>{confirm.error}</ErrorNote>}
      {r.status === "PAID" && r.can.confirm && (
        <div className="border border-accent rounded-2 px-12 py-8 text-11">
          Paid in full. Check the receipts under Payments (open the bank receipt where there is one), then <strong>Confirm payment</strong>: that books the held slots and shows the
          requester the contact persons. If a slot was lost meanwhile (see History), have a custodian hold a replacement and confirm again — or decline and arrange a refund.
        </div>
      )}

      <TheLine request={r} onAct={setPending} />

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
              {/* A whole-room hold's one resource is the lab itself — don't name it twice (G-16). */}
              <span className="text-dim">{h.resources.some((x) => x.name !== h.labName) ? h.resources.map((x) => x.name).join(", ") : "whole room"}</span>
              <Tag tone={h.state === "CONFIRMED" ? "good" : h.state === "HELD" ? "cross" : "neutral"}>{STATE_LABEL[h.state]}</Tag>
              {h.holdExpiresAt && h.state === "HELD" && <span className="text-faint text-11">until {new Date(h.holdExpiresAt).toLocaleDateString()}</span>}
            </div>
          ))
        )}
      </Panel>

      {r.quoteAmountSantim !== null && (
        <Panel title={`Payments · ${formatEtb(r.paidSantim)} of ${formatEtb(r.quoteAmountSantim)}`}>
          {r.payments.length === 0 ? (
            <div className="px-14 py-10 text-11 text-dim">{r.paidSantim > 0 ? "Receipts are visible to the AVP's office." : "No payment submitted yet."}</div>
          ) : (
            r.payments.map((p) => <PaymentRowView key={p.id} payment={p} onDone={updated} />)
          )}
        </Panel>
      )}

      <Panel title="History">
        <div className="px-14 py-8 flex flex-col gap-4">
          {r.events.map((e, i) => (
            <div key={i} className="text-11">
              <span className="font-mono text-dim">{new Date(e.at).toLocaleString()}</span> · {e.actorLabel} · {e.kind.replace(/_/g, " ").toLowerCase()}
              {e.note ? <span className="text-dim"> — {e.note}</span> : null}
            </div>
          ))}
        </div>
      </Panel>

      {modal === "forward" && (
        <ForwardModal title={`Forward ${r.reference} to colleges`} path={`/external-requests/${r.id}/forward`} targets={r.forwardTargets.filter((t) => t.parentAssignmentId === null)} onClose={() => setModal(null)} onDone={updated} />
      )}
      {pending?.kind === "forward" && (
        <ForwardModal
          title={`Forward to departments — ${pending.assignment.orgNodeName}`}
          path={`/external-requests/assignments/${pending.assignment.id}/forward`}
          targets={r.forwardTargets.filter((t) => t.parentAssignmentId === pending.assignment.id)}
          onClose={() => setPending(null)}
          onDone={updated}
        />
      )}
      {pending?.kind === "assign" && <AssignModal request={r} assignment={pending.assignment} onClose={() => setPending(null)} onDone={updated} />}
      {pending?.kind === "submit-dept" && <SubmitDepartmentModal assignment={pending.assignment} onClose={() => setPending(null)} onDone={updated} />}
      {pending?.kind === "note" && <NoteModal {...pending} onClose={() => setPending(null)} onDone={updated} />}
      {modal === "quote" && <QuoteModal request={r} onClose={() => setModal(null)} onDone={updated} />}
      {modal === "decline" && <DeclineModal request={r} onClose={() => setModal(null)} onDone={updated} />}
      {modal === "hold" && <HoldModal request={r} onClose={() => setModal(null)} onDone={updated} />}
    </>
  );
}

export default function ExternalRequestsPage() {
  return (
    <Suspense fallback={<Screen><Panel title="Requests"><PanelLoading rows={4} /></Panel></Screen>}>
      <Requests />
    </Suspense>
  );
}

function Requests() {
  // `?focus=<id>` (a notice, Home) opens that request rather than the newest.
  const focus = useSearchParams().get("focus");
  const [rows, setRows] = useState<ExternalRequestSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(focus);

  const load = useCallback(() => {
    api
      .get<ExternalRequestSummaryDto[]>("/external-requests")
      .then((list) => {
        setRows(list);
        setSelected((s) => (s && list.some((r) => r.id === s) ? s : (list[0]?.id ?? null)));
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
                <div className="text-11 text-faint">
                  {KIND_LABEL[row.kind]} · {row.firstWindow ? `${row.firstWindow.date}${row.windowCount > 1 ? ` +${row.windowCount - 1}` : ""}` : ""} · {row.acceptedCount}/{row.assignmentCount} departments
                </div>
                {row.waitingOnMe && <div className="text-11 text-accent font-medium">Waiting on you</div>}
              </button>
            ))
          )}
        </Panel>
        <div className="flex flex-col gap-14 min-w-0">{selected ? <RequestDetail key={selected} id={selected} onChanged={load} /> : null}</div>
      </div>
    </Screen>
  );
}

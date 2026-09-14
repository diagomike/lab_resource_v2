"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BookableDto, BookingPreviewDto, ClashDto, ReservationDto, ScheduleSeriesDto, SchedulingLabDto } from "@/lib/shared";
import { addDays, instantToCivil, minutesOf, startOfWeek } from "@/lib/domain/civil-time";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote, Button, Tag, Modal, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { CalendarLegend, SOURCE_LABEL, STATE_LABEL, WeekCalendar, WeekNav } from "./WeekCalendar";

/**
 * Track 6 — the lab calendar
 * (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md).
 *
 *  - My labs: a custodian's rooms — the week, weekly class slots, requests to decide.
 *  - Book: any staff member finds a room or machine and asks for a time; students are
 *    booked for by their advisor ("on behalf of").
 *  - My bookings: what I have asked for.
 *
 * Every time here is a civil date + "HH:mm" in the venue's zone; the server converts.
 */

const WEEKDAYS: Array<[number, string]> = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
];

const inputClass = "h-26 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent";
const labelClass = "text-9.5 uppercase tracking-label text-faint font-semibold";

function today(): string {
  return instantToCivil(new Date()).date;
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function clashesOf(e: unknown): ClashDto[] {
  const body = e instanceof ApiError ? (e.body as { clashes?: ClashDto[] } | undefined) : undefined;
  return body?.clashes ?? [];
}

function stateTone(state: ReservationDto["state"]): "good" | "warn" | "bad" | "neutral" | "cross" {
  if (state === "CONFIRMED") return "good";
  if (state === "REQUESTED") return "warn";
  if (state === "HELD") return "cross";
  if (state === "DECLINED") return "bad";
  return "neutral";
}

export function ClashList({ clashes, heading }: { clashes: ClashDto[]; heading: string }) {
  if (!clashes.length) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className={labelClass}>{heading}</div>
      {clashes.map((c) => (
        <div key={`${c.reservationId}-${c.itemName}-${c.date}`} className="text-10.5 text-dim">
          <span className="font-mono">
            {c.date} {c.start}–{c.end}
          </span>{" "}
          · {c.title} ({SOURCE_LABEL[c.source]}, {STATE_LABEL[c.state].toLowerCase()}) · {c.itemName}
          {c.claimedItemName !== c.itemName ? ` vs ${c.claimedItemName}` : ""}
        </div>
      ))}
    </div>
  );
}

// ── One booking's detail and actions ─────────────────────────────────────────

function ReservationModal({ reservation, onClose, onChanged }: { reservation: ReservationDto; onClose: () => void; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<ClashDto[]>([]);

  async function act(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    setClashes([]);
    try {
      await api.post(path, body);
      onChanged();
      onClose();
    } catch (e) {
      setError(errorText(e, "Could not update this booking"));
      setClashes(clashesOf(e));
    } finally {
      setBusy(false);
    }
  }

  const r = reservation;
  return (
    <Modal title={r.title} onClose={onClose} width="460px">
      <div className="flex flex-wrap items-center gap-6">
        <Tag tone={stateTone(r.state)}>{STATE_LABEL[r.state]}</Tag>
        <Tag>{SOURCE_LABEL[r.source]}</Tag>
      </div>
      <div className="text-11 flex flex-col gap-4">
        <div>
          <span className="font-mono">
            {r.date} · {r.start}–{r.end}
          </span>{" "}
          · {r.labName}
        </div>
        <div className="text-dim">{r.resources.map((x) => x.name).join(", ")}</div>
        {r.requestedByName && <div className="text-dim">Requested by {r.requestedByName}</div>}
        {r.participantCount && <div className="text-dim">{r.participantCount} participants</div>}
        {r.onBehalfOfNote && <div className="text-dim">On behalf of: {r.onBehalfOfNote}</div>}
        {r.holdExpiresAt && <div className="text-dim">Hold lapses {new Date(r.holdExpiresAt).toLocaleString()}</div>}
        {r.note && <div className="text-dim italic">"{r.note}"</div>}
        {r.decidedByName && <div className="text-faint text-10.5">Last decided by {r.decidedByName}</div>}
      </div>

      {(r.canDecide || r.canCancel) && (
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className={inputClass} />
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <ClashList clashes={clashes} heading="In the way" />

      <div className="flex flex-wrap items-center gap-8">
        {r.canDecide && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => act(`/scheduling/bookings/${r.id}/decide`, { decision: "APPROVE", note: note || undefined })}>
              Approve
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => act(`/scheduling/bookings/${r.id}/decide`, { decision: "DECLINE", note: note || undefined })}>
              Decline
            </Button>
          </>
        )}
        {r.canCancel && (
          <Button variant="danger" disabled={busy} onClick={() => act(`/scheduling/bookings/${r.id}/cancel`, { note: note || undefined })}>
            {r.source === "CLASS" ? "Cancel this date" : "Cancel booking"}
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

// ── Booking form (staff, or a custodian in their own room) ──────────────────

function BookingForm({
  lab,
  initialItemIds,
  slot,
  onBooked,
}: {
  lab: SchedulingLabDto;
  initialItemIds: string[];
  slot: { date: string; start: string } | null;
  onBooked: (r: ReservationDto) => void;
}) {
  const [itemIds, setItemIds] = useState<string[]>(initialItemIds);
  const [date, setDate] = useState(slot?.date ?? addDays(today(), 1));
  const [start, setStart] = useState(slot?.start ?? "09:00");
  const [end, setEnd] = useState(() => endAfter(slot?.start ?? "09:00"));
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [onBehalfOf, setOnBehalfOf] = useState("");
  const [preview, setPreview] = useState<BookingPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setItemIds(initialItemIds), [initialItemIds]);
  useEffect(() => {
    if (!slot) return;
    setDate(slot.date);
    setStart(slot.start);
    setEnd(endAfter(slot.start));
  }, [slot]);

  const wholeRoom = itemIds.length === 1 && itemIds[0] === lab.id;
  const input = useMemo(
    () => ({
      itemIds,
      date,
      start,
      end,
      title: title.trim() || "Booking",
      participantCount: participants ? Number(participants) : undefined,
      onBehalfOfNote: onBehalfOf.trim() || undefined,
    }),
    [itemIds, date, start, end, title, participants, onBehalfOf],
  );

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!itemIds.length || !date || !start || !end) return;
    if (minutesOf(end) <= minutesOf(start)) {
      setPreviewError("A booking must end after it starts.");
      return;
    }
    const timer = setTimeout(() => {
      api
        .post<BookingPreviewDto>("/scheduling/bookings/preview", input)
        .then(setPreview)
        .catch((e) => setPreviewError(errorText(e, "Could not check this slot")));
    }, 250);
    return () => clearTimeout(timer);
  }, [input, itemIds.length, date, start, end]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<ReservationDto>("/scheduling/bookings", { ...input, title: title.trim() });
      setTitle("");
      setOnBehalfOf("");
      setParticipants("");
      onBooked(created);
    } catch (e) {
      setError(errorText(e, "Could not book this"));
    } finally {
      setBusy(false);
    }
  }

  function toggleMachine(id: string) {
    const machines = itemIds.filter((x) => x !== lab.id);
    setItemIds(machines.includes(id) ? machines.filter((x) => x !== id) : [...machines, id]);
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-6">
        <div className={labelClass}>What</div>
        <label className="flex items-center gap-6 text-11">
          <input type="radio" checked={wholeRoom} onChange={() => setItemIds([lab.id])} />
          The whole room — {lab.name}
        </label>
        {lab.equipment.length > 0 && (
          <>
            <label className="flex items-center gap-6 text-11">
              <input type="radio" checked={!wholeRoom} onChange={() => setItemIds(lab.equipment.slice(0, 1).map((e) => e.id))} />
              Specific machines
            </label>
            {!wholeRoom && (
              <div className="flex flex-wrap gap-6 pl-18 max-h-[140px] overflow-y-auto">
                {lab.equipment.map((m) => (
                  <label key={m.id} className={`flex items-center gap-4 rounded-2 border px-6 py-3 text-10.5 cursor-pointer ${itemIds.includes(m.id) ? "border-accent bg-soft" : "border-border2"}`}>
                    <input type="checkbox" checked={itemIds.includes(m.id)} onChange={() => toggleMachine(m.id)} />
                    {m.name}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-8">
        <label className="flex flex-col gap-4">
          <span className={labelClass}>Date</span>
          <input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-4">
          <span className={labelClass}>From</span>
          <input type="time" value={start} step={900} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-4">
          <span className={labelClass}>To</span>
          <input type="time" value={end} step={900} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </label>
      </div>

      <label className="flex flex-col gap-4">
        <span className={labelClass}>For</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Thesis simulations, SE401 group project" className={inputClass} />
      </label>
      <div className="flex flex-wrap gap-8">
        <label className="flex flex-col gap-4 w-[120px]">
          <span className={labelClass}>People</span>
          <input type="number" min={1} value={participants} onChange={(e) => setParticipants(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-4 flex-1 min-w-[200px]">
          <span className={labelClass}>On behalf of students (optional)</span>
          <input value={onBehalfOf} onChange={(e) => setOnBehalfOf(e.target.value)} placeholder="Advisees' names or IDs" className={inputClass} />
        </label>
      </div>

      <div className="text-10.5 border border-border2 rounded-2 px-8 py-6 flex flex-col gap-6">
        {previewError ? (
          <span className="text-bad">{previewError}</span>
        ) : !preview ? (
          <span className="text-faint">Checking the calendar…</span>
        ) : preview.blocking.length ? (
          <ClashList clashes={preview.blocking} heading="Already taken" />
        ) : (
          <>
            <span className="text-good">
              Free. {preview.autoConfirm ? "Confirms immediately — this is your room." : `Waits for ${preview.custodianName || "the custodian"} to approve.`}
            </span>
            <ClashList clashes={preview.contending} heading="Others have also asked for this time" />
          </>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      <div>
        <Button variant="primary" onClick={submit} disabled={busy || !title.trim() || !itemIds.length || !preview || preview.blocking.length > 0}>
          {busy ? "Booking…" : preview?.autoConfirm ? "Book" : "Request booking"}
        </Button>
      </div>
    </div>
  );
}

function endAfter(start: string): string {
  const m = Math.min(minutesOf(start) + 120, 23 * 60 + 45);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ── Weekly class slots ───────────────────────────────────────────────────────

function SeriesModal({ lab, onClose, onSaved }: { lab: SchedulingLabDto; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [section, setSection] = useState("");
  const [instructor, setInstructor] = useState("");
  const [participants, setParticipants] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("10:00");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(addDays(today(), 7 * 16));
  const [equipment, setEquipment] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<ClashDto[]>([]);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setClashes([]);
    try {
      await api.post("/scheduling/series", {
        labItemId: lab.id,
        title: title.trim(),
        section: section.trim() || undefined,
        instructorName: instructor.trim() || undefined,
        participantCount: participants ? Number(participants) : undefined,
        weekdays,
        startTimeLocal: startTime,
        endTimeLocal: endTime,
        startDate,
        endDate,
        equipmentItemIds: equipment,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errorText(e, "Could not add this class"));
      setClashes(clashesOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Weekly class — ${lab.name}`} onClose={onClose} width="520px">
      <div className="flex flex-wrap gap-8">
        <label className="flex flex-col gap-4 flex-1 min-w-[200px]">
          <span className={labelClass}>Course</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SE3102 Operating Systems Lab" className={inputClass} />
        </label>
        <label className="flex flex-col gap-4 w-[90px]">
          <span className={labelClass}>Section</span>
          <input value={section} onChange={(e) => setSection(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="flex flex-wrap gap-8">
        <label className="flex flex-col gap-4 flex-1 min-w-[200px]">
          <span className={labelClass}>Instructor</span>
          <input value={instructor} onChange={(e) => setInstructor(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-4 w-[90px]">
          <span className={labelClass}>Students</span>
          <input type="number" min={1} value={participants} onChange={(e) => setParticipants(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="flex flex-col gap-4">
        <span className={labelClass}>Every</span>
        <div className="flex flex-wrap gap-4">
          {WEEKDAYS.map(([n, label]) => (
            <label key={n} className={`flex items-center gap-4 rounded-2 border px-6 py-3 text-10.5 cursor-pointer ${weekdays.includes(n) ? "border-accent bg-soft" : "border-border2"}`}>
              <input type="checkbox" checked={weekdays.includes(n)} onChange={() => setWeekdays(weekdays.includes(n) ? weekdays.filter((w) => w !== n) : [...weekdays, n].sort())} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-8">
        <label className="flex flex-col gap-4">
          <span className={labelClass}>From</span>
          <input type="time" value={startTime} step={900} onChange={(e) => setStartTime(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-4">
          <span className={labelClass}>To</span>
          <input type="time" value={endTime} step={900} onChange={(e) => setEndTime(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-4">
          <span className={labelClass}>First date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-4">
          <span className={labelClass}>Last date</span>
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
        </label>
      </div>
      {lab.equipment.length > 0 && (
        <div className="flex flex-col gap-4">
          <span className={labelClass}>Also claims these machines (optional — the room already covers everything in it)</span>
          <div className="flex flex-wrap gap-4 max-h-[120px] overflow-y-auto">
            {lab.equipment.map((m) => (
              <label key={m.id} className={`flex items-center gap-4 rounded-2 border px-6 py-3 text-10.5 cursor-pointer ${equipment.includes(m.id) ? "border-accent bg-soft" : "border-border2"}`}>
                <input type="checkbox" checked={equipment.includes(m.id)} onChange={() => setEquipment(equipment.includes(m.id) ? equipment.filter((x) => x !== m.id) : [...equipment, m.id])} />
                {m.name}
              </label>
            ))}
          </div>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <ClashList clashes={clashes} heading="Sessions that clash" />
      <div className="flex items-center gap-8">
        <Button variant="primary" onClick={save} disabled={busy || !title.trim() || !weekdays.length}>
          {busy ? "Saving…" : "Add to timetable"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

function SeriesList({ series, onChanged }: { series: ScheduleSeriesDto[]; onChanged: () => void }) {
  const [removing, setRemoving] = useState<ScheduleSeriesDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/scheduling/series/${removing.id}`);
      setRemoving(null);
      onChanged();
    } catch (e) {
      setError(errorText(e, "Could not remove this class"));
    } finally {
      setBusy(false);
    }
  }

  if (!series.length) return <div className="px-14 py-10 text-11 text-dim">No weekly classes yet.</div>;
  return (
    <div className="flex flex-col">
      {series.map((s) => (
        <div key={s.id} className="px-14 py-8 border-b border-border last:border-0 flex items-start gap-10">
          <div className="flex-1">
            <div className="text-11.5 font-medium">
              {s.title}
              {s.section ? ` · ${s.section}` : ""}
            </div>
            <div className="text-10.5 text-dim">
              {s.weekdays.map((w) => WEEKDAYS[w - 1][1]).join(", ")} · <span className="font-mono">{s.startTimeLocal}–{s.endTimeLocal}</span> · {s.startDate} → {s.endDate}
              {s.instructorName ? ` · ${s.instructorName}` : ""}
            </div>
            <div className="text-10 text-faint">
              {s.upcomingCount} upcoming session{s.upcomingCount === 1 ? "" : "s"}
              {s.exceptions.length ? ` · cancelled: ${s.exceptions.map((e) => e.date).join(", ")}` : ""}
            </div>
          </div>
          <button className="text-10.5 text-bad" onClick={() => setRemoving(s)}>
            Remove
          </button>
        </div>
      ))}
      {removing && (
        <ConfirmDialog
          title="Remove this class"
          message={`Every future session of "${removing.title}" leaves the calendar. Sessions already held stay on record.`}
          confirmLabel="Remove"
          busy={busy}
          error={error}
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function useCalendar(labId: string | null, weekStart: string) {
  const [rows, setRows] = useState<ReservationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!labId) return;
    setError(null);
    api
      .get<ReservationDto[]>(`/scheduling/calendar?labItemId=${encodeURIComponent(labId)}&from=${weekStart}&to=${addDays(weekStart, 6)}`)
      .then(setRows)
      .catch((e) => setError(errorText(e, "Could not load the calendar")));
  }, [labId, weekStart]);
  useEffect(load, [load]);
  return { rows, error, reload: load };
}

function MyLabsTab({ labs, reloadLabs }: { labs: SchedulingLabDto[]; reloadLabs: () => void }) {
  const [labId, setLabId] = useState(labs[0]?.id ?? "");
  const lab = labs.find((l) => l.id === labId) ?? labs[0];
  const [weekStart, setWeekStart] = useState(startOfWeek(today()));
  const calendar = useCalendar(lab?.id ?? null, weekStart);
  const [series, setSeries] = useState<ScheduleSeriesDto[] | null>(null);
  const [inbox, setInbox] = useState<ReservationDto[]>([]);
  const [selected, setSelected] = useState<ReservationDto | null>(null);
  const [addingClass, setAddingClass] = useState(false);
  const [booking, setBooking] = useState<{ date: string; start: string } | null>(null);

  const loadSide = useCallback(() => {
    if (!lab) return;
    api.get<ScheduleSeriesDto[]>(`/scheduling/series?labItemId=${encodeURIComponent(lab.id)}`).then(setSeries).catch(() => setSeries([]));
    api
      .get<ReservationDto[]>("/scheduling/bookings?box=inbox")
      .then((rows) => setInbox(rows.filter((r) => r.labItemId === lab.id)))
      .catch(() => setInbox([]));
  }, [lab]);
  useEffect(loadSide, [loadSide]);

  function refresh() {
    calendar.reload();
    loadSide();
    reloadLabs();
  }

  if (!lab) return null;
  return (
    <>
      <Panel
        title="Calendar"
        actions={
          <div className="flex flex-wrap items-center gap-8">
            <select value={lab.id} onChange={(e) => setLabId(e.target.value)} className={inputClass}>
              {labs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.pendingCount ? ` (${l.pendingCount} waiting)` : ""}
                </option>
              ))}
            </select>
            <WeekNav weekStart={weekStart} onChange={setWeekStart} />
          </div>
        }
      >
        <div className="px-14 py-8 flex flex-wrap items-center justify-between gap-8 border-b border-border">
          <CalendarLegend />
          <div className="flex items-center gap-8">
            <Button onClick={() => setBooking({ date: addDays(today(), 1), start: "09:00" })}>Book this room…</Button>
            <Button variant="primary" onClick={() => setAddingClass(true)}>
              Add weekly class…
            </Button>
          </div>
        </div>
        {calendar.error && <ErrorNote>{calendar.error}</ErrorNote>}
        {!calendar.rows ? <PanelLoading rows={6} /> : <WeekCalendar weekStart={weekStart} reservations={calendar.rows} onSelect={setSelected} onSlot={(date, start) => setBooking({ date, start })} />}
      </Panel>

      <Panel title={`Waiting on you (${inbox.length})`}>
        {!inbox.length ? (
          <div className="px-14 py-10 text-11 text-dim">No booking requests for this room.</div>
        ) : (
          inbox.map((r) => (
            <button key={r.id} onClick={() => setSelected(r)} className="w-full text-left px-14 py-8 border-b border-border last:border-0 hover:bg-panel2">
              <div className="text-11.5 font-medium">{r.title}</div>
              <div className="text-10.5 text-dim">
                <span className="font-mono">
                  {r.date} {r.start}–{r.end}
                </span>{" "}
                · {r.resources.map((x) => x.name).join(", ")} · {r.requestedByName}
                {r.onBehalfOfNote ? ` · for ${r.onBehalfOfNote}` : ""}
              </div>
            </button>
          ))
        )}
      </Panel>

      <Panel title="Weekly classes">{series === null ? <PanelLoading rows={2} /> : <SeriesList series={series} onChanged={refresh} />}</Panel>

      {selected && <ReservationModal reservation={selected} onClose={() => setSelected(null)} onChanged={refresh} />}
      {addingClass && <SeriesModal lab={lab} onClose={() => setAddingClass(false)} onSaved={refresh} />}
      {booking && (
        <Modal title={`Book — ${lab.name}`} onClose={() => setBooking(null)} width="560px">
          <BookingForm
            lab={lab}
            initialItemIds={[lab.id]}
            slot={booking}
            onBooked={() => {
              setBooking(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function BookTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookableDto[]>([]);
  const [picked, setPicked] = useState<BookableDto | null>(null);
  const [lab, setLab] = useState<SchedulingLabDto | null>(null);
  const [weekStart, setWeekStart] = useState(startOfWeek(today()));
  const [slot, setSlot] = useState<{ date: string; start: string } | null>(null);
  const [selected, setSelected] = useState<ReservationDto | null>(null);
  const [booked, setBooked] = useState<ReservationDto | null>(null);
  const calendar = useCalendar(lab?.id ?? null, weekStart);
  const initialItemIds = useMemo(() => (picked ? [picked.bookingMode === "ROOM" ? picked.labItemId : picked.id] : []), [picked]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<BookableDto[]>(`/scheduling/bookables?q=${encodeURIComponent(query.trim())}`)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setLab(null);
    if (!picked) return;
    api.get<SchedulingLabDto>(`/scheduling/labs/${picked.labItemId}`).then(setLab).catch(() => setLab(null));
  }, [picked]);

  return (
    <>
      <Panel title="Find a room or machine">
        <div className="px-14 py-10 flex flex-col gap-8">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name — a lab, an oscilloscope, a workstation…" className={inputClass} />
          {results.length > 0 && (
            <div className="border border-border2 rounded-2 max-h-[220px] overflow-y-auto">
              {results.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setPicked(b);
                    setBooked(null);
                  }}
                  className={`w-full text-left px-8 py-6 border-b border-border last:border-0 hover:bg-panel2 ${picked?.id === b.id ? "bg-soft" : ""}`}
                >
                  <div className="text-11">
                    {b.name} <Tag>{b.bookingMode === "ROOM" ? "Room" : b.categoryName}</Tag>
                  </div>
                  <div className="text-9.5 text-faint">
                    {b.bookingMode === "ROOM" ? b.orgNodeName : `in ${b.labName} · ${b.orgNodeName}`} · custodian {b.custodianName}
                  </div>
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && results.length === 0 && <div className="text-10.5 text-faint">Nothing bookable matches.</div>}
        </div>
      </Panel>

      {picked && lab && (
        <>
          <Panel title={`${lab.name} — this week`} actions={<WeekNav weekStart={weekStart} onChange={setWeekStart} />}>
            <div className="px-14 py-8 border-b border-border">
              <CalendarLegend />
            </div>
            {calendar.error && <ErrorNote>{calendar.error}</ErrorNote>}
            {!calendar.rows ? <PanelLoading rows={6} /> : <WeekCalendar weekStart={weekStart} reservations={calendar.rows} onSelect={setSelected} onSlot={(date, start) => setSlot({ date, start })} />}
          </Panel>
          <Panel title="Your booking">
            <div className="px-14 py-12">
              {booked ? (
                <div className="flex flex-col gap-8 text-11">
                  <span>
                    {booked.state === "CONFIRMED" ? "Booked." : `Requested — ${lab.custodianName} decides.`} {booked.title}, <span className="font-mono">{booked.date} {booked.start}–{booked.end}</span>.
                  </span>
                  <div>
                    <Button onClick={() => setBooked(null)}>Book another time</Button>
                  </div>
                </div>
              ) : (
                <BookingForm
                  lab={lab}
                  initialItemIds={initialItemIds}
                  slot={slot}
                  onBooked={(r) => {
                    setBooked(r);
                    calendar.reload();
                  }}
                />
              )}
            </div>
          </Panel>
        </>
      )}
      {selected && <ReservationModal reservation={selected} onClose={() => setSelected(null)} onChanged={calendar.reload} />}
    </>
  );
}

function MyBookingsTab() {
  const [rows, setRows] = useState<ReservationDto[] | null>(null);
  const [selected, setSelected] = useState<ReservationDto | null>(null);
  const load = useCallback(() => {
    api.get<ReservationDto[]>("/scheduling/bookings?box=mine").then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  return (
    <Panel title="My bookings">
      {rows === null ? (
        <PanelLoading rows={3} />
      ) : !rows.length ? (
        <div className="px-14 py-10 text-11 text-dim">You haven't booked anything yet.</div>
      ) : (
        rows.map((r) => (
          <button key={r.id} onClick={() => setSelected(r)} className="w-full text-left px-14 py-8 border-b border-border last:border-0 hover:bg-panel2 flex items-start gap-10">
            <div className="flex-1">
              <div className="text-11.5 font-medium">{r.title}</div>
              <div className="text-10.5 text-dim">
                <span className="font-mono">
                  {r.date} {r.start}–{r.end}
                </span>{" "}
                · {r.labName} · {r.resources.map((x) => x.name).join(", ")}
              </div>
            </div>
            <Tag tone={stateTone(r.state)}>{STATE_LABEL[r.state]}</Tag>
          </button>
        ))
      )}
      {selected && <ReservationModal reservation={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </Panel>
  );
}

type Tab = "labs" | "book" | "mine";

export default function SchedulePage() {
  const [labs, setLabs] = useState<SchedulingLabDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  const loadLabs = useCallback(() => {
    api
      .get<SchedulingLabDto[]>("/scheduling/labs")
      .then((rows) => {
        setLabs(rows);
        setTab((t) => t ?? (rows.length ? "labs" : "book"));
      })
      .catch((e) => {
        setError(errorText(e, "Could not load your rooms"));
        setLabs([]);
        setTab((t) => t ?? "book");
      });
  }, []);
  useEffect(loadLabs, [loadLabs]);

  const tabs: Array<[Tab, string]> = [...(labs?.length ? ([["labs", "My labs"]] as Array<[Tab, string]>) : []), ["book", "Book"], ["mine", "My bookings"]];

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-4">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ background: tab === t ? "var(--accent)" : "var(--panel2)", color: tab === t ? "#fff" : "var(--dim)" }}
            className="border-0 text-11 font-medium px-10 py-5 rounded-2"
          >
            {label}
          </button>
        ))}
      </div>
      {labs === null || tab === null ? (
        <PanelLoading rows={4} />
      ) : tab === "labs" && labs.length ? (
        <MyLabsTab labs={labs} reloadLabs={loadLabs} />
      ) : tab === "mine" ? (
        <MyBookingsTab />
      ) : (
        <BookTab />
      )}
    </Screen>
  );
}

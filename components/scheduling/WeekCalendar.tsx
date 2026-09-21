"use client";

import type { ReservationDto } from "@/lib/shared";
import { addDays, instantToCivil, minutesOf } from "@/lib/domain/civil-time";
import { Button } from "@/components/ui";

const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const HOUR_PX = 38;

export const SOURCE_LABEL: Record<ReservationDto["source"], string> = { CLASS: "Class", STAFF: "Staff booking", EXTERNAL: "External", MAINTENANCE: "Maintenance" };
export const STATE_LABEL: Record<ReservationDto["state"], string> = {
  REQUESTED: "Awaiting custodian",
  HELD: "Held",
  CONFIRMED: "Confirmed",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/** Colour says what kind of use it is; a dashed edge says it is not settled yet. */
function blockClass(r: ReservationDto): string {
  const pending = r.state === "REQUESTED" || r.state === "HELD";
  const tone =
    r.source === "CLASS" ? "bg-soft border-accent text-accent" : r.source === "EXTERNAL" ? "bg-crossbg border-cross text-cross" : r.source === "MAINTENANCE" ? "bg-panel3 border-border2 text-dim" : "bg-goodbg border-good text-good";
  return `${tone} ${pending ? "border-dashed opacity-80" : ""}`;
}

/** Greedy lanes, so overlapping blocks within a day sit side by side instead of on top
 *  of each other (contending requests do overlap). */
function lanesFor(rows: ReservationDto[]): Map<string, { lane: number; lanes: number }> {
  const sorted = [...rows].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const laneEnds: string[] = [];
  const laneOf = new Map<string, number>();
  for (const r of sorted) {
    let lane = laneEnds.findIndex((end) => end <= r.startsAt);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(r.endsAt);
    } else laneEnds[lane] = r.endsAt;
    laneOf.set(r.id, lane);
  }
  const out = new Map<string, { lane: number; lanes: number }>();
  for (const r of sorted) out.set(r.id, { lane: laneOf.get(r.id)!, lanes: Math.max(1, laneEnds.length) });
  return out;
}

export function WeekNav({ weekStart, onChange }: { weekStart: string; onChange: (weekStart: string) => void }) {
  const today = instantToCivil(new Date()).date;
  return (
    <div className="flex items-center gap-6">
      <Button onClick={() => onChange(addDays(weekStart, -7))}>‹</Button>
      <Button onClick={() => onChange(addDays(today, 1 - weekdayIndex(today)))}>This week</Button>
      <Button onClick={() => onChange(addDays(weekStart, 7))}>›</Button>
      <span className="text-10.5 text-dim font-mono">
        {weekStart} – {addDays(weekStart, 6)}
      </span>
    </div>
  );
}

function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/**
 * One room's week, 07:00–21:00 in the venue's local time. Blocks come positioned from
 * each reservation's own civil start/end (already converted server-side), so nothing
 * here does time-zone arithmetic of its own. Clicking empty space offers that hour.
 */
export function WeekCalendar({
  weekStart,
  reservations,
  onSelect,
  onSlot,
}: {
  weekStart: string;
  reservations: ReservationDto[];
  onSelect?: (r: ReservationDto) => void;
  onSlot?: (date: string, start: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = instantToCivil(new Date()).date;
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const height = hours.length * HOUR_PX;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid border-b border-border" style={{ gridTemplateColumns: `44px repeat(7, 1fr)` }}>
          <div />
          {days.map((d, i) => (
            <div key={d} className={`px-6 py-6 text-10 border-l border-border ${d === today ? "text-accent font-semibold" : "text-dim"}`}>
              {DAY_LABEL[i]} <span className="font-mono">{d.slice(5)}</span>
            </div>
          ))}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `44px repeat(7, 1fr)` }}>
          <div className="relative" style={{ height }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-4 text-9.5 text-faint font-mono" style={{ top: i * HOUR_PX - 5 }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayRows = reservations.filter((r) => r.date === d);
            const lanes = lanesFor(dayRows);
            return (
              <div
                key={d}
                className="relative border-l border-border"
                style={{ height }}
                onClick={(e) => {
                  if (!onSlot || e.target !== e.currentTarget) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const hour = FIRST_HOUR + Math.floor((e.clientY - rect.top) / HOUR_PX);
                  onSlot(d, `${String(Math.min(hour, LAST_HOUR - 1)).padStart(2, "0")}:00`);
                }}
              >
                {hours.map((h, i) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border pointer-events-none" style={{ top: i * HOUR_PX }} />
                ))}
                {dayRows.map((r) => {
                  const top = Math.max(0, ((minutesOf(r.start) - FIRST_HOUR * 60) / 60) * HOUR_PX);
                  const bottom = Math.min(height, ((minutesOf(r.end) - FIRST_HOUR * 60) / 60) * HOUR_PX);
                  const { lane, lanes: count } = lanes.get(r.id)!;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onSelect?.(r)}
                      title={`${r.title} · ${r.start}–${r.end} · ${STATE_LABEL[r.state]}`}
                      className={`absolute border rounded-2 px-4 py-2 text-left overflow-hidden text-9.5 leading-tight ${blockClass(r)}`}
                      style={{ top, height: Math.max(16, bottom - top - 1), left: `calc(${(lane / count) * 100}% + 1px)`, width: `calc(${100 / count}% - 2px)` }}
                    >
                      <div className="font-semibold truncate">{r.title}</div>
                      <div className="font-mono truncate">
                        {r.start}–{r.end}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CalendarLegend() {
  const items: Array<[string, string]> = [
    ["bg-soft border-accent", "Class"],
    ["bg-goodbg border-good", "Staff booking"],
    ["bg-crossbg border-cross", "External"],
    ["bg-panel2 border-border2 border-dashed", "Not settled yet"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-10 text-10 text-dim">
      {items.map(([cls, label]) => (
        <span key={label} className="flex items-center gap-4">
          <span className={`inline-block w-10 h-10 border rounded-1 ${cls}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

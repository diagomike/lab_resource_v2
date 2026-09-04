"use client";

import { useState } from "react";

export interface DashboardChartSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Dependency-free SVG donut adapted from temp_works. Both the marks and legend
 * entries drill into the shared dashboard/register filter state. */
export function DashboardDonut({
  segments,
  centerValue,
  centerLabel,
  activeKeys,
  onSelect,
}: {
  segments: DashboardChartSegment[];
  centerValue: string;
  centerLabel: string;
  activeKeys: string[];
  onSelect: (key: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const size = 170;
  const thickness = 21;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;

  return (
    <div className="flex flex-col items-center gap-14 p-14 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-label="Resources by condition">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--panel3)" strokeWidth={thickness} />
          {segments.map((segment, index) => {
            const length = (segment.value / total) * circumference;
            const offset = segments
              .slice(0, index)
              .reduce((sum, previous) => sum + (previous.value / total) * circumference, 0);
            const active = activeKeys.includes(segment.key);
            return (
              <circle
                key={segment.key}
                role="button"
                tabIndex={0}
                aria-label={`Filter by ${segment.label}: ${segment.value}`}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={hovered === segment.key || active ? thickness + 4 : thickness}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                className={`cursor-pointer transition-all ${hovered && hovered !== segment.key ? "opacity-40" : ""}`}
                onMouseEnter={() => setHovered(segment.key)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect(segment.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(segment.key);
                  }
                }}
              >
                <title>{`${segment.label}: ${segment.value} (${Math.round((segment.value / total) * 100)}%)`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-21 font-semibold">{centerValue}</div>
          <div className="text-10 text-faint">{centerLabel}</div>
        </div>
      </div>

      <div className="w-full min-w-0 flex-1 space-y-3">
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            onClick={() => onSelect(segment.key)}
            onMouseEnter={() => setHovered(segment.key)}
            onMouseLeave={() => setHovered(null)}
            className={`flex w-full items-center gap-7 rounded-2 px-7 py-5 text-left text-10.5 hover:bg-panel2 ${
              activeKeys.includes(segment.key) ? "bg-sel" : ""
            }`}
          >
            <span className="size-8 shrink-0 rounded-1" style={{ background: segment.color }} />
            <span className="min-w-0 flex-1 truncate">{segment.label}</span>
            <span className="font-mono font-medium">{segment.value}</span>
            <span className="w-32 text-right font-mono text-9.5 text-faint">{Math.round((segment.value / total) * 100)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface DashboardRankedRow {
  key: string;
  label: string;
  value: number;
  color?: string;
}

export function DashboardRankedBars({
  rows,
  activeKeys,
  onSelect,
  emptyText = "Nothing to show.",
}: {
  rows: DashboardRankedRow[];
  activeKeys: string[];
  onSelect: (key: string) => void;
  emptyText?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) return <div className="px-14 py-24 text-center text-11 text-faint">{emptyText}</div>;

  return (
    <div className="space-y-7 p-14">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={() => onSelect(row.key)}
          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-10 rounded-2 px-7 py-5 text-left hover:bg-panel2 ${
            activeKeys.includes(row.key) ? "bg-sel" : ""
          }`}
        >
          <span className="min-w-0">
            <span className="mb-5 block truncate text-10.5">{row.label}</span>
            <span className="block h-5 w-full overflow-hidden rounded-full bg-panel3">
              <span
                className="block h-full rounded-full transition-all"
                style={{ width: `${(row.value / max) * 100}%`, background: row.color ?? "var(--accent)" }}
              />
            </span>
          </span>
          <span className="font-mono text-11 font-medium">{row.value}</span>
        </button>
      ))}
    </div>
  );
}

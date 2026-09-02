"use client";

import { useState } from "react";
import { CONTROL_CLASS, Dropdown } from "./Dropdown";
import type { Option } from "./types";

/**
 * The tablecn-style replacement for a bare native `<select>`: search-to-narrow, a checkbox
 * per value with its live row count, several values checked at once, and an inline Clear.
 *
 * Lifted from the original DataTable, with two changes — it now takes its options
 * pre-counted from facets.ts (which counts against rows surviving the OTHER filters, not
 * against everything), and `single` mode serves the `select` variant, where the operator is
 * `eq`/`ne` and exactly one value can be chosen.
 */
export function FacetedFilter({
  options,
  selected,
  onChange,
  single = false,
  placeholder = "any",
  width = "220px",
}: {
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  single?: boolean;
  placeholder?: string;
  width?: string;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  return (
    <Dropdown
      width={width}
      trigger={() => (
        <span className={CONTROL_CLASS}>
          <span className={`truncate ${selected.length > 0 ? "text-text" : ""}`}>{summary}</span>
          <span className="opacity-60 shrink-0">▾</span>
        </span>
      )}
    >
      {(close) => (
        <>
          {options.length > 6 && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search values…"
              className="w-full bg-panel2 border-b border-border px-8 h-24 text-10.5 outline-none"
            />
          )}
          <div className="max-h-[220px] overflow-y-auto">
            {filtered.length === 0 && <div className="px-8 py-8 text-10.5 text-faint">No values</div>}
            {filtered.map((o) => {
              const checked = selected.includes(o.value);
              return (
                <label
                  key={o.value}
                  className="flex items-center gap-6 px-8 py-6 text-10.5 hover:bg-panel3 cursor-pointer"
                >
                  <input
                    type={single ? "radio" : "checkbox"}
                    checked={checked}
                    onChange={() => {
                      if (single) {
                        onChange(checked ? [] : [o.value]);
                        close();
                      } else {
                        onChange(checked ? selected.filter((v) => v !== o.value) : [...selected, o.value]);
                      }
                    }}
                  />
                  <span className="flex-1 truncate">{o.label}</span>
                  {/* A count of 0 stays visible for an explicitly-supplied option list, so a
                      status nobody currently holds still reads as "none right now" rather
                      than vanishing. Derived option lists never produce a 0 at all. */}
                  <span className={`text-9 font-mono ${o.count === 0 ? "text-faint opacity-50" : "text-faint"}`}>
                    {o.count}
                  </span>
                </label>
              );
            })}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onChange([]);
                close();
              }}
              className="w-full text-center border-t border-border py-5 text-10 text-accent hover:bg-panel2"
            >
              Clear
            </button>
          )}
        </>
      )}
    </Dropdown>
  );
}

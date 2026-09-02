"use client";

import { useEffect, useRef, useState } from "react";

export interface EntityOption {
  id: string;
  label: string;
  sublabel?: string;
}

/**
 * A searchable id-picker for admin assignment actions — replaces the prompt()-based
 * "paste the id from this list" flow DepartmentsPage/PersonnelPage/ApprovalNetworkPage
 * used to resort to. Type to filter, click to select. Not a full combobox widget library,
 * matching the same "narrow enough not to need one" call ComboBox.tsx already made for
 * free-text fields — this one just picks an id instead of committing free text.
 */
export function EntityPicker({
  options,
  value,
  onSelect,
  placeholder = "Search…",
  clearLabel = "None (vacate)",
}: {
  options: EntityOption[];
  value: string | null;
  onSelect: (id: string | null) => void;
  placeholder?: string;
  clearLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selected = options.find((o) => o.id === value) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
    : options;

  return (
    <div ref={boxRef} className="relative">
      <input
        value={open ? query : (selected?.label ?? "")}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        placeholder={selected ? selected.label : placeholder}
        className="w-full bg-panel2 border border-border2 rounded-2 h-28 pl-9 pr-26 text-12 outline-none focus:border-accent cursor-pointer"
      />
      {/* Without this the control is visually indistinguishable from a plain text box —
          it types-to-filter, but nothing said so before you clicked in. */}
      <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-9 text-faint">▾</span>
      {open && (
        <div className="absolute z-20 mt-2 w-full max-h-[240px] overflow-y-auto bg-panel border border-border2 rounded-2">
          {value && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(null);
                setOpen(false);
                setQuery("");
              }}
              className="w-full text-left px-9 py-6 text-11 text-faint italic hover:bg-panel3 border-b border-border"
            >
              {clearLabel}
            </button>
          )}
          {filtered.length === 0 && <div className="px-9 py-8 text-11 text-faint">No matches</div>}
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(o.id);
                setOpen(false);
                setQuery("");
              }}
              className="w-full text-left px-9 py-6 text-11.5 hover:bg-panel3 flex items-center justify-between gap-8"
            >
              <span>{o.label}</span>
              {o.sublabel && <span className="text-9.5 text-faint font-mono">{o.sublabel}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { normalizeKey } from "@/lib/domain/filters";

/** One key the search understands: `@key` / `@key:value`. */
export interface SearchKey {
  key: string;
  label: string;
  /** Where it comes from — "Computer, Monitor", "custom property", "built-in". */
  hint: string;
  /** Known values to suggest after `@key:` (fixed options, categories, statuses). */
  values?: string[];
}

/** The `@…` word the cursor is in, if any: its span, and whether it is the key or the value part. */
function tokenAt(text: string, caret: number): { start: number; end: number; key: string; value: string | null } | null {
  let start = caret;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end++;
  const word = text.slice(start, end);
  if (!word.startsWith("@")) return null;
  const colon = word.indexOf(":");
  if (colon === -1) return { start, end, key: word.slice(1), value: null };
  return { start, end, key: word.slice(1, colon), value: word.slice(colon + 1).replace(/^"/, "") };
}

/**
 * The register's search box. Plain words search names and every field value, as
 * before; `@serial` finds items whose Serial is filled in, and `@serial:EXN` those
 * whose serial contains "EXN" (lib/domain/filters.ts's `parseSearch`). Typing `@`
 * suggests the keys there are, and `@key:` the values a fixed-choice field allows;
 * arrows move, Enter or Tab takes one, Esc closes.
 */
export function KeySearchInput({ value, onChange, keys }: { value: string; onChange: (v: string) => void; keys: SearchKey[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Focus events can be missed (a background window); being the active element is enough.
  const isFocused = focused || (typeof document !== "undefined" && document.activeElement === inputRef.current && inputRef.current !== null);
  const token = isFocused ? tokenAt(value, caret) : null;

  const suggestions = useMemo(() => {
    if (!token) return [];
    if (token.value === null) {
      const needle = normalizeKey(token.key);
      const scored = keys
        .map((k) => {
          const nk = normalizeKey(k.key);
          const nl = normalizeKey(k.label);
          const rank = !needle ? 1 : nk.startsWith(needle) || nl.startsWith(needle) ? 0 : nk.includes(needle) || nl.includes(needle) ? 1 : 2;
          return { k, rank };
        })
        .filter((x) => x.rank < 2)
        .sort((a, b) => a.rank - b.rank || a.k.key.localeCompare(b.k.key));
      return scored.slice(0, 12).map(({ k }) => ({ id: `k:${k.key}`, primary: `@${k.key}`, secondary: k.label.toLowerCase() === k.key.toLowerCase() ? k.hint : `${k.label} · ${k.hint}`, insert: `@${k.key}:` }));
    }
    const def = keys.find((k) => normalizeKey(k.key) === normalizeKey(token.key));
    const needle = token.value.toLowerCase();
    return (def?.values ?? [])
      .filter((v) => v.toLowerCase().includes(needle))
      .slice(0, 12)
      .map((v) => ({ id: `v:${v}`, primary: v, secondary: `@${def!.key}`, insert: `@${def!.key}:${/\s/.test(v) ? `"${v}"` : v} ` }));
  }, [token?.key, token?.value, token === null, keys]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = Boolean(token) && !dismissed && suggestions.length > 0;

  function syncCaret() {
    setCaret(inputRef.current?.selectionStart ?? value.length);
  }

  function accept(i: number) {
    const s = suggestions[i];
    if (!s || !token) return;
    const next = value.slice(0, token.start) + s.insert + value.slice(token.end).replace(/^\s+/, "");
    onChange(next);
    const pos = token.start + s.insert.length;
    setActive(0);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(active);
    } else if (e.key === "Escape") {
      setDismissed(true);
    }
  }

  return (
    <div className="relative w-[260px]">
      <input
        ref={inputRef}
        placeholder="Search…  or @serial:ABC"
        title={"Search names and values. @key matches a field: @serial (filled in), @serial:ABC (contains ABC), @brand:\"HP Inc\"."}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissed(false);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onFocus={() => {
          setFocused(true);
          syncCaret();
        }}
        onBlur={() => setFocused(false)}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className="h-24 w-full px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
      />
      {open && (
        <div role="listbox" className="absolute left-0 top-full z-50 mt-2 w-[320px] max-h-[280px] overflow-y-auto rounded-2 border border-border2 bg-panel p-3">
          <div className="px-7 pb-3 pt-2 text-9.5 uppercase tracking-label text-faint">
            {token?.value === null ? "Fields you can search by" : `Values of @${token?.key}`}
          </div>
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => accept(i)}
              className={`flex w-full items-baseline gap-8 rounded-2 px-7 py-4 text-left ${i === active ? "bg-panel2" : ""}`}
            >
              <span className="flex-none font-mono text-11 text-accent">{s.primary}</span>
              <span className="min-w-0 flex-1 truncate text-10 text-faint">{s.secondary}</span>
            </button>
          ))}
          <div className="px-7 pb-2 pt-4 text-9.5 text-faint">↑↓ to move · Enter or Tab to choose · Esc to close</div>
        </div>
      )}
    </div>
  );
}

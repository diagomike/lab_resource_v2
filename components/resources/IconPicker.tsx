"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, type LucideIcon } from "lucide-react";
import { CATEGORY_ICONS, categoryIconFor, iconSearchText } from "@/lib/domain/icons";

/** Lucide's whole icon map, loaded on first need and shared — the curated set in
 *  lib/domain/icons.ts covers what the register renders day to day, so most pages
 *  never fetch this chunk at all. */
let allIcons: Record<string, LucideIcon> | null = null;
let allIconsPromise: Promise<Record<string, LucideIcon>> | null = null;
function loadAllIcons(): Promise<Record<string, LucideIcon>> {
  if (allIcons) return Promise.resolve(allIcons);
  allIconsPromise ??= import("lucide-react").then((m) => (allIcons = m.icons as unknown as Record<string, LucideIcon>));
  return allIconsPromise;
}

function useAllIcons(enabled: boolean): Record<string, LucideIcon> | null {
  const [map, setMap] = useState(allIcons);
  useEffect(() => {
    if (!enabled || map) return;
    let live = true;
    loadAllIcons().then((m) => live && setMap(m));
    return () => {
      live = false;
    };
  }, [enabled, map]);
  return map;
}

/** Renders one category's icon — every place a category icon renders uses this, so
 *  sizing and the fallback stay in one place. A key outside the curated set is any
 *  other lucide icon: it renders the generic package glyph until the full set loads. */
export function CategoryIcon({ iconKey, className = "size-4" }: { iconKey?: string; className?: string }) {
  const curated = Boolean(iconKey && CATEGORY_ICONS[iconKey]);
  const all = useAllIcons(Boolean(iconKey) && !curated);
  const Icon = curated ? categoryIconFor(iconKey) : (iconKey && all?.[iconKey]) || categoryIconFor(undefined);
  return <Icon className={className} />;
}

const MAX_SHOWN = 150;

/**
 * Any lucide icon, found by typing — each option shows the icon beside its name, like
 * Add resources' category picker. Searches the name's words plus a small synonym list
 * (lib/domain/icons.ts) so "curtain" finds Blinds. The server validates the chosen key
 * against the same full set.
 */
export function IconPicker({ value, onChange }: { value: string; onChange: (iconKey: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const all = useAllIcons(open);

  const names = useMemo(() => (all ? Object.keys(all).sort() : []), [all]);
  const matches = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      // Empty query: the curated, register-friendly set first, then everything else.
      const curated = Object.keys(CATEGORY_ICONS).sort();
      return [...curated, ...names.filter((n) => !CATEGORY_ICONS[n])];
    }
    return names.filter((n) => {
      const hay = iconSearchText(n);
      return words.every((w) => hay.includes(w));
    });
  }, [names, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as globalThis.Node;
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 3, left: r.left, width: Math.max(r.width, 300) });
    };
    place();
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function choose(name: string) {
    onChange(name);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (open) e.preventDefault(); // closes the list, not the dialog around it
      return setOpen(false);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.min(matches.length, MAX_SHOWN) - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    }
  }

  const shown = matches.slice(0, MAX_SHOWN);

  return (
    <div ref={rootRef} className="flex items-center gap-6">
      <span className="w-24 h-24 flex items-center justify-center rounded-2 border border-border2 bg-panel2 flex-none">
        <CategoryIcon iconKey={value} className="size-14" />
      </span>
      <div className={`flex flex-1 items-center rounded-2 border bg-panel ${open ? "border-accent" : "border-border2"}`}>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          value={open ? query : value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={open ? "Search icons — e.g. curtain, water, computer…" : "Choose an icon"}
          className="h-24 min-w-0 flex-1 bg-transparent px-8 text-11 outline-none"
        />
        <button type="button" aria-label="Open icon list" onClick={() => (setOpen((o) => !o), inputRef.current?.focus())} className="grid h-24 w-26 place-items-center text-faint hover:text-text">
          <ChevronsUpDown className="size-12" />
        </button>
      </div>
      {open &&
        pos &&
        createPortal(
          <div ref={panelRef} role="listbox" className="fixed z-[70] max-h-[300px] overflow-y-auto rounded-2 border border-border2 bg-panel p-3" style={pos}>
            {!all ? (
              <div className="px-8 py-8 text-10.5 text-faint">Loading icons…</div>
            ) : shown.length === 0 ? (
              <div className="px-8 py-8 text-10.5 text-faint">No icon matches “{query}”.</div>
            ) : (
              <>
                {shown.map((name, i) => {
                  const Icon = all[name];
                  return (
                    <button
                      key={name}
                      type="button"
                      role="option"
                      aria-selected={name === value}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(name)}
                      className={`flex w-full items-center gap-8 rounded-2 px-7 py-5 text-left text-11 ${i === active ? "bg-panel2" : "hover:bg-panel2"}`}
                    >
                      <Check className={`size-11 flex-none ${name === value ? "text-accent" : "opacity-0"}`} />
                      <Icon className="size-14 flex-none text-dim" />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                    </button>
                  );
                })}
                {matches.length > MAX_SHOWN && (
                  <div className="px-8 py-6 text-10 text-faint">
                    {matches.length - MAX_SHOWN} more — keep typing to narrow down.
                  </div>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, ChevronsUpDown } from "lucide-react";
import { CategoryIcon } from "@/components/resources/IconPicker";

/** One choosable option. `ancestors` is its chain of containers, root first — they
 *  appear as tree rows too, but only as structure (not choosable) unless they are
 *  options themselves. */
export interface TreeOption {
  id: string;
  label: string;
  iconKey?: string;
  /** Faint right-hand note (a category, a unit kind…). */
  hint?: string;
  ancestors: Array<{ id: string; label: string; iconKey?: string }>;
}

interface Node {
  id: string;
  label: string;
  iconKey?: string;
  hint?: string;
  selectable: boolean;
  children: Node[];
  depth: number;
}

/** Options → a forest, nesting every option under its ancestors (shared ancestors are
 *  one row). Siblings sort by label, numerically aware ("Lab 2" before "Lab 10"). */
function buildForest(options: TreeOption[]): Node[] {
  const byId = new Map<string, Node>();
  const roots: Node[] = [];
  const attach = (node: Node, parentId: string | null) => {
    if (parentId) byId.get(parentId)!.children.push(node);
    else roots.push(node);
  };
  const ensure = (id: string, label: string, iconKey: string | undefined, parentId: string | null): Node => {
    let n = byId.get(id);
    if (!n) {
      n = { id, label, iconKey, selectable: false, children: [], depth: 0 };
      byId.set(id, n);
      attach(n, parentId);
    }
    return n;
  };
  for (const o of options) {
    let parentId: string | null = null;
    for (const a of o.ancestors) {
      ensure(a.id, a.label, a.iconKey, parentId);
      parentId = a.id;
    }
    const n = ensure(o.id, o.label, o.iconKey, parentId);
    n.selectable = true;
    n.label = o.label;
    n.iconKey = o.iconKey ?? n.iconKey;
    n.hint = o.hint;
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const sort = (nodes: Node[], depth: number) => {
    nodes.sort((a, b) => collator.compare(a.label, b.label));
    for (const n of nodes) {
      n.depth = depth;
      sort(n.children, depth + 1);
    }
  };
  sort(roots, 0);
  return roots;
}

/**
 * A searchable, indented tree picker — the one control for "where does this go / which
 * unit" choices, replacing flat `A / B / C` path lists. Same popover mechanics as
 * AddModal's category combobox: portalled out of the modal's overflow, fixed to the
 * trigger, keyboard navigable. Typing filters; a match keeps its ancestors visible
 * (greyed) so the hierarchy still reads.
 */
export function TreePicker({
  options,
  value,
  onChange,
  placeholder = "Choose…",
  noneLabel,
  loading = false,
  disabled = false,
  id,
  prefix,
}: {
  options: TreeOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** When given, an explicit "no selection" row (e.g. "Top level") that maps to "". */
  noneLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  id?: string;
  /** A short label shown inside the trigger ("Custodian"), for a row of pickers whose
   *  chosen values would otherwise not say which is which. */
  prefix?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);

  const forest = useMemo(() => buildForest(options), [options]);
  const selected = options.find((o) => o.id === value) ?? null;

  // Big trees start collapsed below the first level, except along the selected path.
  useEffect(() => {
    if (!open) return;
    const total = options.length;
    if (total <= 40) {
      setCollapsed(new Set());
      return;
    }
    const keepOpen = new Set(selected?.ancestors.map((a) => a.id) ?? []);
    const next = new Set<string>();
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        if (n.children.length && n.depth >= 1 && !keepOpen.has(n.id)) next.add(n.id);
        walk(n.children);
      }
    };
    walk(forest);
    setCollapsed(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** The visible rows, flattened: filtered (matches + their ancestors) or collapsed. */
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const out: Array<{ node: Node; match: boolean }> = [];
    const matches = (n: Node): boolean => n.label.toLocaleLowerCase().includes(needle) || (n.hint?.toLocaleLowerCase().includes(needle) ?? false);
    // Typing a heading's name ("RAM", a college) lists everything under it.
    const keep = (n: Node, underMatch: boolean): boolean => (n.selectable && (underMatch || matches(n))) || n.children.some((c) => keep(c, underMatch || matches(n)));
    const walk = (nodes: Node[], underMatch = false) => {
      for (const n of nodes) {
        if (needle) {
          if (!keep(n, underMatch)) continue;
          out.push({ node: n, match: n.selectable && (underMatch || matches(n)) });
          walk(n.children, underMatch || matches(n));
        } else {
          out.push({ node: n, match: true });
          if (!collapsed.has(n.id)) walk(n.children);
        }
      }
    };
    walk(forest);
    return out;
  }, [forest, query, collapsed]);

  const choosable = useMemo(() => rows.filter((r) => r.node.selectable), [rows]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node | EventTarget;
      if (!rootRef.current?.contains(t as globalThis.Node) && !panelRef.current?.contains(t as globalThis.Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      // At least 300px wide so long unit names don't truncate, and never past the window.
      const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const above = r.top - 12;
      if (below >= 160 || below >= above) setPos({ top: r.bottom + 3, left, width, maxHeight: Math.max(120, Math.min(320, below)) });
      else setPos({ bottom: window.innerHeight - r.top + 3, left, width, maxHeight: Math.max(120, Math.min(320, above)) });
    }
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function toggle(id: string) {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (open) e.preventDefault(); // closes the list, not the dialog around it
      return setOpen(false);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, choosable.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && choosable[active]) {
      e.preventDefault();
      choose(choosable[active].node.id);
    }
  }

  const activeId = choosable[active]?.node.id;
  const shownLabel = value === "" && noneLabel ? noneLabel : (selected?.label ?? "");

  return (
    <div ref={rootRef} className="relative" id={id}>
      <div className={`flex items-center rounded-2 border bg-panel ${open ? "border-accent" : "border-border2"} ${disabled ? "opacity-50" : ""}`}>
        {prefix && <span className="flex-none whitespace-nowrap pl-8 text-10.5 text-faint">{prefix}:</span>}
        {!open && selected?.iconKey && <CategoryIcon iconKey={selected.iconKey} className="ml-7 size-12 flex-none text-dim" />}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          value={open ? query : shownLabel}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={loading ? "Loading…" : open ? "Type to filter…" : placeholder}
          className="h-24 min-w-0 flex-1 bg-transparent px-8 text-11 outline-none"
        />
        {!open && selected && selected.ancestors.length > 0 && (
          <span className="max-w-[45%] truncate pr-4 text-9.5 text-faint">in {selected.ancestors[selected.ancestors.length - 1].label}</span>
        )}
        <button
          type="button"
          disabled={disabled}
          aria-label={open ? "Close" : "Open"}
          onClick={() => {
            setOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="grid h-24 w-26 place-items-center text-faint hover:text-text"
        >
          <ChevronsUpDown className="size-12" />
        </button>
      </div>

      {open &&
        pos &&
        createPortal(
          <div ref={panelRef} role="tree" className="fixed z-[70] overflow-y-auto rounded-2 border border-border2 bg-panel p-3" style={pos}>
            {noneLabel && !query && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose("")}
                className="flex w-full items-center gap-6 rounded-2 px-7 py-5 text-left text-11 hover:bg-panel2"
              >
                <Check className={`size-11 flex-none ${value === "" ? "text-accent" : "opacity-0"}`} />
                <span className="italic text-dim">{noneLabel}</span>
              </button>
            )}
            {loading ? (
              <div className="px-8 py-8 text-10.5 text-faint">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="px-8 py-8 text-10.5 text-faint">{query ? "Nothing matches." : "Nothing to choose from."}</div>
            ) : (
              rows.map(({ node, match }) => {
                const hasKids = node.children.length > 0;
                const isOpen = query ? true : !collapsed.has(node.id);
                return (
                  <div
                    key={node.id}
                    role="treeitem"
                    aria-selected={node.id === value}
                    className={`flex items-center gap-4 rounded-2 py-4 pr-7 text-11 ${node.id === activeId ? "bg-panel2" : node.selectable ? "hover:bg-panel2" : ""}`}
                    style={{ paddingLeft: 4 + node.depth * 14 }}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => hasKids && !query && toggle(node.id)}
                      className={`grid size-14 flex-none place-items-center text-faint ${hasKids && !query ? "hover:text-text" : "invisible"}`}
                    >
                      {isOpen ? <ChevronDown className="size-11" /> : <ChevronRight className="size-11" />}
                    </button>
                    <button
                      type="button"
                      disabled={!node.selectable}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => node.selectable && choose(node.id)}
                      className={`flex min-w-0 flex-1 items-center gap-6 text-left ${node.selectable ? "" : "cursor-default"}`}
                    >
                      {node.iconKey && <CategoryIcon iconKey={node.iconKey} className={`size-12 flex-none ${node.selectable ? "text-dim" : "text-faint"}`} />}
                      <span className={`min-w-0 flex-1 truncate ${node.selectable && match ? "" : "text-faint"}`}>{node.label}</span>
                      {node.hint && <span className="max-w-[40%] truncate text-9.5 text-faint">{node.hint}</span>}
                      {node.id === value && <Check className="size-11 flex-none text-accent" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Container options (`GET /resources/items/containers`, transfer destinations) →
 *  tree options. Ancestors that aren't themselves options still render as structure. */
export function containerTreeOptions(
  rows: Array<{ id: string; name: string; categoryName: string; categoryIconKey: string; path: string[]; ancestorIds: string[] }>,
): TreeOption[] {
  const iconById = new Map(rows.map((r) => [r.id, r.categoryIconKey]));
  return rows.map((r) => ({
    id: r.id,
    label: r.name,
    iconKey: r.categoryIconKey,
    hint: r.categoryName,
    ancestors: r.ancestorIds.map((id, i) => ({ id, label: r.path[i] ?? id, iconKey: iconById.get(id) })),
  }));
}

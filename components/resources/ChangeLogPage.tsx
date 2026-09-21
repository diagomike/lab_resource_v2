"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ChangeLogEntryDto, ItemChangeKind, ItemChangeTarget, ResourceCategoryDto } from "@/lib/shared";
import { itemChangeKinds } from "@/lib/shared";
import { CHANGE_LABEL } from "@/lib/domain/types";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote, Button } from "@/components/ui";
import { PanelLoading, EmptyState } from "@/components/states";
import { Inspector } from "./Inspector";

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  kind: string;
  targetKind: string;
  categoryId: string;
}
const EMPTY: Filters = { q: "", kind: "", targetKind: "", categoryId: "" };

function readFilters(sp: URLSearchParams): Filters {
  return { q: sp.get("q") ?? "", kind: sp.get("kind") ?? "", targetKind: sp.get("targetKind") ?? "", categoryId: sp.get("categoryId") ?? "" };
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Consecutive rows sharing a non-null batchId are one bulk operation — the server's
 *  own `at desc, id desc` ordering guarantees a batch's rows are contiguous within a
 *  page (every row one bulk call produces shares the identical `at`), so a single
 *  linear pass groups them correctly without re-sorting anything client-side. */
type LogGroup = { batchId: string; rows: ChangeLogEntryDto[] } | { batchId: null; row: ChangeLogEntryDto };

function groupEntries(entries: ChangeLogEntryDto[]): LogGroup[] {
  const out: LogGroup[] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (entry.batchId && last && "batchId" in last && last.batchId === entry.batchId) {
      last.rows.push(entry);
    } else if (entry.batchId) {
      out.push({ batchId: entry.batchId, rows: [entry] });
    } else {
      out.push({ batchId: null, row: entry });
    }
  }
  return out;
}

function ChangeLogPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [draftQ, setDraftQ] = useState(filters.q);
  useEffect(() => setDraftQ(filters.q), [filters.q]);

  const [entries, setEntries] = useState<ChangeLogEntryDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const setParams = useCallback(
    (patch: Partial<Filters & { page: number }>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === "" || v === undefined || v === null || (k === "page" && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch)) next.delete("page"); // any filter change resets to page 1
      router.replace(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams],
  );

  useEffect(() => {
    api.get<ResourceCategoryDto[]>("/resources/categories").then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    setEntries(null);
    setError(null);
    const qs = new URLSearchParams();
    if (filters.q) qs.set("q", filters.q);
    if (filters.kind) qs.set("kind", filters.kind);
    if (filters.targetKind) qs.set("targetKind", filters.targetKind);
    if (filters.categoryId) qs.set("categoryId", filters.categoryId);
    qs.set("page", String(page));
    qs.set("pageSize", String(PAGE_SIZE));
    let cancelled = false;
    api
      .get<{ entries: ChangeLogEntryDto[]; total: number }>(`/resources/changes?${qs.toString()}`)
      .then((r) => {
        if (cancelled) return;
        setEntries(r.entries);
        setTotal(r.total);
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Could not load the change log"));
    return () => {
      cancelled = true;
    };
  }, [filters.q, filters.kind, filters.targetKind, filters.categoryId, page]);

  useEffect(() => {
    if (draftQ === filters.q) return;
    const t = setTimeout(() => setParams({ q: draftQ }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQ]);

  const groups = useMemo(() => groupEntries(entries ?? []), [entries]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel
        title={`Change log${entries ? ` (${total.toLocaleString()})` : ""}`}
        actions={
          <div className="flex items-center gap-8">
            <input
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder="Search the log…"
              className="h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent w-[180px]"
            />
            <select
              value={filters.kind}
              onChange={(e) => setParams({ kind: e.target.value })}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 text-dim outline-none focus:border-accent"
            >
              <option value="">Any change</option>
              {itemChangeKinds.map((k) => (
                <option key={k} value={k}>
                  {CHANGE_LABEL[k]}
                </option>
              ))}
            </select>
            <select
              value={filters.targetKind}
              onChange={(e) => setParams({ targetKind: e.target.value })}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 text-dim outline-none focus:border-accent"
            >
              <option value="">Item + category</option>
              <option value="ITEM">Items only</option>
              <option value="CATEGORY">Categories only</option>
            </select>
            <select
              value={filters.categoryId}
              onChange={(e) => setParams({ categoryId: e.target.value })}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 text-dim outline-none focus:border-accent"
            >
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {(filters.q || filters.kind || filters.targetKind || filters.categoryId) && (
              <button onClick={() => setParams(EMPTY)} className="text-10.5 text-accent">
                Clear filters
              </button>
            )}
          </div>
        }
      >
        {!entries ? (
          <PanelLoading rows={8} />
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body="Every applied change lands here — corrections immediately, and (once approvals exist) an approved request the moment it executes."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b border-border">
                    {["When", "Item", "Change", "Field", "From", "To", "By", "Reason"].map((h) => (
                      <th key={h} className="text-9.5 uppercase tracking-label text-faint font-semibold px-10 py-7 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) =>
                    g.batchId === null ? (
                      <EntryRow key={g.row.id} entry={g.row} onOpenItem={setInspectId} />
                    ) : (
                      <BatchGroup
                        key={g.batchId}
                        batchId={g.batchId}
                        rows={g.rows}
                        expanded={!!expanded[g.batchId]}
                        onToggle={() => setExpanded((s) => ({ ...s, [g.batchId!]: !s[g.batchId!] }))}
                        onOpenItem={setInspectId}
                      />
                    ),
                  )}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-14 py-9 border-t border-border">
                <span className="text-10.5 text-dim">
                  Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-6">
                  <Button disabled={page <= 1} onClick={() => setParams({ page: page - 1 })}>
                    Previous
                  </Button>
                  <Button disabled={page >= totalPages} onClick={() => setParams({ page: page + 1 })}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      <Inspector itemId={inspectId} onClose={() => setInspectId(null)} onChanged={() => {}} onNavigate={setInspectId} />
    </Screen>
  );
}

function ItemCell({ entry, onOpenItem }: { entry: ChangeLogEntryDto; onOpenItem: (id: string) => void }) {
  if (entry.targetKind === "CATEGORY") {
    return <span className="max-w-[220px] truncate block text-11 text-dim">{entry.itemName} (category)</span>;
  }
  if (entry.itemId && entry.itemExists) {
    return (
      <button onClick={() => onOpenItem(entry.itemId!)} className="max-w-[220px] truncate block text-left text-11 hover:text-accent hover:underline">
        {entry.itemName}
      </button>
    );
  }
  // Deleted (or, defensively, no itemId at all) — the snapshot is the point: the name
  // still reads, but there is nothing left to open, so it must not look clickable.
  return (
    <span className="max-w-[220px] truncate block text-11 text-faint line-through" title="This resource has been deleted">
      {entry.itemName}
    </span>
  );
}

function EntryRow({ entry, onOpenItem }: { entry: ChangeLogEntryDto; onOpenItem: (id: string) => void }) {
  return (
    <tr className="border-b border-border">
      <td className="px-10 py-7 text-10.5 text-dim whitespace-nowrap">{new Date(entry.at).toLocaleString()}</td>
      <td className="px-10 py-7">
        <ItemCell entry={entry} onOpenItem={onOpenItem} />
        {entry.targetKind === "ITEM" && entry.categoryName && <div className="text-9.5 text-faint">{entry.categoryName}</div>}
      </td>
      <td className="px-10 py-7 text-11 whitespace-nowrap">{CHANGE_LABEL[entry.kind as ItemChangeKind] ?? entry.kind}</td>
      <td className="px-10 py-7 text-10.5 text-dim">{show(entry.field)}</td>
      <td className="px-10 py-7 text-10.5 text-dim max-w-[160px] truncate">{show(entry.before)}</td>
      <td className="px-10 py-7 text-10.5 font-medium max-w-[160px] truncate">{show(entry.after)}</td>
      <td className="px-10 py-7 text-10.5 text-dim whitespace-nowrap">{entry.actorName}</td>
      <td className="px-10 py-7 text-10.5 text-dim max-w-[180px] truncate">{show(entry.note)}</td>
    </tr>
  );
}

/** One bulk operation, rendered as one recognizable block — a summary header naming
 *  how many resources, the change, who and when, expandable to each member row —
 *  rather than N unrelated-looking rows that merely happen to carry a shared badge. */
function BatchGroup({
  batchId,
  rows,
  expanded,
  onToggle,
  onOpenItem,
}: {
  batchId: string;
  rows: ChangeLogEntryDto[];
  expanded: boolean;
  onToggle: () => void;
  onOpenItem: (id: string) => void;
}) {
  const first = rows[0];
  return (
    <>
      <tr className="border-b border-border bg-soft">
        <td className="px-10 py-7 text-10.5 text-dim whitespace-nowrap">{new Date(first.at).toLocaleString()}</td>
        <td className="px-10 py-7 text-11" colSpan={5}>
          <button onClick={onToggle} className="flex items-center gap-6 text-left hover:text-accent">
            <span className="text-9.5">{expanded ? "▾" : "▸"}</span>
            <span className="font-medium">{rows.length} resources</span>
            <span className="text-dim">· {CHANGE_LABEL[first.kind as ItemChangeKind] ?? first.kind}</span>
          </button>
        </td>
        <td className="px-10 py-7 text-10.5 text-dim whitespace-nowrap">{first.actorName}</td>
        <td className="px-10 py-7 text-10.5 text-dim max-w-[180px] truncate">{show(first.note)}</td>
      </tr>
      {expanded && rows.map((entry) => <EntryRow key={entry.id} entry={entry} onOpenItem={onOpenItem} />)}
    </>
  );
}

/** useSearchParams needs a Suspense boundary in the Next.js App Router. */
export default function ChangeLogPage() {
  return (
    <Suspense>
      <ChangeLogPageInner />
    </Suspense>
  );
}

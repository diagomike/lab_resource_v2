"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  columnVisibilityFeature,
  createColumnHelper,
  createExpandedRowModel,
  rowExpandingFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ExpandedState,
  type RowSelectionState,
} from "@tanstack/react-table";
import Link from "next/link";
import type { ItemRowDto, PendingMarkersDto, PendingTransferMarkersDto } from "@/lib/shared";
import { aggregate, describeAgg, sortRows, type RowNode, type RowSort } from "@/lib/domain/tree";
import { CategoryIcon } from "./IconPicker";
import { StatusChip } from "./StatusChip";
import { ItemThumb } from "./ItemImages";

// v9 registers features explicitly — only what this read-only table actually uses.
// Editing (Phase 7) will add columnSizingFeature etc. when inline commit lands.
const features = tableFeatures({
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  rowSelectionFeature,
  columnVisibilityFeature,
});

const helper = createColumnHelper<typeof features, RowNode>();

const isCluster = (r: RowNode): r is Extract<RowNode, { kind: "cluster" }> => r.kind === "cluster";
const isGroup = (r: RowNode): r is Extract<RowNode, { kind: "group" }> => r.kind === "group";
const idsOf = (r: RowNode): string[] => (r.kind === "item" ? [r.item.id] : r.memberIds);
const membersOf = (r: RowNode) => (r.kind === "item" ? [r.item] : r.members);

export interface ResourceTableProps {
  rows: RowNode[];
  /** Row-DTO lookup for the denormalised display names (categoryName,
   *  ownerOrgNodeName, ...) the domain Item inside a RowNode does not carry. */
  byId: Map<string, ItemRowDto>;
  expanded: ExpandedState;
  onExpandedChange: (u: ExpandedState) => void;
  selection: RowSelectionState;
  onSelectionChange: (u: RowSelectionState) => void;
  onInspect: (id: string) => void;
  /** Search mode has no physical containment to show, so it shows the location
   *  column instead — the two are mutually exclusive by construction (RowNode has no
   *  parent chain when the server already returned a flat page). */
  showPath?: boolean;
  /** The university-wide browse (10b of
   *  ~/.claude/plans/three-product-changes-dynamic-thompson.md) has no bulk toolbar
   *  to act on a selection, so the checkbox column itself is pointless there — not
   *  just inert but actively misleading (it would suggest a selection does
   *  something). Defaults to `true`, unchanged from before this prop existed. */
  selectable?: boolean;
  /** Items a pending lab Draft would change — shown with a `*` that explains the change
   *  on hover and opens the draft on click. */
  pending?: PendingMarkersDto;
  /** Items a pending transfer or handover will move — shown with a `⇄` (a count on a
   *  cluster row) so nobody promises them a second time. */
  pendingTransfers?: PendingTransferMarkersDto;
  /** Says what to do when the list is empty (no filters vs. filters that match nothing). */
  emptyText?: string;
  /** While a filter is on: the genuine matches (null/omitted: not filtering), and the
   *  matches under any item. Rows that are only context (the lab around a matching
   *  computer, a matching computer's parts) are dimmed, and group, cluster and context
   *  rows count and summarise the matches beneath them — "624 Computer", not "×31". */
  matched?: Set<string> | null;
  matchedUnder?: (id: string) => string[];
}

/** The columns a header click sorts by, and what each compares (the first member's value
 *  for a cluster of identical things). */
const SORTABLE: Record<string, (r: ItemRowDto) => string | number | null> = {
  name: (r) => r.name,
  path: (r) => r.path.join(" › "),
  category: (r) => r.categoryName,
  status: (r) => r.effectiveStatus,
  qty: (r) => r.qty,
  custodian: (r) => r.custodianName,
  currentOrg: (r) => r.currentOrgNodeName,
  owner: (r) => r.ownerOrgNodeName,
};

export function ResourceTable({ rows: unsorted, byId, expanded, onExpandedChange, selection, onSelectionChange, onInspect, showPath, selectable = true, pending, pendingTransfers, matched, matchedUnder, emptyText }: ResourceTableProps) {
  const [sort, setSort] = useState<RowSort | null>(null);
  const rows = useMemo(() => {
    if (!sort) return unsorted;
    const pick = SORTABLE[sort.key];
    return sortRows(
      unsorted,
      (r) => {
        const first = byId.get(r.kind === "item" ? r.item.id : r.memberIds[0]);
        return first ? pick(first) : null;
      },
      sort.dir,
    );
  }, [unsorted, sort, byId]);
  /** First click: A→Z (smallest first); second: Z→A; third: back to the register's order. */
  const cycle = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  const columns = useMemo(() => {
    const rowOf = (id: string) => byId.get(id);
    const nameAgg = (values: (string | undefined)[]) => aggregate(values.map((v) => v ?? null));
    const filtering = Boolean(matched && matchedUnder);
    const present = (xs: Array<ItemRowDto | undefined>) => xs.filter((x): x is ItemRowDto => Boolean(x));
    /** What a row's roll-ups describe: its members, or while filtering, the matches
     *  beneath them. */
    const aggRowsOf = (r: RowNode): ItemRowDto[] =>
      filtering ? present([...new Set(membersOf(r).flatMap((m) => matchedUnder!(m.id)))].map(rowOf)) : present(membersOf(r).map((m) => rowOf(m.id)));
    /** An item shown only because it contains, or is part of, a match. */
    const isContext = (r: RowNode) => filtering && r.kind === "item" && !matched!.has(r.item.id);
    const rollupRowsOf = (r: RowNode) => (r.kind === "item" ? present([rowOf(r.item.id)]) : aggRowsOf(r));

    const cols = [
      ...(selectable
        ? [
            helper.display({
              id: "select",
              header: () => null,
              cell: ({ row }) => (
                <input
                  type="checkbox"
                  checked={row.getIsSelected()}
                  ref={(el) => {
                    if (el) el.indeterminate = row.getIsSomeSelected() && !row.getIsSelected();
                  }}
                  onChange={row.getToggleSelectedHandler()}
                  onClick={(e) => e.stopPropagation()}
                />
              ),
            }),
          ]
        : []),

      helper.display({
        id: "photo",
        header: "",
        cell: ({ row }) => {
          if (isGroup(row.original)) return null;
          const first = rowOf(idsOf(row.original)[0]);
          return first ? <ItemThumb row={first} /> : null;
        },
      }),

      helper.display({
        id: "name",
        header: "Name",
        cell: ({ row }) => {
          const r = row.original;
          const first = rowOf(idsOf(r)[0]);
          const canExpand = row.getCanExpand();
          if (isGroup(r)) {
            return (
              <div className="flex items-center gap-6" style={{ paddingLeft: row.depth * 16 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    row.toggleExpanded();
                  }}
                  aria-expanded={row.getIsExpanded()}
                  aria-label={`${row.getIsExpanded() ? "Collapse" : "Expand"} ${r.label}`}
                  className="w-14 h-14 flex-none flex items-center justify-center text-10.5 text-dim hover:text-text border-0 bg-transparent p-0 cursor-pointer"
                >
                  <span aria-hidden="true">{row.getIsExpanded() ? "▾" : "▸"}</span>
                </button>
                {r.iconKey && <CategoryIcon iconKey={r.iconKey} className="w-13 h-13 flex-none text-dim" />}
                <span className="truncate text-11.5 font-semibold">{r.label}</span>
                {/* How many top-level resources the heading holds — hidden while filtering,
                    when the Qty column counts the matches instead ("40 Computer", not "2"). */}
                {!filtering && <span className="text-10.5 font-mono text-faint flex-none">{r.members.length}</span>}
              </div>
            );
          }
          return (
            <div className="flex items-center gap-6" style={{ paddingLeft: row.depth * 16 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  row.toggleExpanded();
                }}
                aria-expanded={canExpand ? row.getIsExpanded() : undefined}
                aria-label={`${row.getIsExpanded() ? "Collapse" : "Expand"} ${first?.name ?? "row"}`}
                tabIndex={canExpand ? undefined : -1}
                aria-hidden={canExpand ? undefined : true}
                className={`w-14 h-14 flex-none flex items-center justify-center text-10.5 ${canExpand ? "text-dim hover:text-text" : "invisible"}`}
              >
                <span aria-hidden="true">{row.getIsExpanded() ? "▾" : "▸"}</span>
              </button>
              <CategoryIcon iconKey={first?.categoryIconKey} className="w-13 h-13 flex-none text-dim" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isCluster(r)) onInspect(r.item.id);
                  else row.toggleExpanded();
                }}
                className={`truncate text-left text-11.5 hover:text-accent hover:underline ${isContext(r) ? "text-faint" : ""}`}
                title={isContext(r) ? "Shown for context — the matches are inside it or around it" : undefined}
              >
                {isCluster(r) ? (first?.categoryName ?? "—") : r.item.name}
              </button>
              {!isCluster(r) && pending?.[r.item.id] && (
                <Link
                  href={`/places/${pending[r.item.id].labItemId}?tab=draft&item=${r.item.id}`}
                  onClick={(e) => e.stopPropagation()}
                  title={["Waiting in the lab's changes (not sent yet):", ...pending[r.item.id].lines, "", "Click to open them"].join("\n")}
                  className="flex-none text-12 font-bold leading-none text-warn hover:text-accent"
                  aria-label="Has changes not sent yet"
                >
                  *
                </Link>
              )}
              {!isCluster(r) && pendingTransfers?.[r.item.id] && (
                <Link
                  href="/approvals"
                  onClick={(e) => e.stopPropagation()}
                  title={[pendingTransfers[r.item.id].line, "", "It can't be handed over or transferred again until that request is decided. Click to open Approvals."].join("\n")}
                  className="flex-none text-11 leading-none text-warn hover:text-accent"
                  aria-label="In a pending transfer"
                >
                  ⇄
                </Link>
              )}
              {isCluster(r) && <span className="text-10.5 font-mono text-faint flex-none">×{r.members.length}</span>}
              {isCluster(r) && pendingTransfers && (() => {
                const promised = idsOf(r).filter((id) => pendingTransfers[id]).length;
                return promised ? (
                  <span className="flex-none text-10.5 text-warn" title={`${promised} of these are in a pending transfer or handover — the rest are free to hand over.`}>
                    ⇄ {promised} promised
                  </span>
                ) : null;
              })()}
            </div>
          );
        },
      }),
    ];

    if (showPath) {
      cols.push(
        helper.display({
          id: "path",
          header: "Location",
          cell: ({ row }) => {
            const r = row.original;
            if (r.kind !== "item") return null;
            const path = rowOf(r.item.id)?.path ?? [];
            return <span className="text-11 text-dim">{path.length ? path.join(" › ") : "—"}</span>;
          },
        }),
      );
    }

    cols.push(
      helper.display({
        id: "category",
        header: "Category",
        cell: ({ row }) => {
          if (isGroup(row.original)) {
            const agg = nameAgg(aggRowsOf(row.original).map((m) => m.categoryName));
            return <span className="text-11 text-faint">{describeAgg(agg)}</span>;
          }
          return <span className="text-11 text-dim">{rowOf(idsOf(row.original)[0])?.categoryName ?? "—"}</span>;
        },
      }),

      helper.display({
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const r = row.original;
          if (isCluster(r) || isGroup(r)) {
            const members = aggRowsOf(r);
            const counts = new Map<string, number>();
            for (const m of members) counts.set(m.effectiveStatus, (counts.get(m.effectiveStatus) ?? 0) + 1);
            const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
            return (
              <div className="flex flex-wrap items-center gap-4">
                {sorted.map(([s, n]) => (
                  <span key={s} className="flex items-center gap-2">
                    <span className="text-10.5 font-mono text-faint">{n}</span>
                    <StatusChip status={s as ItemRowDto["effectiveStatus"]} />
                  </span>
                ))}
              </div>
            );
          }
          const own = rowOf(r.item.id);
          return own ? <StatusChip status={own.effectiveStatus} /> : null;
        },
      }),

      helper.display({
        id: "qty",
        header: "Qty",
        cell: ({ row }) => {
          const r = row.original;
          const first = rowOf(idsOf(r)[0]);
          if (filtering && (isGroup(r) || isCluster(r) || isContext(r))) {
            const hits = aggRowsOf(r);
            if (!hits.length) return <span className="text-11 font-mono text-faint">—</span>;
            const count = hits.length; // matching items — bulk amounts in mixed units don't add up
            const kinds = new Set(hits.map((h) => h.categoryName));
            const label = kinds.size === 1 ? [...kinds][0] : "matches";
            return (
              <span className="text-11 font-mono text-dim whitespace-nowrap" title={`${count.toLocaleString()} matching ${label} here`}>
                {count.toLocaleString()} <span className="font-sans text-faint">{label}</span>
              </span>
            );
          }
          if (isGroup(r)) return <span className="text-11 font-mono text-faint" title="Top-level resources in this group">×{r.members.length}</span>;
          if (isCluster(r)) {
            if (first?.countingMode === "BULK") {
              const total = r.members.reduce((a, m) => a + m.qty, 0);
              return <span className="text-11 font-mono text-dim">{total.toLocaleString()}</span>;
            }
            return <span className="text-11 font-mono text-dim">{r.members.length} units</span>;
          }
          if (first?.countingMode === "BULK") return <span className="text-11 font-mono">{r.item.qty.toLocaleString()}</span>;
          return <span className="text-11 font-mono text-faint">1</span>;
        },
      }),

      helper.display({
        id: "custodian",
        header: "Custodian",
        cell: ({ row }) => {
          const agg = nameAgg(rollupRowsOf(row.original).map((m) => m.custodianName));
          return <span className="text-11 truncate block">{describeAgg(agg)}</span>;
        },
      }),

      helper.display({
        id: "currentOrg",
        header: "Current unit",
        cell: ({ row }) => {
          const agg = nameAgg(rollupRowsOf(row.original).map((m) => m.currentOrgNodeName));
          return <span className="text-11 truncate block">{describeAgg(agg)}</span>;
        },
      }),

      helper.display({
        id: "owner",
        header: "Owner",
        cell: ({ row }) => {
          const agg = nameAgg(rollupRowsOf(row.original).map((m) => m.ownerOrgNodeName));
          return <span className="text-11 truncate block">{describeAgg(agg)}</span>;
        },
      }),
    );

    return cols;
  }, [byId, showPath, onInspect, selectable, pending, pendingTransfers, matched, matchedUnder]);

  const table = useTable({
    features,
    columns,
    data: rows,
    getSubRows: (r: RowNode) => r.children,
    getRowId: (r: RowNode) => r.id,
    state: { expanded, rowSelection: selection },
    onExpandedChange: (u) => onExpandedChange(typeof u === "function" ? u(expanded) : u),
    onRowSelectionChange: (u) => onSelectionChange(typeof u === "function" ? u(selection) : u),
    enableSubRowSelection: true,
    // v9 does not default this the way v8 did: without it the expanded row model
    // returns the un-flattened model and sub-rows never reach getRowModel().
    paginateExpandedRows: true,
    // A refetch after a save hands the table new `rows` — which by default resets
    // expansion, collapsing the tree the person was working in. Expansion is owned by
    // useRegisterState and cleared there when the query itself changes.
    autoResetExpanded: false,
  });

  const modelRows = table.getRowModel().rows;

  return (
    // Its own scroll area, so the column headings stay in view down a long register.
    <div className="overflow-auto max-h-[calc(100vh-230px)] min-h-[240px]">
      <table className="w-full border-collapse min-w-[900px]">
        <thead className="sticky top-0 z-[1] bg-panel">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((h) => {
                const sortable = h.column.id in SORTABLE;
                const on = sort?.key === h.column.id ? sort.dir : null;
                return (
                  <th
                    key={h.id}
                    aria-sort={on === "asc" ? "ascending" : on === "desc" ? "descending" : sortable ? "none" : undefined}
                    className="text-10.5 uppercase tracking-label text-faint font-semibold px-8 py-7 text-left bg-panel"
                  >
                    {h.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        onClick={() => cycle(h.column.id)}
                        className={`border-0 bg-transparent p-0 inline-flex items-center gap-4 uppercase tracking-label font-semibold cursor-pointer text-10.5 ${on ? "text-text" : "text-faint hover:text-text"}`}
                      >
                        <table.FlexRender header={h} />
                        {on === "asc" ? <ArrowUp size={11} aria-hidden="true" /> : on === "desc" ? <ArrowDown size={11} aria-hidden="true" /> : <ArrowUpDown size={11} aria-hidden="true" className="opacity-50" />}
                      </button>
                    ) : (
                      <table.FlexRender header={h} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {modelRows.map((row) => (
            <tr
              key={row.id}
              onClick={() => {
                if (row.getCanExpand()) row.toggleExpanded();
              }}
              className={`border-b border-border ${isGroup(row.original) ? "bg-panel2 font-medium" : isCluster(row.original) ? "bg-panel2" : ""} ${row.getIsSelected() ? "bg-sel" : ""} ${row.getCanExpand() ? "cursor-pointer" : ""}`}
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className="px-8 py-6 align-middle">
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {modelRows.length === 0 && (
            <tr>
              <td colSpan={10} className="text-center text-11.5 text-dim py-20 px-14">
                {emptyText ?? "Nothing matches these filters. Clear a filter to see more."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

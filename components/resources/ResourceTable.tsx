"use client";

import { useMemo } from "react";
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
import type { ItemRowDto } from "@/lib/shared";
import { aggregate, describeAgg, type RowNode } from "@/lib/domain/tree";
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
}

export function ResourceTable({ rows, byId, expanded, onExpandedChange, selection, onSelectionChange, onInspect, showPath, selectable = true }: ResourceTableProps) {
  const columns = useMemo(() => {
    const rowOf = (id: string) => byId.get(id);
    const nameAgg = (values: (string | undefined)[]) => aggregate(values.map((v) => v ?? null));

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
                <span className="w-14 h-14 flex-none flex items-center justify-center text-9.5 text-dim">{row.getIsExpanded() ? "▾" : "▸"}</span>
                {r.iconKey && <CategoryIcon iconKey={r.iconKey} className="w-13 h-13 flex-none text-dim" />}
                <span className="truncate text-11.5 font-semibold">{r.label}</span>
                <span className="text-9.5 font-mono text-faint flex-none">{r.members.length}</span>
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
                className={`w-14 h-14 flex-none flex items-center justify-center text-9.5 ${canExpand ? "text-dim hover:text-text" : "invisible"}`}
              >
                {row.getIsExpanded() ? "▾" : "▸"}
              </button>
              <CategoryIcon iconKey={first?.categoryIconKey} className="w-13 h-13 flex-none text-dim" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isCluster(r)) onInspect(r.item.id);
                  else row.toggleExpanded();
                }}
                className="truncate text-left text-11.5 hover:text-accent hover:underline"
              >
                {isCluster(r) ? (first?.categoryName ?? "—") : r.item.name}
              </button>
              {isCluster(r) && <span className="text-9.5 font-mono text-faint flex-none">×{r.members.length}</span>}
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
            return <span className="text-10.5 text-dim">{path.length ? path.join(" › ") : "—"}</span>;
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
            const agg = nameAgg(row.original.members.map((m) => rowOf(m.id)?.categoryName));
            return <span className="text-10.5 text-faint">{describeAgg(agg)}</span>;
          }
          return <span className="text-10.5 text-dim">{rowOf(idsOf(row.original)[0])?.categoryName ?? "—"}</span>;
        },
      }),

      helper.display({
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const r = row.original;
          const members = membersOf(r).map((m) => rowOf(m.id)).filter((m): m is ItemRowDto => Boolean(m));
          if (isCluster(r) || isGroup(r)) {
            const counts = new Map<string, number>();
            for (const m of members) counts.set(m.effectiveStatus, (counts.get(m.effectiveStatus) ?? 0) + 1);
            const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
            return (
              <div className="flex flex-wrap items-center gap-4">
                {sorted.map(([s, n]) => (
                  <span key={s} className="flex items-center gap-2">
                    <span className="text-9.5 font-mono text-faint">{n}</span>
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
          if (isGroup(r)) return <span className="text-10.5 font-mono text-faint" title="Top-level resources in this group">×{r.members.length}</span>;
          if (isCluster(r)) {
            if (first?.countingMode === "BULK") {
              const total = r.members.reduce((a, m) => a + m.qty, 0);
              return <span className="text-10.5 font-mono text-dim">{total.toLocaleString()}</span>;
            }
            return <span className="text-10.5 font-mono text-dim">{r.members.length} units</span>;
          }
          if (first?.countingMode === "BULK") return <span className="text-10.5 font-mono">{r.item.qty.toLocaleString()}</span>;
          return <span className="text-10.5 font-mono text-faint">1</span>;
        },
      }),

      helper.display({
        id: "custodian",
        header: "Custodian",
        cell: ({ row }) => {
          const agg = nameAgg(membersOf(row.original).map((m) => rowOf(m.id)?.custodianName));
          return <span className="text-10.5 truncate block">{describeAgg(agg)}</span>;
        },
      }),

      helper.display({
        id: "currentOrg",
        header: "Current unit",
        cell: ({ row }) => {
          const agg = nameAgg(membersOf(row.original).map((m) => rowOf(m.id)?.currentOrgNodeName));
          return <span className="text-10.5 truncate block">{describeAgg(agg)}</span>;
        },
      }),

      helper.display({
        id: "owner",
        header: "Owner",
        cell: ({ row }) => {
          const agg = nameAgg(membersOf(row.original).map((m) => rowOf(m.id)?.ownerOrgNodeName));
          return <span className="text-10.5 truncate block">{describeAgg(agg)}</span>;
        },
      }),
    );

    return cols;
  }, [byId, showPath, onInspect, selectable]);

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
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[900px]">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((h) => (
                <th key={h.id} className="text-9.5 uppercase tracking-label text-faint font-semibold px-8 py-7 text-left">
                  {h.isPlaceholder ? null : <table.FlexRender header={h} />}
                </th>
              ))}
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
              <td colSpan={10} className="text-center text-11.5 text-faint py-20">
                No resources match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

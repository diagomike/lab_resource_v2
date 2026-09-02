"use client";

import { useMemo, type ReactNode } from "react";
import { DataTableToolbar } from "./DataTableToolbar";
import { FilterValueInput } from "./FilterValueInput";
import { Pagination } from "./Pagination";
import { facetOptions } from "./facets";
import { applyFilters, applyGlobal, comparatorFor, variantOf } from "./filter-logic";
import { DEFAULT_PAGE_SIZE, codecColumns, useTableUrlState } from "./url-state";
import type { DataTableColumn, FilterOperator, FilterVariant, Option, TableFilter } from "./types";

export type { DataTableColumn } from "./types";

/**
 * The standard list table: search, per-column filters, an and/or filter builder, sorting,
 * pagination and column visibility — with the whole of that state living in the URL.
 *
 * That last part is the point. Filter a register, click into a row, hit back, and the
 * filters are still there; copy the address and a colleague opens the same view. No screen
 * has to do anything to get it beyond declaring its columns.
 *
 * Rows are filtered by the pure functions in filter-logic.ts BEFORE anything renders, which
 * is what lets two filters sit on one column, `or` work at all, and facet counts mean what
 * they say. Sorting and pagination over an already-filtered array are a comparator and a
 * slice, so this no longer wraps @tanstack/react-table — there was nothing left for it to do.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  globalSearch = true,
  pageSize = DEFAULT_PAGE_SIZE,
  empty,
  tableId,
  advancedFilters = true,
  columnPicker = true,
  tree,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Free-text search across every column. Off for screens where the per-column filters
   *  already cover it, or where a server-side search box owns the query. */
  globalSearch?: boolean;
  /** 0 disables pagination entirely — used by the hierarchy screens, where row order is
   *  the tree and must not be broken across pages. */
  pageSize?: number;
  empty?: ReactNode;
  /** Prefix for this table's URL parameters. Required whenever a page mounts more than one
   *  table, or the two would read and write each other's state. */
  tableId?: string;
  advancedFilters?: boolean;
  columnPicker?: boolean;
  /**
   * Marks a table whose row ORDER carries a hierarchy (Categories, Locations). Sorting is
   * suppressed, pagination is off, and a filter keeps every matched row's ancestors so an
   * indented child never appears orphaned under nothing.
   */
  tree?: { path: (row: T) => string; separator?: string };
}) {
  const codec = useMemo(() => codecColumns(columns), [columns]);
  const [state, actions] = useTableUrlState({
    tableId,
    columns: codec,
    defaultSize: pageSize || DEFAULT_PAGE_SIZE,
  });

  const visibleColumns = useMemo(
    () => columns.filter((c) => !state.hidden.includes(c.id)),
    [columns, state.hidden],
  );
  const filterableColumns = useMemo(() => columns.filter((c) => variantOf(c) !== undefined), [columns]);

  // ---- filter → search → (retain ancestors) → sort → paginate ----

  const filtered = useMemo(
    () => applyFilters(rows, state.filters, state.join, columns),
    [rows, state.filters, state.join, columns],
  );
  const searched = useMemo(() => applyGlobal(filtered, columns, state.q), [filtered, columns, state.q]);

  const narrowed = useMemo(() => {
    if (!tree) return searched;
    const isNarrowed = state.filters.length > 0 || state.q.trim() !== "";
    if (!isNarrowed || searched.length === rows.length) return searched;
    const sep = tree.separator ?? " › ";
    const keptPaths = searched.map((r) => tree.path(r));
    const keep = new Set(keptPaths);
    // A parent survives because one of its descendants did — otherwise the indentation
    // would point at a row that is no longer on screen.
    for (const row of rows) {
      const path = tree.path(row);
      if (keep.has(path)) continue;
      if (keptPaths.some((p) => p.startsWith(path + sep))) keep.add(path);
    }
    return rows.filter((r) => keep.has(tree.path(r)));
  }, [tree, searched, rows, state.filters.length, state.q]);

  const sorted = useMemo(() => {
    if (tree || state.sort.length === 0) return narrowed;
    const comparators = state.sort
      .map((s) => {
        const column = columns.find((c) => c.id === s.id);
        return column ? { compare: comparatorFor(column), desc: s.desc } : null;
      })
      .filter((x): x is { compare: (a: T, b: T) => number; desc: boolean } => x !== null);
    if (comparators.length === 0) return narrowed;
    // Copy first — sorting the memo's input in place would mutate the caller's array.
    return [...narrowed].sort((a, b) => {
      for (const { compare, desc } of comparators) {
        const r = compare(a, b);
        if (r !== 0) return desc ? -r : r;
      }
      return 0;
    });
  }, [narrowed, state.sort, columns, tree]);

  const paginate = !tree && pageSize > 0;
  const pageCount = paginate ? Math.max(1, Math.ceil(sorted.length / state.size)) : 1;
  const page = Math.min(state.page, pageCount);
  const pageRows = paginate ? sorted.slice((page - 1) * state.size, page * state.size) : sorted;

  // ---- filter controls ----

  const optionsFor = useMemo(
    () => (column: DataTableColumn<T>): Option[] =>
      facetOptions(rows, column, state.filters, state.join, columns),
    [rows, state.filters, state.join, columns],
  );

  /** The filter the header-row control for this column is currently editing, if any. */
  function inlineFilterFor(column: DataTableColumn<T>): TableFilter | undefined {
    return state.filters.find((f) => f.id === column.id);
  }

  const isFiltered = state.filters.length > 0 || state.q.trim() !== "";
  const inlineColumns = visibleColumns.filter((c) => variantOf(c) !== undefined && c.inlineFilter !== false);
  const hasFilterRow = inlineColumns.length > 0;

  if (rows.length === 0 && empty && !isFiltered) return <>{empty}</>;

  return (
    <div>
      <DataTableToolbar
        q={state.q}
        onQ={actions.setQ}
        globalSearch={globalSearch}
        filters={state.filters}
        join={state.join}
        filterableColumns={filterableColumns}
        allColumns={columns}
        optionsFor={optionsFor}
        onFilters={actions.setFilters}
        onJoin={actions.setJoin}
        onClearFilters={actions.clearFilters}
        hidden={state.hidden}
        onHidden={actions.setHidden}
        matched={sorted.length}
        total={rows.length}
        showColumns={columnPicker}
        showAdvanced={advancedFilters}
      />

      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-border">
              {visibleColumns.map((c) => {
                const sortIndex = state.sort.findIndex((s) => s.id === c.id);
                const entry = sortIndex >= 0 ? state.sort[sortIndex] : null;
                const sortable = (c.sortable ?? false) && !tree;
                return (
                  <th
                    key={c.id}
                    style={{ width: c.width }}
                    className={`text-9.5 uppercase tracking-label text-faint font-semibold px-12 py-7 ${c.mono ? "text-right" : "text-left"}`}
                  >
                    <button
                      type="button"
                      disabled={!sortable}
                      // Shift-click adds a second sort key rather than replacing the first.
                      onClick={(e) => sortable && actions.toggleSort(c.id, e.shiftKey)}
                      title={sortable ? "Click to sort · shift-click to add a second sort" : undefined}
                      className={`inline-flex items-center gap-3 bg-transparent border-0 p-0 uppercase tracking-label text-9.5 font-semibold ${
                        sortable ? "cursor-pointer text-faint hover:text-dim" : "text-faint cursor-default"
                      }`}
                    >
                      {c.header}
                      {sortable && (
                        <span className="opacity-60">
                          {entry ? (entry.desc ? "↓" : "↑") : "↕"}
                          {state.sort.length > 1 && sortIndex >= 0 && (
                            <span className="text-9 font-mono">{sortIndex + 1}</span>
                          )}
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
            {hasFilterRow && (
              <tr className="border-b border-border bg-panel2">
                {visibleColumns.map((c) => {
                  const variant = variantOf(c);
                  const inline = variant !== undefined && c.inlineFilter !== false;
                  const existing = inline ? inlineFilterFor(c) : undefined;
                  // The control adopts whatever operator is already in force for this
                  // column — set one in the builder and the header row keeps editing that
                  // one rather than silently reverting it.
                  const op = existing?.op ?? (inline ? inlineOperatorFor(variant!) : "contains");
                  return (
                    <th key={c.id} className="px-10 py-5 font-normal">
                      {inline && (
                        <FilterValueInput
                          compact
                          variant={variant!}
                          op={op}
                          value={existing?.v ?? (op === "isBetween" || op === "inArray" ? [] : "")}
                          options={optionsFor(c)}
                          unit={c.unit}
                          range={c.range}
                          onChange={(v) => actions.setColumnFilter(c.id, op, v)}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-14 py-16 text-11.5 text-faint">
                  {isFiltered ? (
                    <span className="flex items-center gap-8">
                      Nothing matches the current filter.
                      <button type="button" onClick={actions.clearFilters} className="text-accent text-11">
                        Clear filters
                      </button>
                    </span>
                  ) : (
                    "Nothing to show."
                  )}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-border ${onRowClick ? "cursor-pointer hover:bg-panel2" : ""}`}
                >
                  {visibleColumns.map((c) => (
                    <td
                      key={c.id}
                      className={`px-12 py-7 text-11.5 align-top ${c.mono ? "text-right font-mono text-11" : ""}`}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {paginate && sorted.length > state.size && (
        <Pagination
          page={page}
          size={state.size}
          total={sorted.length}
          onPage={actions.setPage}
          onSize={actions.setSize}
        />
      )}
    </div>
  );
}

/**
 * The operator a header-row control uses when nothing is set yet. `isBetween` is the pick
 * for numbers and dates because its open ends already cover "at least" and "up to" — one
 * control instead of three. Everything richer (is not, is empty, or) lives in the builder,
 * which is also where the operator can be changed; the chip always names the one in force.
 */
function inlineOperatorFor(variant: FilterVariant): FilterOperator {
  switch (variant) {
    case "multiSelect":
      return "inArray";
    case "select":
    case "boolean":
      return "eq";
    case "number":
    case "range":
    case "date":
    case "dateRange":
      return "isBetween";
    default:
      return "contains";
  }
}

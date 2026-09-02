import { useEffect, useState } from "react";
import { RELATIVE_PRESETS, VALUELESS_OPERATORS, operatorLabel } from "./config";
import { CONTROL_CLASS, Dropdown } from "./Dropdown";
import { FilterList } from "./FilterList";
import { DebouncedInput } from "./FilterValueInput";
import { ViewOptions } from "./ViewOptions";
import { labelForValue } from "./facets";
import { variantOf } from "./filter-logic";
import type { DataTableColumn, JoinOperator, Option, TableFilter } from "./types";

/**
 * Search, the applied-filter chips, the advanced filter builder and the column picker.
 *
 * The chip bar is the honest answer to "what is filtering this view right now" — every
 * filter shows up there whether it was set in the header row or the builder, each one a
 * single click to cancel.
 */
export function DataTableToolbar<T>({
  q,
  onQ,
  globalSearch,
  filters,
  join,
  filterableColumns,
  allColumns,
  optionsFor,
  onFilters,
  onJoin,
  onClearFilters,
  hidden,
  onHidden,
  matched,
  total,
  showColumns,
  showAdvanced,
}: {
  q: string;
  onQ: (q: string) => void;
  globalSearch: boolean;
  filters: TableFilter[];
  join: JoinOperator;
  filterableColumns: DataTableColumn<T>[];
  allColumns: DataTableColumn<T>[];
  optionsFor: (column: DataTableColumn<T>) => Option[];
  onFilters: (filters: TableFilter[]) => void;
  onJoin: (join: JoinOperator) => void;
  onClearFilters: () => void;
  hidden: string[];
  onHidden: (hidden: string[]) => void;
  matched: number;
  total: number;
  showColumns: boolean;
  showAdvanced: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // tablecn's shortcut, kept: Ctrl/Cmd+Shift+F opens the builder — but never while the
  // caret is in a field, or it would fight with typing a filter value.
  useEffect(() => {
    if (!showAdvanced) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.key.toLowerCase() === "f" && e.shiftKey && (e.ctrlKey || e.metaKey))) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
      if (typing) return;
      e.preventDefault();
      setAdvancedOpen((o) => !o);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showAdvanced]);

  const chips = filters.map((filter, index) => {
    const column = allColumns.find((c) => c.id === filter.id);
    return { index, filter, column, text: describeFilter(column, filter) };
  });

  const hasToolbar = globalSearch || showAdvanced || (showColumns && allColumns.some((c) => c.hideable !== false));
  if (!hasToolbar && chips.length === 0) return null;

  return (
    <div className="px-14 py-8 border-b border-border flex flex-col gap-8">
      {hasToolbar && (
        <div className="flex items-center gap-8 flex-wrap">
          {globalSearch && (
            <>
              <DebouncedInput
                value={q}
                onCommit={onQ}
                placeholder="Search…"
                className="flex-1 max-w-[280px] bg-panel2 border border-border2 rounded-2 h-24 px-8 text-11 outline-none focus:border-accent"
              />
              {q && (
                <button onClick={() => onQ("")} className="text-9.5 text-faint hover:text-dim">
                  clear
                </button>
              )}
            </>
          )}

          <div className="ml-auto flex items-center gap-8">
            <span className="text-9.5 text-faint font-mono">
              {matched} of {total}
            </span>

            {showAdvanced && filterableColumns.length > 0 && (
              <Dropdown
                width="640px"
                align="right"
                open={advancedOpen}
                onOpenChange={setAdvancedOpen}
                trigger={() => (
                  <span className={`${CONTROL_CLASS} h-22 px-8 ${filters.length > 0 ? "border-accent text-text" : ""}`}>
                    <span>Filter{filters.length > 0 ? ` · ${filters.length}` : ""}</span>
                    <span className="opacity-60">▾</span>
                  </span>
                )}
              >
                {() => (
                  <FilterList
                    filters={filters}
                    join={join}
                    columns={filterableColumns}
                    optionsFor={optionsFor}
                    onChange={onFilters}
                    onJoinChange={onJoin}
                    onReset={onClearFilters}
                  />
                )}
              </Dropdown>
            )}

            {showColumns && <ViewOptions columns={allColumns} hidden={hidden} onChange={onHidden} />}
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="flex items-center gap-6 flex-wrap">
          <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Filters</span>
          {chips.map(({ index, text }, i) => (
            <span key={`${text}-${index}`} className="inline-flex items-center gap-5 border border-border2 bg-panel2 rounded-2 pl-8 pr-4 py-3 text-9.5">
              {/* The join is shown between chips, not on them, because it applies to the
                  whole list — putting "or" on one chip would imply it were per-filter. */}
              {i > 0 && <span className="text-faint font-mono mr-2">{join}</span>}
              {text}
              <button
                type="button"
                onClick={() => onFilters(filters.filter((_, x) => x !== index))}
                aria-label={`Remove filter ${text}`}
                className="text-faint hover:text-bad px-3 leading-none"
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" onClick={onClearFilters} className="text-9.5 text-accent">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/** "Condition: has any of good, fair" — the chip's whole text. */
export function describeFilter<T>(column: DataTableColumn<T> | undefined, filter: TableFilter): string {
  const header = column?.header || filter.id;
  const variant = column ? (variantOf(column) ?? "text") : "text";
  const op = operatorLabel(filter.op, variant).toLowerCase();

  if (VALUELESS_OPERATORS.includes(filter.op)) return `${header}: ${op}`;

  if (filter.op === "isRelativeToToday") {
    const preset = Array.isArray(filter.v) ? filter.v[0] : filter.v;
    const label = RELATIVE_PRESETS.find((p) => p.value === preset)?.label ?? preset;
    return `${header}: ${label.toLowerCase()}`;
  }

  if (filter.op === "isBetween") {
    const [from, to] = Array.isArray(filter.v) ? filter.v : [filter.v, ""];
    if (from && to) return `${header}: ${from} – ${to}`;
    if (from) return `${header}: from ${from}`;
    return `${header}: up to ${to}`;
  }

  const values = Array.isArray(filter.v) ? filter.v : [filter.v];
  const rendered = column ? values.map((v) => labelForValue(column, v)).join(", ") : values.join(", ");
  return `${header}: ${op} ${rendered}`;
}

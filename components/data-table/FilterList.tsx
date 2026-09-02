"use client";

import { ARRAY_OPERATORS, OPERATORS_BY_VARIANT, VALUELESS_OPERATORS, defaultOperator, operatorLabel } from "./config";
import { MiniSelect } from "./Dropdown";
import { FilterValueInput } from "./FilterValueInput";
import { variantOf } from "./filter-logic";
import type { DataTableColumn, FilterOperator, JoinOperator, Option, TableFilter } from "./types";

/**
 * The Notion/Airtable-style filter builder: stacked field · operator · value rows joined by
 * a single and/or. Ported from tablecn's `data-table-filter-list.tsx`, minus drag-to-
 * reorder — the join applies to the whole list rather than per row, so row order cannot
 * change the result and reordering would be pure decoration (plus a dnd dependency).
 *
 * This is the surface that does what the header row cannot: two filters on one column,
 * `or` instead of `and`, and operators like "is not" or "is empty".
 */
export function FilterList<T>({
  filters,
  join,
  columns,
  optionsFor,
  onChange,
  onJoinChange,
  onReset,
}: {
  filters: TableFilter[];
  join: JoinOperator;
  /** Only the filterable columns, in header order. */
  columns: DataTableColumn<T>[];
  optionsFor: (column: DataTableColumn<T>) => Option[];
  onChange: (filters: TableFilter[]) => void;
  onJoinChange: (join: JoinOperator) => void;
  onReset: () => void;
}) {
  const fieldOptions = columns.map((c) => ({ value: c.id, label: c.header || c.id }));

  function replaceAt(index: number, next: TableFilter) {
    onChange(filters.map((f, i) => (i === index ? next : f)));
  }

  /** Moving to another column can invalidate the operator, and every operator has its own
   *  value shape — so both are re-derived rather than carried across. */
  function changeField(index: number, columnId: string) {
    const column = columns.find((c) => c.id === columnId);
    if (!column) return;
    const variant = variantOf(column) ?? "text";
    const op = defaultOperator(variant);
    replaceAt(index, { id: columnId, op, v: emptyValueFor(op) });
  }

  function changeOperator(index: number, op: FilterOperator) {
    const current = filters[index];
    replaceAt(index, { ...current, op, v: coerceValue(current.v, op) });
  }

  function addFilter() {
    const column = columns[0];
    if (!column) return;
    const op = defaultOperator(variantOf(column) ?? "text");
    onChange([...filters, { id: column.id, op, v: emptyValueFor(op) }]);
  }

  return (
    <div className="p-10 flex flex-col gap-8">
      {filters.length === 0 && (
        <div className="text-10.5 text-faint px-2 py-6">
          No filters yet. Add one to narrow this table — several filters can sit on the same
          column, and the whole list can be joined with <span className="font-mono">or</span>.
        </div>
      )}

      {filters.map((filter, i) => {
        const column = columns.find((c) => c.id === filter.id);
        // A filter whose column has gone (a stale link) is still shown so it can be
        // removed, rather than silently disappearing from a URL that still carries it.
        const variant = column ? (variantOf(column) ?? "text") : "text";
        const operators = OPERATORS_BY_VARIANT[variant];

        return (
          <div key={`${filter.id}-${filter.op}-${i}`} className="flex items-center gap-6">
            <div className="w-46 shrink-0 text-10 text-faint">
              {i === 0 ? (
                <span className="pl-2">Where</span>
              ) : i === 1 ? (
                <MiniSelect
                  value={join}
                  onChange={(v) => onJoinChange(v as JoinOperator)}
                  className="w-full"
                  title="Applies to every filter in this list"
                  options={[
                    { value: "and", label: "and" },
                    { value: "or", label: "or" },
                  ]}
                />
              ) : (
                <span className="pl-4 font-mono">{join}</span>
              )}
            </div>

            <MiniSelect
              value={filter.id}
              onChange={(v) => changeField(i, v)}
              className="w-130 shrink-0"
              options={column ? fieldOptions : [{ value: filter.id, label: `${filter.id} (gone)` }, ...fieldOptions]}
            />

            <MiniSelect
              value={filter.op}
              onChange={(v) => changeOperator(i, v as FilterOperator)}
              className="w-120 shrink-0"
              options={operators.map((op) => ({ value: op, label: operatorLabel(op, variant) }))}
            />

            <div className="flex-1 min-w-120">
              {column ? (
                <FilterValueInput
                  variant={variant}
                  op={filter.op}
                  value={filter.v}
                  options={optionsFor(column)}
                  unit={column.unit}
                  range={column.range}
                  onChange={(v) => replaceAt(i, { ...filter, v })}
                />
              ) : (
                <span className="text-10 text-faint">column no longer exists</span>
              )}
            </div>

            <button
              type="button"
              aria-label="Remove this filter"
              onClick={() => onChange(filters.filter((_, x) => x !== i))}
              className="text-faint hover:text-bad px-4 text-12 leading-none shrink-0"
            >
              ×
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-8 pt-4 border-t border-border">
        <button type="button" onClick={addFilter} className="text-10.5 text-accent">
          + Add filter
        </button>
        {filters.length > 0 && (
          <button type="button" onClick={onReset} className="ml-auto text-10.5 text-faint hover:text-dim">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

function emptyValueFor(op: FilterOperator): string | string[] {
  if (VALUELESS_OPERATORS.includes(op)) return "";
  return ARRAY_OPERATORS.includes(op) ? [] : "";
}

/** Carries a value across an operator change where the shapes are compatible, and starts
 *  clean where they are not — "is between 10 and 50" cannot become "is 10, 50". */
function coerceValue(v: string | string[], op: FilterOperator): string | string[] {
  if (VALUELESS_OPERATORS.includes(op)) return "";
  const wantsArray = ARRAY_OPERATORS.includes(op);
  if (wantsArray) {
    if (Array.isArray(v)) return op === "isBetween" ? [v[0] ?? "", v[1] ?? ""] : v;
    return v ? [v] : [];
  }
  return Array.isArray(v) ? (v[0] ?? "") : v;
}

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ARRAY_OPERATORS, VALUELESS_OPERATORS, isOperatorLegal } from "./config";
import { variantOf } from "./filter-logic";
import type {
  DataTableColumn,
  FilterOperator,
  JoinOperator,
  SortEntry,
  TableFilter,
  TableState,
} from "./types";

/**
 * The table's whole view state, in the address bar.
 *
 * This is the point of the rewrite: filter a register, click into a row, hit back — and
 * the filters are still there. Copy the URL to a colleague and they see the same view.
 * Reload and nothing is lost. None of that needed per-page code; it needed the state to
 * stop living in component `useState`.
 *
 * tablecn does this with nuqs. react-router's `useSearchParams` is already mounted here
 * (main.tsx wraps the app in BrowserRouter), so this is a typed codec over that instead of
 * a new dependency — the same call EntityPicker, ComboBox and FacetedFilter already made.
 */

export const DEFAULT_PAGE_SIZE = 25;

/** Keys are prefixed per table, so two tables on one page never collide. */
export function keysFor(tableId?: string) {
  const p = tableId ? `${tableId}_` : "";
  return {
    q: `${p}q`,
    f: `${p}f`,
    join: `${p}join`,
    sort: `${p}sort`,
    page: `${p}page`,
    size: `${p}size`,
    cols: `${p}cols`,
  };
}

export interface CodecOptions {
  tableId?: string;
  /** Used to reject filters/sorts naming columns that do not exist, and to check each
   *  operator against its column's variant. */
  columns: { id: string; variant?: string | undefined }[];
  defaultSize?: number;
}

/** A column list reduced to what the codec needs, so specs need not build real columns. */
export function codecColumns<T>(columns: DataTableColumn<T>[]) {
  return columns.map((c) => ({ id: c.id, variant: variantOf(c) }));
}

export const EMPTY_STATE: TableState = {
  q: "",
  filters: [],
  join: "and",
  sort: [],
  page: 1,
  size: DEFAULT_PAGE_SIZE,
  hidden: [],
};

// ---------------------------------------------------------------- decoding

/**
 * Every branch here degrades rather than throws. A hand-edited URL, a link shared from
 * before a column was renamed, or a truncated paste must render the table with whatever
 * still parses — a blank screen is the one outcome that would make sharing links unsafe.
 */
function decodeFilters(raw: string | null, opts: CodecOptions): TableFilter[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: TableFilter[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.op !== "string") continue;

    const column = opts.columns.find((c) => c.id === e.id);
    if (!column) continue;
    const variant = (column.variant ?? "text") as Parameters<typeof isOperatorLegal>[0];
    const op = e.op as FilterOperator;
    if (!isOperatorLegal(variant, op)) continue;

    let v: string | string[];
    if (VALUELESS_OPERATORS.includes(op)) {
      v = "";
    } else if (ARRAY_OPERATORS.includes(op)) {
      if (!Array.isArray(e.v)) continue;
      v = e.v.filter((x): x is string => typeof x === "string");
    } else {
      if (typeof e.v !== "string") continue;
      v = e.v;
    }
    out.push({ id: e.id, op, v });
  }
  return out;
}

function decodeSort(raw: string | null, opts: CodecOptions): SortEntry[] {
  if (!raw) return [];
  const out: SortEntry[] = [];
  for (const token of raw.split(",")) {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) continue;
    const id = token.slice(0, dot);
    const dir = token.slice(dot + 1);
    if (dir !== "asc" && dir !== "desc") continue;
    if (!opts.columns.some((c) => c.id === id)) continue;
    if (out.some((s) => s.id === id)) continue;
    out.push({ id, desc: dir === "desc" });
  }
  return out;
}

export function decodeTableState(params: URLSearchParams, opts: CodecOptions): TableState {
  const k = keysFor(opts.tableId);
  const defaultSize = opts.defaultSize ?? DEFAULT_PAGE_SIZE;

  const rawPage = Number(params.get(k.page));
  const rawSize = Number(params.get(k.size));
  const join = params.get(k.join);

  return {
    q: params.get(k.q) ?? "",
    filters: decodeFilters(params.get(k.f), opts),
    join: join === "or" ? "or" : "and",
    sort: decodeSort(params.get(k.sort), opts),
    page: Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1,
    size: Number.isInteger(rawSize) && rawSize > 0 ? rawSize : defaultSize,
    hidden: (params.get(k.cols) ?? "")
      .split(",")
      .filter((id) => id !== "" && opts.columns.some((c) => c.id === id)),
  };
}

// ---------------------------------------------------------------- encoding

/**
 * Writes `state` onto a copy of `params`, DELETING anything sitting at its default. An
 * untouched table therefore leaves no trace in the URL, and a shared link carries only
 * what was actually chosen. Params belonging to other tables (or to the route itself, like
 * `?token=`) are carried through untouched.
 */
export function applyTableState(
  params: URLSearchParams,
  state: TableState,
  opts: CodecOptions,
): URLSearchParams {
  const k = keysFor(opts.tableId);
  const next = new URLSearchParams(params);
  const defaultSize = opts.defaultSize ?? DEFAULT_PAGE_SIZE;

  const set = (key: string, value: string, isDefault: boolean) => {
    if (isDefault) next.delete(key);
    else next.set(key, value);
  };

  set(k.q, state.q, state.q.trim() === "");
  set(k.f, JSON.stringify(state.filters), state.filters.length === 0);
  set(k.join, state.join, state.join === "and");
  set(k.sort, state.sort.map((s) => `${s.id}.${s.desc ? "desc" : "asc"}`).join(","), state.sort.length === 0);
  set(k.page, String(state.page), state.page <= 1);
  set(k.size, String(state.size), state.size === defaultSize);
  set(k.cols, state.hidden.join(","), state.hidden.length === 0);

  return next;
}

// ---------------------------------------------------------------- the hook

export interface TableStateActions {
  setQ: (q: string) => void;
  setFilters: (filters: TableFilter[]) => void;
  setJoin: (join: JoinOperator) => void;
  setSort: (sort: SortEntry[]) => void;
  /** Shift-click a header to add a second sort key instead of replacing the first. */
  toggleSort: (id: string, additive?: boolean) => void;
  setPage: (page: number) => void;
  setSize: (size: number) => void;
  setHidden: (hidden: string[]) => void;
  /** Adds or replaces the single filter a header-row control owns. Passing an empty value
   *  removes it, which is what makes the inline controls feel like plain inputs. */
  setColumnFilter: (id: string, op: FilterOperator, v: string | string[]) => void;
  clearColumnFilter: (id: string) => void;
  clearFilters: () => void;
  reset: () => void;
}

export function useTableUrlState(opts: CodecOptions): [TableState, TableStateActions] {
  const [params, setParams] = useSearchParams();
  const { tableId, defaultSize } = opts;
  // Column identity is what the codec validates against; re-deriving the key from it keeps
  // the memo stable across the parent's render-time column rebuilds.
  const columnKey = opts.columns.map((c) => `${c.id}:${c.variant ?? ""}`).join("|");

  const codec = useMemo<CodecOptions>(
    () => ({
      tableId,
      defaultSize,
      columns: columnKey ? columnKey.split("|").map((t) => {
        const i = t.indexOf(":");
        return { id: t.slice(0, i), variant: t.slice(i + 1) || undefined };
      }) : [],
    }),
    [tableId, defaultSize, columnKey],
  );

  const state = useMemo(() => decodeTableState(params, codec), [params, codec]);

  const write = useCallback(
    (patch: Partial<TableState>) => {
      // Narrowing the result set must send you back to page 1, or a filter that leaves
      // three rows silently shows an empty page 4.
      const narrows = patch.filters !== undefined || patch.q !== undefined || patch.join !== undefined;
      setParams(
        (prev) => {
          const current = decodeTableState(prev, codec);
          const merged: TableState = { ...current, ...patch };
          if (narrows && patch.page === undefined) merged.page = 1;
          return applyTableState(prev, merged, codec);
        },
        // `replace` throughout: typing into a filter must not push a history entry per
        // keystroke, and back should leave the page rather than rewind a search.
        { replace: true },
      );
    },
    [setParams, codec],
  );

  const actions = useMemo<TableStateActions>(() => {
    const setFilters = (filters: TableFilter[]) => write({ filters });
    return {
      setQ: (q) => write({ q }),
      setFilters,
      setJoin: (join) => write({ join }),
      setSort: (sort) => write({ sort }),
      toggleSort: (id, additive = false) => {
        setParams(
          (prev) => {
            const current = decodeTableState(prev, codec);
            const existing = current.sort.find((s) => s.id === id);
            // asc → desc → off, so a third click restores the natural order.
            const nextForId: SortEntry[] = !existing
              ? [{ id, desc: false }]
              : existing.desc
                ? []
                : [{ id, desc: true }];
            const sort = additive
              ? [...current.sort.filter((s) => s.id !== id), ...nextForId]
              : nextForId;
            return applyTableState(prev, { ...current, sort }, codec);
          },
          { replace: true },
        );
      },
      setPage: (page) => write({ page }),
      setSize: (size) => write({ size, page: 1 }),
      setHidden: (hidden) => write({ hidden }),
      setColumnFilter: (id, op, v) => {
        setParams(
          (prev) => {
            const current = decodeTableState(prev, codec);
            const blank = VALUELESS_OPERATORS.includes(op)
              ? false
              : Array.isArray(v)
                ? v.every((x) => x === "")
                : v === "";
            // The header control owns the FIRST filter on its column; any further ones the
            // advanced builder added are left untouched, so editing inline cannot silently
            // discard half of a two-sided range someone built there.
            const at = current.filters.findIndex((f) => f.id === id);
            let filters: TableFilter[];
            if (at === -1) {
              filters = blank ? current.filters : [...current.filters, { id, op, v }];
            } else if (blank) {
              filters = current.filters.filter((_, i) => i !== at);
            } else {
              filters = current.filters.map((f, i) => (i === at ? { id, op, v } : f));
            }
            return applyTableState(prev, { ...current, filters, page: 1 }, codec);
          },
          { replace: true },
        );
      },
      clearColumnFilter: (id) => {
        setParams(
          (prev) => {
            const current = decodeTableState(prev, codec);
            return applyTableState(
              prev,
              { ...current, filters: current.filters.filter((f) => f.id !== id), page: 1 },
              codec,
            );
          },
          { replace: true },
        );
      },
      clearFilters: () => write({ filters: [], q: "", join: "and" }),
      reset: () =>
        setParams((prev) => applyTableState(prev, { ...EMPTY_STATE, size: defaultSize ?? DEFAULT_PAGE_SIZE }, codec), {
          replace: true,
        }),
    };
  }, [write, setParams, codec, defaultSize]);

  return [state, actions];
}

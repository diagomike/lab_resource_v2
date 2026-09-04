"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ExpandedState, RowSelectionState } from "@tanstack/react-table";
import { buildRollup, buildSearchList, buildTree, indexItems, type RowNode } from "@/lib/domain/tree";
import type { FilterRule } from "@/lib/domain/filters";
import { api, ApiError } from "@/lib/api";
import { filterOperators, type ItemRowDto } from "@/lib/shared";
import { toDomainItem } from "./adapt";

export type RegisterMode = "tree" | "rollup" | "flat";

export const MODE_LABEL: Record<RegisterMode, string> = {
  tree: "Hierarchy",
  rollup: "Inventory summary",
  flat: "Search list",
};

export const MODE_HELP: Record<RegisterMode, string> = {
  tree: "Physical containment — what is inside what",
  rollup: "Each place's whole subtree grouped by category",
  flat: "Every matching item as a flat list with its location",
};

const MODES: RegisterMode[] = ["tree", "rollup", "flat"];

/**
 * Core fields (status/category/owner/currentOrg/custodian) stay their own readable
 * URL params — a shareable link like `?categoryId=x&status=WORKING` reads better than
 * JSON. `rules`/`join` carry the rest of the generalised engine (prop:/desc: synthetic
 * fields, any operator `lib/domain/filters.ts` implements, several rules per field) as
 * one JSON-encoded array, since there is no flat query-string shape for an open-ended
 * rule set — the same split `lib/server/resources/items.ts`'s `ItemQuery` makes.
 */
export interface RegisterFilters {
  q: string;
  categoryId: string;
  status: string;
  ownerOrgNodeId: string;
  currentOrgNodeId: string;
  custodianId: string;
  rules: FilterRule[];
  join: "and" | "or";
}

const CORE_KEYS = ["q", "categoryId", "status", "ownerOrgNodeId", "currentOrgNodeId", "custodianId"] as const satisfies readonly (keyof RegisterFilters)[];

export const EMPTY_FILTERS: RegisterFilters = {
  q: "",
  categoryId: "",
  status: "",
  ownerOrgNodeId: "",
  currentOrgNodeId: "",
  custodianId: "",
  rules: [],
  join: "and",
};

function readMode(sp: URLSearchParams): RegisterMode {
  const raw = sp.get("mode");
  return (MODES as string[]).includes(raw ?? "") ? (raw as RegisterMode) : "tree";
}

/** A hand-edited URL can carry anything under `?rules=`; the server re-validates it
 *  with the same Zod schema this mirrors, but the client renders these rules directly
 *  (chip labels, describeRule's `.join` calls) before that round-trip, so a malformed
 *  entry needs to be dropped here too rather than crashing the register. */
function isFilterRule(v: unknown): v is FilterRule {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.field === "string" &&
    typeof r.op === "string" &&
    (filterOperators as readonly string[]).includes(r.op) &&
    Array.isArray(r.values) &&
    r.values.every((x) => typeof x === "string")
  );
}

function readRules(sp: URLSearchParams): FilterRule[] {
  const raw = sp.get("rules");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isFilterRule) : [];
  } catch {
    return [];
  }
}

function readFilters(sp: URLSearchParams): RegisterFilters {
  const out = { ...EMPTY_FILTERS };
  for (const key of CORE_KEYS) out[key] = sp.get(key) ?? "";
  out.rules = readRules(sp);
  out.join = sp.get("join") === "or" ? "or" : "and";
  return out;
}

function appendFilterParams(qp: URLSearchParams, filters: RegisterFilters): void {
  for (const key of CORE_KEYS) if (filters[key]) qp.set(key, filters[key]);
  if (filters.rules.length) {
    qp.set("rules", JSON.stringify(filters.rules));
    if (filters.join === "or") qp.set("join", "or");
  }
}

function toQueryString(mode: RegisterMode, filters: RegisterFilters, extra?: Record<string, string>): string {
  const qp = new URLSearchParams();
  if (mode !== "tree") qp.set("mode", mode);
  appendFilterParams(qp, filters);
  if (extra) for (const [k, v] of Object.entries(extra)) if (v) qp.set(k, v);
  const s = qp.toString();
  return s ? `?${s}` : "";
}

function toApiParams(filters: RegisterFilters, scope?: "UNIVERSITY"): string {
  const qp = new URLSearchParams();
  appendFilterParams(qp, filters);
  if (scope) qp.set("scope", scope);
  const s = qp.toString();
  return s ? `?${s}` : "";
}

const PAGE_SIZE = 50;

/**
 * Everything the register view needs, derived once. Deliberately thin compared to
 * temp_works' own `useRegisterState` — scope, filtering, sorting, pagination, facet
 * counts and effective status are ALL server-side now (lib/server/resources/items.ts,
 * Phase 4 of ~/.claude/plans/wait-i-want-gentle-haven.md), so this hook's job is just:
 * hold filter/mode/page state (persisted to the URL — a reload must reproduce the
 * same query), fetch the rows for the current mode, and shape them into RowNode[]
 * client-side via lib/domain/tree.ts, exactly as that module's own header says client
 * code should.
 *
 * `scope: "UNIVERSITY"` is the one addition for the university-wide browse (10b of
 * ~/.claude/plans/three-product-changes-dynamic-thompson.md) — it rides along on
 * every fetch this hook makes as `?scope=UNIVERSITY`, and every read endpoint that
 * honours it re-checks `assertCanBrowseUniversity` server-side regardless of what
 * this hook sends. `/register` itself never passes this option; only `/university`
 * does — the same hook, parameterized, per that page's own "reuse, don't fork" note.
 */
export function useRegisterState(opts?: { scope?: "UNIVERSITY" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = opts?.scope;

  const mode = readMode(searchParams);
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [rows, setRows] = useState<ItemRowDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [selection, setSelection] = useState<RowSelectionState>({});
  /** Bumped by `refetch()` to re-run the fetch effect below with the exact same
   *  mode/filters/page — what an edit surface calls after a write applies, so the
   *  table reflects it without a full page reload or router navigation (neither mode
   *  nor filters actually changed, so nothing else would re-trigger the effect). */
  const [reloadToken, setReloadToken] = useState(0);
  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const apiParams = toApiParams(filters, scope);

    const request =
      mode === "flat"
        ? api.get<{ items: ItemRowDto[]; total: number }>(
            `/resources/items${apiParams}${apiParams ? "&" : "?"}page=${page}&pageSize=${PAGE_SIZE}`,
          )
        : api.get<{ items: ItemRowDto[] }>(`/resources/items/tree${apiParams}`).then((r) => ({ items: r.items, total: r.items.length }));

    request
      .then((r) => {
        if (cancelled) return;
        setRows(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Could not load the register");
        setRows([]);
        setTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, filters, page, reloadToken, scope]);

  const setFilters = useCallback(
    (patch: Partial<RegisterFilters>) => {
      router.replace(`${pathname}${toQueryString(mode, { ...filters, ...patch })}`);
    },
    [router, pathname, mode, filters],
  );

  const clearFilters = useCallback(() => {
    router.replace(`${pathname}${toQueryString(mode, EMPTY_FILTERS)}`);
  }, [router, pathname, mode]);

  const setMode = useCallback(
    (next: RegisterMode) => {
      setExpanded({});
      router.replace(`${pathname}${toQueryString(next, filters)}`);
    },
    [router, pathname, filters],
  );

  const setPage = useCallback(
    (next: number) => {
      router.replace(`${pathname}${toQueryString(mode, filters, { page: String(next) })}`);
    },
    [router, pathname, mode, filters],
  );

  const domainItems = useMemo(() => (rows ?? []).map(toDomainItem), [rows]);
  const index = useMemo(() => indexItems(domainItems), [domainItems]);
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);

  const rowNodes = useMemo<RowNode[]>(() => {
    if (!rows) return [];
    if (mode === "flat") {
      return rows.map((r, i) => ({
        kind: "item" as const,
        id: r.id,
        item: domainItems[i],
        children: [],
        memberIds: [r.id],
        depth: 0,
      }));
    }
    return mode === "rollup" ? buildRollup(index, null) : buildTree(index, null);
  }, [mode, rows, domainItems, index]);

  /** Real item ids the current TanStack row selection speaks for — a cluster row's
   *  `memberIds` are every item behind it, so selecting one selected row can resolve
   *  to many ids. Editing a cluster row is a bulk edit of its members for exactly
   *  this reason (lib/domain/tree.ts's own header). Walks the whole nested tree, not
   *  just the roots `rowNodes` holds directly, since TanStack tracks selection by row
   *  id at any depth via `getSubRows`. */
  const selectedItemIds = useMemo(() => {
    const selectedRowIds = new Set(Object.keys(selection).filter((k) => selection[k]));
    if (!selectedRowIds.size) return [];
    const out = new Set<string>();
    const walk = (nodes: RowNode[]) => {
      for (const n of nodes) {
        if (selectedRowIds.has(n.id)) for (const id of n.memberIds) out.add(id);
        if (n.children.length) walk(n.children);
      }
    };
    walk(rowNodes);
    return [...out];
  }, [selection, rowNodes]);

  return {
    mode,
    setMode,
    filters,
    setFilters,
    clearFilters,
    rows,
    rowNodes,
    /** Row-DTO lookup — the denormalised names (categoryName, ownerOrgNodeName, ...)
     *  tree.ts's domain Item doesn't carry. */
    byId,
    total,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    loading: rows === null,
    error,
    expanded,
    setExpanded,
    selection,
    setSelection,
    selectedIds: Object.keys(selection).filter((k) => selection[k]),
    selectedItemIds,
    refetch,
  };
}

export type RegisterState = ReturnType<typeof useRegisterState>;

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ExpandedState, RowSelectionState } from "@tanstack/react-table";
import { buildRollup, buildSearchList, buildTree, indexItems, type RowNode } from "@/lib/domain/tree";
import { api, ApiError } from "@/lib/api";
import type { ItemRowDto } from "@/lib/shared";
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
 * Core fields only, not the full generalised `ItemFilterState` (rules, prop:/desc:
 * synthetic fields, the wider operator set) — that merge of the two filter engines
 * (see lib/shared/resources/item-filter.ts's own note) is future work. These six
 * cover what items.ts's `parseItemQuery` already accepts, which is what makes this
 * simple: no server-side change was needed to wire this filter bar up.
 */
export interface RegisterFilters {
  q: string;
  categoryId: string;
  status: string;
  ownerOrgNodeId: string;
  currentOrgNodeId: string;
  custodianId: string;
}

export const EMPTY_FILTERS: RegisterFilters = {
  q: "",
  categoryId: "",
  status: "",
  ownerOrgNodeId: "",
  currentOrgNodeId: "",
  custodianId: "",
};

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof RegisterFilters)[];

function readMode(sp: URLSearchParams): RegisterMode {
  const raw = sp.get("mode");
  return (MODES as string[]).includes(raw ?? "") ? (raw as RegisterMode) : "tree";
}

function readFilters(sp: URLSearchParams): RegisterFilters {
  const out = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) out[key] = sp.get(key) ?? "";
  return out;
}

function toQueryString(mode: RegisterMode, filters: RegisterFilters, extra?: Record<string, string>): string {
  const qp = new URLSearchParams();
  if (mode !== "tree") qp.set("mode", mode);
  for (const key of FILTER_KEYS) if (filters[key]) qp.set(key, filters[key]);
  if (extra) for (const [k, v] of Object.entries(extra)) if (v) qp.set(k, v);
  const s = qp.toString();
  return s ? `?${s}` : "";
}

function toApiParams(filters: RegisterFilters): string {
  const qp = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key]) qp.set(key, filters[key]);
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
 */
export function useRegisterState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mode = readMode(searchParams);
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [rows, setRows] = useState<ItemRowDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [selection, setSelection] = useState<RowSelectionState>({});

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const apiParams = toApiParams(filters);

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
  }, [mode, filters, page]);

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
  };
}

export type RegisterState = ReturnType<typeof useRegisterState>;

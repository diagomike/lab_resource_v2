"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ExpandedState, RowSelectionState } from "@tanstack/react-table";
import { buildRollup, buildSearchList, buildTree, groupRows, indexItems, type GroupKey, type RowNode } from "@/lib/domain/tree";
import type { Item } from "@/lib/domain/types";
import type { FilterRule } from "@/lib/domain/filters";
import { api, ApiError } from "@/lib/api";
import { filterOperators, type ItemRowDto, type OrgNodeDto, type ResourceCategoryDto } from "@/lib/shared";
import { toDomainItem } from "./adapt";
import { useActiveViewId } from "./active-view";

export type RegisterMode = "grouped" | "tree" | "rollup" | "flat";

export const MODE_LABEL: Record<RegisterMode, string> = {
  grouped: "Grouped",
  tree: "Hierarchy",
  rollup: "Inventory summary",
  flat: "Search list",
};

export const MODE_HELP: Record<RegisterMode, string> = {
  grouped: "Resources gathered under headings — by unit, custodian, category… — each keeping its own contents",
  tree: "Physical containment — what is inside what",
  rollup: "Each place's whole subtree grouped by category",
  flat: "Every matching item as a flat list with its location",
};

const MODES: RegisterMode[] = ["grouped", "tree", "rollup", "flat"];

/** What the grouped view can gather by. Units nest along the org chart. */
export const GROUP_BY_OPTIONS = [
  { key: "owner", label: "Owning unit" },
  { key: "department", label: "Department" },
  { key: "current", label: "Current unit" },
  { key: "custodian", label: "Custodian" },
  { key: "category", label: "Category" },
  { key: "categoryGroup", label: "Category group" },
  { key: "status", label: "Status" },
] as const;
export type GroupByKey = (typeof GROUP_BY_OPTIONS)[number]["key"];
const GROUP_KEYS = GROUP_BY_OPTIONS.map((o) => o.key) as string[];

function readGroupBy(sp: URLSearchParams, fallback: GroupByKey[]): GroupByKey[] {
  const raw = sp.get("group");
  if (raw === null) return fallback;
  return raw.split(",").filter((k): k is GroupByKey => GROUP_KEYS.includes(k)).slice(0, 3);
}

const KIND_ICON: Record<string, string> = { UNIVERSITY: "Landmark", COLLEGE: "Building2", DEPARTMENT: "Building", OFFICE: "Briefcase" };

/** One level function per chosen grouping — item → its path of group keys. */
function levelFunctions(
  levels: GroupByKey[],
  byId: Map<string, ItemRowDto>,
  orgNodes: OrgNodeDto[],
  categories: ResourceCategoryDto[],
): Array<(item: Item) => GroupKey[]> {
  const nodeById = new Map(orgNodes.map((n) => [n.id, n]));
  const unitChain = (id: string, fallbackName: string): GroupKey[] => {
    const out: GroupKey[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = nodeById.get(cur);
      if (!n) break;
      out.unshift({ id: `u:${n.id}`, label: n.name, iconKey: KIND_ICON[n.kind] });
      cur = n.parentIds[0];
    }
    return out.length ? out : [{ id: `u:${id}`, label: fallbackName }];
  };
  const department = (id: string, fallbackName: string): GroupKey[] => {
    const seen = new Set<string>();
    let cur: string | undefined = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = nodeById.get(cur);
      if (!n) break;
      if (n.kind === "DEPARTMENT") return [{ id: `d:${n.id}`, label: n.name, iconKey: "Building" }];
      cur = n.parentIds[0];
    }
    return [{ id: `d:${id}`, label: nodeById.get(id)?.name ?? fallbackName, iconKey: "Building" }];
  };
  const catById = new Map(categories.map((c) => [c.id, c]));
  return levels.map((level) => (item: Item): GroupKey[] => {
    const row = byId.get(item.id);
    switch (level) {
      case "owner":
        return unitChain(item.ownerOrgNodeId, row?.ownerOrgNodeName ?? "Unknown unit");
      case "current":
        return unitChain(item.currentOrgNodeId, row?.currentOrgNodeName ?? "Unknown unit");
      case "department":
        return department(item.ownerOrgNodeId, row?.ownerOrgNodeName ?? "Unknown unit");
      case "custodian":
        return [{ id: `p:${item.custodianId}`, label: row?.custodianName ?? "Unknown custodian", iconKey: "User" }];
      case "category":
        return [{ id: `c:${item.categoryId}`, label: row?.categoryName ?? "Unknown category", iconKey: row?.categoryIconKey }];
      case "categoryGroup": {
        const c = catById.get(item.categoryId);
        return [{ id: `cg:${c?.groupId ?? "none"}`, label: c?.groupName ?? "Ungrouped", iconKey: "Layers3" }];
      }
      case "status":
        return [{ id: `s:${row?.effectiveStatus ?? item.status}`, label: (row?.effectiveStatus ?? item.status).replace(/_/g, " ").toLowerCase() }];
    }
  });
}

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

function readMode(sp: URLSearchParams, fallback: RegisterMode): RegisterMode {
  const raw = sp.get("mode");
  return (MODES as string[]).includes(raw ?? "") ? (raw as RegisterMode) : fallback;
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
  qp.set("mode", mode);
  appendFilterParams(qp, filters);
  if (extra) for (const [k, v] of Object.entries(extra)) if (v) qp.set(k, v);
  const s = qp.toString();
  return s ? `?${s}` : "";
}

/** `viewId` (Track 1's access views) and `scope: "UNIVERSITY"` (10b) are mutually
 *  exclusive on the wire — a page that sets `scope` never also has a view id to send
 *  (see useRegisterState's own note), but if it somehow did, the server's
 *  `resolveReadOverride` honours `scope` first regardless of what this sends. */
export function toApiParams(filters: RegisterFilters, scope?: "UNIVERSITY", viewId?: string | null): string {
  const qp = new URLSearchParams();
  appendFilterParams(qp, filters);
  if (scope) qp.set("scope", scope);
  else if (viewId) qp.set("view", viewId);
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
 *
 * The person's currently chosen access view (Track 1) rides along the same way, as
 * `?view=<id>`, whenever `scope` is NOT set — `active-view.ts`'s `useActiveViewId()`,
 * reactive so switching the sidebar's picker re-fetches without a navigation. Every
 * endpoint that honours it re-resolves it server-side (`views.ts`'s
 * `resolveEffectiveView`) exactly like `scope=UNIVERSITY` already does; this hook
 * never decides what the view actually grants, only which id to ask for.
 */
export function useRegisterState(opts?: {
  scope?: "UNIVERSITY";
  fixedMode?: RegisterMode;
  /** What this page opens in when the URL doesn't say (University resources: grouped). */
  defaultMode?: RegisterMode;
  defaultGroupBy?: GroupByKey[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = opts?.scope;
  const activeViewId = useActiveViewId();
  const viewId = scope ? null : activeViewId;

  const defaultMode = opts?.defaultMode ?? "tree";
  const mode = opts?.fixedMode ?? readMode(searchParams, defaultMode);
  const defaultGroupBy = opts?.defaultGroupBy ?? ["owner"];
  const groupByParam = searchParams.get("group");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groupBy = useMemo(() => readGroupBy(searchParams, defaultGroupBy), [groupByParam]);
  const storageKey = `lrms.register.view:${pathname}`;
  /** Filter/page changes keep the chosen grouping in the URL. */
  const keepGroup: Record<string, string> = groupByParam !== null ? { group: groupByParam } : {};

  // The grouped view needs the org chart (units nest) and category groups — fetched
  // once, only when that view is actually used.
  const [orgNodes, setOrgNodes] = useState<OrgNodeDto[]>([]);
  const [categoryList, setCategoryList] = useState<ResourceCategoryDto[]>([]);
  const needsGroupData = mode === "grouped";
  useEffect(() => {
    if (!needsGroupData || orgNodes.length) return;
    api.getShared<OrgNodeDto[]>("/org/nodes").then(setOrgNodes).catch(() => setOrgNodes([]));
    api.getShared<ResourceCategoryDto[]>("/resources/categories").then(setCategoryList).catch(() => setCategoryList([]));
  }, [needsGroupData, orgNodes.length]);

  // No mode in the URL: reopen this page the way it was last left (per browser).
  useEffect(() => {
    if (opts?.fixedMode || searchParams.get("mode")) return;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as { mode?: RegisterMode; group?: string } | null;
      if (saved?.mode && (MODES as string[]).includes(saved.mode) && saved.mode !== defaultMode) {
        const qp = new URLSearchParams(searchParams.toString());
        qp.set("mode", saved.mode);
        if (saved.group !== undefined) qp.set("group", saved.group);
        router.replace(`${pathname}?${qp.toString()}`);
      }
    } catch {
      // storage unavailable — the page default stands
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remember = (m: RegisterMode, g: GroupByKey[]) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ mode: m, group: g.join(",") }));
    } catch {
      // per-browser convenience only
    }
  };
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [rows, setRows] = useState<ItemRowDto[] | null>(null);
  const [total, setTotal] = useState(0);
  /** The genuine filter matches among `rows` (the rest are ancestors and parts shown
   *  around them as context), or null when nothing is filtered. */
  const [matchedIds, setMatchedIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [selection, setSelection] = useState<RowSelectionState>({});
  /** Bumped by `refetch()` to re-run the fetch effect below with the exact same
   *  mode/filters/page — what an edit surface calls after a write applies, so the
   *  table reflects it without a full page reload or router navigation (neither mode
   *  nor filters actually changed, so nothing else would re-trigger the effect). */
  const [reloadToken, setReloadToken] = useState(0);
  const refetch = useCallback(() => setReloadToken((t) => t + 1), []);
  /** True while a `refetch()` is in flight — the table keeps showing the previous rows
   *  (expanded rows, selection and scroll intact) and swaps the new ones in when they
   *  arrive, rather than blanking to a skeleton after every save. */
  const [refreshing, setRefreshing] = useState(false);
  /** Identity of what is being shown. Only a change here (a different mode, filter,
   *  page, scope or view) clears the table; a bare reload keeps it on screen. */
  const queryKey = JSON.stringify([mode, filters, page, scope ?? null, viewId ?? null]);
  const shownKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sameQuery = shownKey.current === queryKey;
    if (sameQuery) setRefreshing(true);
    else setRows(null);
    setError(null);
    const apiParams = toApiParams(filters, scope, viewId);

    const request =
      mode === "flat"
        ? api
            .get<{ items: ItemRowDto[]; total: number }>(`/resources/items${apiParams}${apiParams ? "&" : "?"}page=${page}&pageSize=${PAGE_SIZE}`)
            .then((r) => ({ ...r, matchedIds: null as string[] | null }))
        : api
            .get<{ items: ItemRowDto[]; matchedIds?: string[] | null }>(`/resources/items/tree${apiParams}`)
            .then((r) => ({ items: r.items, total: r.items.length, matchedIds: r.matchedIds ?? null }));

    request
      .then((r) => {
        if (cancelled) return;
        shownKey.current = queryKey;
        setRows(r.items);
        setTotal(r.total);
        setMatchedIds(r.matchedIds);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Could not load the register");
        if (!sameQuery) {
          setRows([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, reloadToken]);

  const setFilters = useCallback(
    (patch: Partial<RegisterFilters>) => {
      router.replace(`${pathname}${toQueryString(mode, { ...filters, ...patch }, keepGroup)}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, mode, filters, groupByParam],
  );

  const clearFilters = useCallback(() => {
    router.replace(`${pathname}${toQueryString(mode, EMPTY_FILTERS, keepGroup)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, pathname, mode, groupByParam]);

  const setMode = useCallback(
    (next: RegisterMode) => {
      setExpanded({});
      remember(next, groupBy);
      router.replace(`${pathname}${toQueryString(next, filters, next === "grouped" ? { group: groupBy.join(",") } : undefined)}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, filters, groupBy],
  );

  const setGroupBy = useCallback(
    (next: GroupByKey[]) => {
      remember("grouped", next);
      router.replace(`${pathname}${toQueryString("grouped", filters, { group: next.join(",") || "none" })}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, filters],
  );

  const setPage = useCallback(
    (next: number) => {
      router.replace(`${pathname}${toQueryString(mode, filters, { ...keepGroup, page: String(next) })}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, mode, filters, groupByParam],
  );

  const domainItems = useMemo(() => (rows ?? []).map(toDomainItem), [rows]);
  const index = useMemo(() => indexItems(domainItems), [domainItems]);
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r])), [rows]);
  const matched = useMemo(() => (matchedIds ? new Set(matchedIds) : null), [matchedIds]);
  /** What the filter bar's written summary reads: every matching row in the tree views;
   *  only the count in the paged search list (one page can't be broken down honestly). */
  const filterSummary = useMemo<{ matches?: ItemRowDto[] | null; matchCount?: number }>(() => {
    if (!rows) return {};
    if (mode === "flat") return { matches: null, matchCount: total };
    return matched ? { matches: rows.filter((r) => matched.has(r.id)) } : {};
  }, [rows, mode, total, matched]);
  /** The matches in an item's own subtree, itself included — what a row's quantity and
   *  roll-ups count while a filter is on. Cached per item for the current rows. */
  const matchedUnder = useMemo(() => {
    const cache = new Map<string, string[]>();
    const under = (id: string): string[] => {
      const hit = cache.get(id);
      if (hit) return hit;
      const out = matched?.has(id) ? [id] : [];
      for (const c of index.childrenOf.get(id) ?? []) out.push(...under(c.id));
      cache.set(id, out);
      return out;
    };
    return under;
  }, [index, matched]);

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
    if (mode === "grouped") return groupRows(buildTree(index, null), levelFunctions(groupBy, byId, orgNodes, categoryList));
    return mode === "rollup" ? buildRollup(index, null) : buildTree(index, null);
  }, [mode, rows, domainItems, index, groupBy, byId, orgNodes, categoryList]);

  // The grouped view opens with its headings expanded (the hierarchy is the point) and
  // each resource's own contents collapsed — once per grouping, never fighting a
  // person's own collapsing afterwards.
  const autoExpandedFor = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "grouped" || rows === null) return;
    const key = `${queryKey}|${groupBy.join(",")}|${orgNodes.length > 0}`;
    if (autoExpandedFor.current === key) return;
    autoExpandedFor.current = key;
    const open: Record<string, boolean> = {};
    const walk = (nodes: RowNode[]) => {
      for (const n of nodes) {
        if (n.kind !== "group") continue;
        open[n.id] = true;
        walk(n.children);
      }
    };
    walk(rowNodes);
    setExpanded(open);
  }, [mode, rows, rowNodes, queryKey, groupBy, orgNodes.length]);

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
    groupBy,
    setGroupBy,
    filters,
    setFilters,
    clearFilters,
    /** The view id actually in effect for this fetch (`null` under `scope:
     *  "UNIVERSITY"`, or when no view is chosen) — for a caller that makes its OWN
     *  separate request against the same scope (DashboardPage's `/summary` fetch) to
     *  reuse via `toApiParams`, rather than re-deriving it. */
    viewId,
    rows,
    rowNodes,
    /** Filter matches among `rows` (null: not filtering) and the matches under any
     *  item — see `matchedUnder`'s own note. */
    matched,
    matchedUnder,
    filterSummary,
    /** Row-DTO lookup — the denormalised names (categoryName, ownerOrgNodeName, ...)
     *  tree.ts's domain Item doesn't carry. */
    byId,
    total,
    page,
    setPage,
    pageSize: PAGE_SIZE,
    loading: rows === null,
    refreshing,
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

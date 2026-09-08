import "server-only";
import {
  effectiveStatuses as EFFECTIVE_STATUSES,
  ItemFilterRule as ItemFilterRuleSchema,
  type ContainerOptionDto,
  type EffectiveStatus,
  type ItemDetailDto,
  type ItemFacetCounts,
  type ItemFilterFieldDef,
  type ItemRowDto,
  type ItemSummaryDto,
  type TransferDestinationDto,
} from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { computeStatuses, statusOf } from "@/lib/domain/status";
import { canPlace } from "@/lib/domain/placement";
import { descendantCategories, indexItems, pathOf, subtreeIds, type TreeIndex } from "@/lib/domain/tree";
import {
  buildFilterFields,
  customPropFilterFields,
  facetCounts as domainFacetCounts,
  fieldValues,
  matchItems,
  newRule,
  type FilterCtx,
  type FilterRule,
  type FilterState,
} from "@/lib/domain/filters";
import { expandMatches } from "@/lib/domain/tree";
import { unitsOf, withAncestors } from "@/lib/domain/item-scope";
import type { Category, Item as DomainItem, OrgNode as DomainOrgNode } from "@/lib/domain/types";
import * as scope from "./scope";
import type { ScopeOverride } from "./scope";
import { toDomainCategoryMap, toDomainItem } from "./adapt";
import { z } from "zod";

/**
 * Resource READS. Every query goes through a scoped "forest" — the whole
 * (undeleted) containment forest, loaded once per request and used to compute
 * derived status and tree/rollup/search rows alike, per lib/domain/status.ts's own
 * contract ("must never be called against a caller's scoped item set... scope the
 * RESULT, not the input"). ItemScopeService (scope.ts) decides which of those
 * globally-computed rows a given caller's response may actually include — scope is
 * never re-derived here.
 *
 * ASTU-scale item counts are in the thousands, not yet the 10⁴–10⁵ the plan's risk
 * table anticipates; loading the whole table per request is the accepted, documented
 * cost of correctness for now (~/.claude/plans/wait-i-want-gentle-haven.md §9). Hot
 * paths get denormalised/cached later if measured slow, not guessed at now.
 */

interface Forest {
  items: DomainItem[];
  categories: Record<string, Category>;
  index: TreeIndex;
  statuses: ReturnType<typeof computeStatuses>;
  descCats: ReturnType<typeof descendantCategories>;
}

async function loadForest(): Promise<Forest> {
  const [itemRows, categoryRows] = await Promise.all([
    prisma.item.findMany({ where: { deletedAt: null }, include: { images: true } }),
    prisma.resourceCategory.findMany({ include: { group: { select: { name: true } }, fields: true, templateAsParent: true, placementRulesAsChild: true } }),
  ]);
  const categories = toDomainCategoryMap(categoryRows);
  const items = itemRows.map((r) => toDomainItem(r, r.images));
  const index = indexItems(items);
  return { items, categories, index, statuses: computeStatuses(items, categories), descCats: descendantCategories(index) };
}

/** `base` is what the caller's scope directly grants (org reach / custody); `closed`
 *  additionally pulls in every ancestor, so the hierarchy view never has to render a
 *  visible item inside an invisible container. The difference between the two is
 *  exactly `readOnlyContext`.
 *
 * `extraFilters`, when given (an access view's saved query — Track 1 of
 * ~/.claude/plans/lets-merge-the-work-memoized-journal.md), narrows `base` BEFORE
 * `closed` is derived from it — a mandatory server-side AND, never merged into the
 * caller's own editable filter state. This is the one choke point every list read
 * (search/tree/facets/filterFields/summary) shares, so a view's saved filter and its
 * scope are applied identically everywhere rather than each read re-deriving it. */
async function computeScopedIds(
  userId: string,
  forest: Forest,
  scopeOverride?: ScopeOverride,
  extraFilters?: FilterState | null,
): Promise<{ base: Set<string>; closed: Set<string> }> {
  const resolved = await scope.resolveScope(userId, scopeOverride?.mode, scopeOverride?.explicitNodeIds);
  let base: Set<string>;
  if (resolved.mode === "UNIVERSITY") base = new Set(forest.items.map((i) => i.id));
  else if (resolved.mode === "MY_CUSTODY") base = new Set(resolved.custodyItemIds ?? []);
  else base = new Set(forest.items.filter((i) => unitsOf(i).some((u) => resolved.visibleNodeIds.includes(u))).map((i) => i.id));

  if (extraFilters) {
    const matched = matchItems(forest.items, extraFilters, ctxOf(forest));
    base = new Set([...base].filter((id) => matched.has(id)));
  }
  return { base, closed: withAncestors(forest.index, base) };
}

async function nameLookups(): Promise<{ nodeName: Map<string, string>; userName: Map<string, string> }> {
  const [nodes, users] = await Promise.all([
    prisma.orgNode.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  return { nodeName: new Map(nodes.map((n) => [n.id, n.name])), userName: new Map(users.map((u) => [u.id, u.name])) };
}

function toRowDto(
  item: DomainItem,
  forest: Pick<Forest, "categories" | "index" | "statuses">,
  lookups: { nodeName: Map<string, string>; userName: Map<string, string> },
  readOnlyContext: boolean,
): ItemRowDto {
  const category = forest.categories[item.categoryId];
  return {
    id: item.id,
    parentId: item.parentId,
    categoryId: item.categoryId,
    categoryName: category?.name ?? item.categoryId,
    categoryIconKey: category?.iconKey ?? "Package",
    name: item.name,
    countingMode: category?.countingMode ?? "SERIALIZED",
    qty: item.qty,
    status: item.status,
    effectiveStatus: statusOf(forest.statuses, item.id),
    critical: item.critical,
    props: item.props,
    ownerOrgNodeId: item.ownerOrgNodeId,
    ownerOrgNodeName: lookups.nodeName.get(item.ownerOrgNodeId) ?? "",
    currentOrgNodeId: item.currentOrgNodeId,
    currentOrgNodeName: lookups.nodeName.get(item.currentOrgNodeId) ?? "",
    custodianId: item.custodianId,
    custodianName: lookups.userName.get(item.custodianId) ?? "",
    version: item.version,
    path: pathOf(forest.index, item.id),
    thumbnailUrl: item.images[0]?.src ?? null,
    readOnlyContext,
  };
}

export interface ItemQuery {
  q?: string;
  categoryId?: string;
  status?: EffectiveStatus;
  ownerOrgNodeId?: string;
  currentOrgNodeId?: string;
  custodianId?: string;
  /** The full generalised filter engine — prop:/desc: synthetic fields and any
   *  operator `lib/domain/filters.ts` implements — additional to the core fields
   *  above, which stay their own params for a readable, bookmarkable URL. Combined
   *  with the core-field rules under one `join`. */
  rules?: FilterRule[];
  join?: "and" | "or";
}

const RulesParam = z.array(ItemFilterRuleSchema);

/** Shared by every Route Handler that takes filters as query params (search/tree/
 *  facets). Core fields (`categoryId`/`status`/`owner...`/`custodianId`) stay plain,
 *  readable params; `rules` carries the rest of the generalised engine — prop:/desc:
 *  synthetic fields, any implemented operator, several rules per field — as one
 *  JSON-encoded array, since there is no flat query-string shape for an open-ended
 *  rule set. An unparseable `rules` param is treated as absent rather than a 400 —
 *  a malformed filter should show "no filter", not break the whole register. */
export function parseItemQuery(sp: URLSearchParams): ItemQuery {
  const statusParam = sp.get("status");
  const joinParam = sp.get("join");
  const rawRules = sp.get("rules");
  let rules: FilterRule[] | undefined;
  if (rawRules) {
    try {
      const parsed = RulesParam.safeParse(JSON.parse(rawRules));
      if (parsed.success) rules = parsed.data;
    } catch {
      // malformed JSON — treated as no advanced rules, not a 400 (see header comment)
    }
  }
  return {
    q: sp.get("q") ?? undefined,
    categoryId: sp.get("categoryId") ?? undefined,
    status: statusParam && (EFFECTIVE_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as EffectiveStatus) : undefined,
    ownerOrgNodeId: sp.get("ownerOrgNodeId") ?? undefined,
    currentOrgNodeId: sp.get("currentOrgNodeId") ?? undefined,
    custodianId: sp.get("custodianId") ?? undefined,
    rules,
    join: joinParam === "or" ? "or" : "and",
  };
}

function buildFilterState(query: ItemQuery): FilterState {
  const rules = [...(query.rules ?? [])];
  if (query.categoryId) rules.push(newRule("category", [query.categoryId]));
  if (query.status) rules.push(newRule("status", [query.status]));
  if (query.ownerOrgNodeId) rules.push(newRule("owner", [query.ownerOrgNodeId]));
  if (query.currentOrgNodeId) rules.push(newRule("currentOrg", [query.currentOrgNodeId]));
  if (query.custodianId) rules.push(newRule("custodian", [query.custodianId]));
  return { search: query.q ?? "", join: query.join ?? "and", rules };
}

function ctxOf(forest: Forest): FilterCtx {
  return { statuses: forest.statuses, descCats: forest.descCats, categories: forest.categories, index: forest.index };
}

export interface SearchResult {
  items: ItemRowDto[];
  total: number;
}

/** The flat search list — genuine matches only, no ancestor padding (that is what
 *  distinguishes it from `tree()`). Scope is applied to the result before the page is
 *  sliced, never after. */
export async function search(
  userId: string,
  query: ItemQuery,
  page = 1,
  pageSize = 50,
  scopeOverride?: ScopeOverride,
  extraFilters?: FilterState | null,
): Promise<SearchResult> {
  const forest = await loadForest();
  const { base } = await computeScopedIds(userId, forest, scopeOverride, extraFilters);
  const matched = matchItems(forest.items, buildFilterState(query), ctxOf(forest));

  const rows = [...base]
    .filter((id) => matched.has(id))
    .map((id) => forest.index.byId.get(id)!)
    .sort((a, b) => a.name.localeCompare(b.name));

  const total = rows.length;
  const safePage = Math.max(1, page);
  const safeSize = Math.min(200, Math.max(1, pageSize));
  const pageRows = rows.slice((safePage - 1) * safeSize, safePage * safeSize);

  const lookups = await nameLookups();
  // Every row here is a base match, never ancestor-only context — readOnlyContext is
  // tree()'s distinction, not search()'s (see this function's own header comment).
  return { items: pageRows.map((item) => toRowDto(item, forest, lookups, false)), total };
}

/** The whole scoped+matched set, ancestor AND descendant closed, unpaginated — the
 *  substrate lib/domain/tree.ts's `buildTree`/`buildRollup` (client-side, per that
 *  module's own header — they are pure and meant to run in the browser too) group
 *  into Hierarchy or Rollup mode. Both view modes fetch from here; which one a person
 *  is looking at is a rendering choice, not a different query. */
export async function tree(userId: string, query: ItemQuery, scopeOverride?: ScopeOverride, extraFilters?: FilterState | null): Promise<{ items: ItemRowDto[] }> {
  const forest = await loadForest();
  const { base, closed } = await computeScopedIds(userId, forest, scopeOverride, extraFilters);
  const matched = matchItems(forest.items, buildFilterState(query), ctxOf(forest));
  const expanded = expandMatches(forest.index, matched);
  const keep = [...closed].filter((id) => expanded.has(id));

  const lookups = await nameLookups();
  const rows = keep.map((id) => forest.index.byId.get(id)!).map((item) => toRowDto(item, forest, lookups, !base.has(item.id)));
  return { items: rows };
}

/** enum→multiSelect: every enum field here is queried with inArray/notInArray
 *  (lib/domain/filters.ts's `opsFor`), i.e. a checked set, not a single choice. Group
 *  has no wire equivalent — dropped, not lost, since nothing renders it (the filter
 *  builder groups by category name client-side instead). This list includes the
 *  synthetic prop:/desc: fields for whichever categories the caller names as active
 *  (`filterFields`'s `activeCategoryIds`) — those, plus the core fields, are exactly
 *  what `ItemQuery.rules`/`parseItemQuery` accept back. */
function toWireFilterField(f: {
  id: string;
  label: string;
  kind: "enum" | "text" | "number";
  options?: Array<{ value: string; label: string }>;
  unit?: string;
}): ItemFilterFieldDef {
  return {
    id: f.id,
    label: f.label,
    variant: f.kind === "enum" ? "multiSelect" : f.kind,
    options: f.options,
    unit: f.unit,
  };
}

async function domainFilterFields(userId: string, activeCategoryIds: string[], forest: Forest, scopeOverride?: ScopeOverride, extraFilters?: FilterState | null) {
  const { closed } = await computeScopedIds(userId, forest, scopeOverride, extraFilters);
  const places = forest.index.roots.filter((r) => closed.has(r.id));
  // Scoped BEFORE custom-property keys are collected — see customPropFilterFields's
  // own note on why an out-of-scope item's custom key must never surface here.
  const scopedItems = forest.items.filter((i) => closed.has(i.id));

  // The custodian filter option list is exactly the custodians who actually appear on
  // items this caller can see — never the whole user table (that was a name leak on
  // the ordinary register: every account's name, regardless of reach, handed to every
  // caller). Deriving it from `scopedItems` needs no extra query and is, for a FILTER
  // dropdown specifically, the semantically correct set: a value that could not match
  // anything you can see has no reason to be offered. `orgNode` stays unscoped — the
  // org chart is not confidential and the owner/current-unit filters are useless
  // without every unit in them.
  const custodianIds = new Set(scopedItems.map((i) => i.custodianId).filter((id): id is string => Boolean(id)));

  const [nodeRows, people] = await Promise.all([
    prisma.orgNode.findMany({ include: { incomingEdges: true } }),
    prisma.user.findMany({ where: { id: { in: [...custodianIds] } }, select: { id: true, name: true } }),
  ]);
  const orgNodes: DomainOrgNode[] = nodeRows.map((n) => ({
    id: n.id,
    name: n.name,
    kind: n.kind,
    level: n.level,
    parentIds: n.incomingEdges.map((e) => e.parentId),
    occupantId: n.userId,
    active: n.active,
  }));

  return [...buildFilterFields(forest.categories, activeCategoryIds, places, orgNodes, people), ...customPropFilterFields(scopedItems)];
}

export async function filterFields(
  userId: string,
  activeCategoryIds: string[],
  scopeOverride?: ScopeOverride,
  extraFilters?: FilterState | null,
): Promise<ItemFilterFieldDef[]> {
  const forest = await loadForest();
  const fields = await domainFilterFields(userId, activeCategoryIds, forest, scopeOverride, extraFilters);
  return fields.map(toWireFilterField);
}

export async function facets(userId: string, query: ItemQuery, scopeOverride?: ScopeOverride, extraFilters?: FilterState | null): Promise<ItemFacetCounts> {
  const forest = await loadForest();
  const { closed } = await computeScopedIds(userId, forest, scopeOverride, extraFilters);
  const scopedItems = forest.items.filter((i) => closed.has(i.id));
  const state = buildFilterState(query);
  const ctx = ctxOf(forest);
  const fields = await domainFilterFields(userId, [...new Set(scopedItems.map((i) => i.categoryId))], forest, scopeOverride, extraFilters);

  const out: Record<string, Record<string, number>> = {};
  for (const field of fields) {
    const counts = domainFacetCounts(scopedItems, state, ctx, field);
    out[field.id] = Object.fromEntries(counts);
  }
  return out;
}

const NEEDS_ATTENTION: EffectiveStatus[] = ["BROKEN", "IMPAIRED", "UNDER_MAINTENANCE", "LOST"];

/** Dashboard totals over the exact same direct-scope, genuine-match set returned by
 * `search()`. Context-only ancestors are a tree navigation aid, not resources that
 * should inflate the dashboard, and every filter is applied before counting so the
 * cards, charts, and matching hierarchy always answer the same question. */
export async function summary(
  userId: string,
  scopeOverride?: ScopeOverride,
  query: ItemQuery = {},
  extraFilters?: FilterState | null,
): Promise<ItemSummaryDto> {
  const forest = await loadForest();
  const { base } = await computeScopedIds(userId, forest, scopeOverride, extraFilters);
  const matched = matchItems(forest.items, buildFilterState(query), ctxOf(forest));
  const ids = [...base].filter((id) => matched.has(id));
  const selected = ids.map((id) => forest.index.byId.get(id)!).filter(Boolean);
  const byEffectiveStatus: Record<string, number> = {};
  let needsAttention = 0;
  for (const item of selected) {
    const s = statusOf(forest.statuses, item.id);
    byEffectiveStatus[s] = (byEffectiveStatus[s] ?? 0) + 1;
    if (NEEDS_ATTENTION.includes(s)) needsAttention += 1;
  }

  const lookups = await nameLookups();
  const ctx = ctxOf(forest);
  const labelFor: Record<"owner" | "currentOrg" | "location" | "custodian" | "category", (key: string) => string> = {
    owner: (key) => lookups.nodeName.get(key) ?? "Unassigned",
    currentOrg: (key) => lookups.nodeName.get(key) ?? "Unassigned",
    location: (key) => forest.index.byId.get(key)?.name ?? "Unassigned",
    custodian: (key) => lookups.userName.get(key) ?? "Unassigned",
    category: (key) => forest.categories[key]?.name ?? key,
  };

  function aggregate(field: keyof typeof labelFor) {
    const rows = new Map<string, { total: number; byEffectiveStatus: Record<string, number> }>();
    for (const item of selected) {
      const status = statusOf(forest.statuses, item.id);
      const values = fieldValues(item, field, ctx);
      for (const key of values.length ? values : [""]) {
        const row = rows.get(key) ?? { total: 0, byEffectiveStatus: {} };
        row.total += 1;
        row.byEffectiveStatus[status] = (row.byEffectiveStatus[status] ?? 0) + 1;
        rows.set(key, row);
      }
    }
    return [...rows.entries()]
      .map(([key, row]) => ({
        key,
        label: labelFor[field](key),
        total: row.total,
        byEffectiveStatus: row.byEffectiveStatus as Record<EffectiveStatus, number>,
      }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }

  return {
    total: selected.length,
    byEffectiveStatus: byEffectiveStatus as Record<EffectiveStatus, number>,
    needsAttention,
    breakdowns: {
      owner: aggregate("owner"),
      currentOrg: aggregate("currentOrg"),
      location: aggregate("location"),
      custodian: aggregate("custodian"),
      category: aggregate("category"),
    },
  };
}

/**
 * Candidate destinations for placing an item of `categoryId` — the single picker
 * behind AddModal's "Into", the register toolbar's "Move to…", and Inspector's
 * parent picker (10a of ~/.claude/plans/wait-i-want-gentle-haven.md). Three
 * independent filters, all required:
 *  - in scope — the caller can at least SEE it (an invisible item is not a choosable
 *    destination, regardless of custody);
 *  - write-eligible — the caller could actually place something inside it, the exact
 *    policy `scope.assertCanMutate` enforces at write time (SYS_ADMIN anywhere, every
 *    other role only its own custody-or-beneath) — checked here so the list never
 *    shows an option the write path would then 404;
 *  - placement-legal — `canPlace` allows `categoryId` inside that destination's own
 *    category (lib/domain/placement.ts).
 * `excludeSubtreeIds`, if given, drops every destination inside (or equal to) one of
 * those items — the "Move to…"/parent-picker case, where a selected item obviously
 * cannot become its own descendant; mutate.ts's own `isWithinSubtree` still enforces
 * this at write time regardless, this only keeps it from appearing choosable.
 */
export async function containers(userId: string, categoryId: string, excludeSubtreeIds: string[] = []): Promise<ContainerOptionDto[]> {
  const forest = await loadForest();
  if (!forest.categories[categoryId]) throw new HttpError(400, "Choose an existing category.");

  const { base: visible } = await computeScopedIds(userId, forest);
  const writable = (await scope.isSysAdmin(userId)) ? null : new Set(await scope.custodyItemIdsOf(userId));

  const excluded = new Set(subtreeIds(forest.index, excludeSubtreeIds));

  const options = [...visible]
    .filter((id) => !excluded.has(id))
    .filter((id) => writable === null || writable.has(id))
    .map((id) => forest.index.byId.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null)
    .filter((item) => canPlace(forest.categories, categoryId, item.categoryId))
    .sort((a, b) => a.name.localeCompare(b.name));

  return options.map((item) => {
    const category = forest.categories[item.categoryId];
    return {
      id: item.id,
      name: item.name,
      categoryId: item.categoryId,
      categoryName: category?.name ?? item.categoryId,
      categoryIconKey: category?.iconKey ?? "Package",
      path: pathOf(forest.index, item.id),
    };
  });
}

/**
 * Candidate TRANSFER destinations (Track 3, `GET /resources/transfers/destinations`)
 * — deliberately the opposite of `containers()` above: a transfer's whole point is a
 * destination OUTSIDE the requester's own custody, so this has no `writable` filter
 * and no `computeScopedIds` visibility filter either (the requester may have never
 * seen the receiving department's register at all). What still applies:
 *  - custody of the SOURCE item(s) being transferred, the same floor requesting a
 *    transfer itself requires;
 *  - placement-legal for EVERY selected item's category, same as a real transfer
 *    would enforce at apply time;
 *  - the destination's current org node must be active.
 * A non-empty, ≥2-character search query is required and results are capped — this
 * is a narrow "name the place you already have in mind" search, never a full
 * cross-university browse/dump (see the plan's own §6.5 for why, and the possible
 * alternative flagged there).
 */
export async function transferDestinations(userId: string, itemIds: string[], q: string): Promise<TransferDestinationDto[]> {
  const query = q.trim();
  if (query.length < 2) throw new HttpError(400, "Type at least 2 characters to search.");
  if (!itemIds.length) throw new HttpError(400, "Choose at least one resource to transfer.");
  await scope.assertCanMutate(userId, itemIds);

  const forest = await loadForest();
  const sourceItems = itemIds.map((id) => forest.index.byId.get(id)).filter((i): i is NonNullable<typeof i> => i != null);
  if (sourceItems.length !== itemIds.length) throw new HttpError(400, "One or more of these resources no longer exist.");

  const excluded = new Set(subtreeIds(forest.index, itemIds));
  const needle = query.toLowerCase();

  const activeNodes = await prisma.orgNode.findMany({ where: { active: true }, select: { id: true, name: true } });
  const nodeNameById = new Map(activeNodes.map((n) => [n.id, n.name]));

  const options = forest.items
    .filter((item) => !excluded.has(item.id))
    .filter((item) => item.name.toLowerCase().includes(needle))
    .filter((item) => nodeNameById.has(item.currentOrgNodeId))
    .filter((item) => sourceItems.every((source) => canPlace(forest.categories, source.categoryId, item.categoryId)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25);

  return options.map((item) => {
    const category = forest.categories[item.categoryId];
    return {
      id: item.id,
      name: item.name,
      categoryId: item.categoryId,
      categoryName: category?.name ?? item.categoryId,
      categoryIconKey: category?.iconKey ?? "Package",
      path: pathOf(forest.index, item.id),
      orgNodeId: item.currentOrgNodeId,
      orgNodeName: nodeNameById.get(item.currentOrgNodeId) ?? "",
    };
  });
}

/** Out-of-scope returns 404, not 403 — a 403 would confirm the row exists. No
 *  `extraFilters` parameter — a saved view query narrows LISTS, exactly like the
 *  ordinary core-field filters already do; it has never gated a direct point read by
 *  id (see items.ts's own `ItemQuery` note), and a view is no different. */
export async function getOne(userId: string, id: string, scopeOverride?: ScopeOverride): Promise<ItemDetailDto> {
  await scope.assertCanSeeItem(userId, id, scopeOverride?.mode, scopeOverride?.explicitNodeIds);
  const forest = await loadForest();
  const item = forest.index.byId.get(id);
  if (!item) throw new HttpError(404, "Resource not found");

  const [{ base }, lookups, images] = await Promise.all([
    computeScopedIds(userId, forest, scopeOverride),
    nameLookups(),
    prisma.itemImage.findMany({ where: { itemId: id }, orderBy: { sortOrder: "asc" } }),
  ]);
  const row = toRowDto(item, forest, lookups, !base.has(id));
  return {
    ...row,
    images: images.map((img) => ({ id: img.id, url: `/api/resources/images/${img.storageKey}`, caption: img.caption, sortOrder: img.sortOrder })),
    customProps: item.customProps ?? {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

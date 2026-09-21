"use client";

import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronsDownUp } from "lucide-react";
import type { EffectiveStatus, ItemSummaryBreakdownDto, ItemSummaryDto } from "@/lib/shared";
import { NEEDS_ATTENTION, STATUS_LABEL } from "@/lib/domain/status";
import { newRule } from "@/lib/domain/filters";
import { toApiParams, useRegisterState, type RegisterFilters } from "@/lib/register/useRegisterState";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { DashboardDonut, DashboardRankedBars, type DashboardChartSegment } from "./DashboardCharts";
import { FilterBar } from "./FilterBar";
import { Inspector } from "./Inspector";
import { ResourceTable } from "./ResourceTable";

const STATUS_ORDER: EffectiveStatus[] = ["WORKING", "IMPAIRED", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"];

const STATUS_COLOR: Record<EffectiveStatus, string> = {
  WORKING: "var(--good)",
  IMPAIRED: "var(--warn)",
  BROKEN: "var(--bad)",
  UNDER_MAINTENANCE: "var(--cross)",
  LOST: "var(--dim)",
  CONSUMED: "var(--faint)",
};

type SummaryDimension = keyof ItemSummaryDto["breakdowns"];
type CoreDashboardFilterKey = "categoryId" | "ownerOrgNodeId" | "currentOrgNodeId" | "custodianId";

const DIMENSIONS: Array<{
  id: SummaryDimension;
  label: string;
  field: "category" | "owner" | "currentOrg" | "custodian" | "location";
  filterKey?: CoreDashboardFilterKey;
}> = [
  { id: "owner", label: "Owning unit", field: "owner", filterKey: "ownerOrgNodeId" },
  { id: "currentOrg", label: "Current unit", field: "currentOrg", filterKey: "currentOrgNodeId" },
  { id: "location", label: "Lab / location", field: "location" },
  { id: "custodian", label: "Custodian", field: "custodian", filterKey: "custodianId" },
  { id: "category", label: "Category", field: "category", filterKey: "categoryId" },
];

const CATEGORY_COLORS = ["var(--accent)", "var(--good)", "var(--cross)", "var(--warn)", "var(--bad)"];
const STAT_TONE_CLASS = { good: "text-good", warn: "text-warn", bad: "text-bad" } as const;

/** Management view over the caller's own scope. The filter bar, stat tiles, every
 * chart mark, and the Register hierarchy all write/read one URL-backed filter state,
 * preserving temp_works' useful "ask another question without leaving" behavior. */
function DashboardPageInner() {
  const state = useRegisterState({ fixedMode: "tree" });
  const [summary, setSummary] = useState<ItemSummaryDto | null>(null);
  const [dimension, setDimension] = useState<SummaryDimension>("owner");
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allExpanded = state.expanded === true;

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    api
      .get<ItemSummaryDto>(`/resources/items/summary${toApiParams(state.filters, undefined, state.viewId)}`)
      .then((result) => !cancelled && setSummary(result))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Could not load the dashboard"));
    return () => {
      cancelled = true;
    };
  }, [state.filters, state.viewId]);

  const hasFilters = Boolean(
    state.filters.q ||
      state.filters.categoryId ||
      state.filters.status ||
      state.filters.ownerOrgNodeId ||
      state.filters.currentOrgNodeId ||
      state.filters.custodianId ||
      state.filters.rules.length,
  );

  const activeStatusKeys = useMemo(() => {
    const values = new Set<string>();
    if (state.filters.status) values.add(state.filters.status);
    for (const rule of state.filters.rules) {
      if (rule.field === "status" && rule.op === "inArray") for (const value of rule.values) values.add(value);
    }
    return [...values];
  }, [state.filters.status, state.filters.rules]);

  function toggleCoreFilter(key: CoreDashboardFilterKey | "status", field: string, value: string) {
    const rules = state.filters.rules.filter((rule) => rule.field !== field);
    state.setFilters({
      [key]: state.filters[key] === value ? "" : value,
      rules,
    } as Partial<RegisterFilters>);
  }

  function toggleRuleValue(field: string, value: string) {
    const existing = state.filters.rules.find((rule) => rule.field === field && rule.op === "inArray");
    if (!existing) {
      state.setFilters({ rules: [...state.filters.rules, newRule(field, [value])] });
      return;
    }
    const values = existing.values.includes(value) ? existing.values.filter((entry) => entry !== value) : [...existing.values, value];
    state.setFilters({
      rules: values.length
        ? state.filters.rules.map((rule) => (rule.id === existing.id ? { ...rule, values } : rule))
        : state.filters.rules.filter((rule) => rule.id !== existing.id),
    });
  }

  function toggleAttention() {
    const attention = new Set<string>(NEEDS_ATTENTION);
    const active =
      !state.filters.status &&
      state.filters.rules.some(
        (rule) =>
          rule.field === "status" &&
          rule.op === "inArray" &&
          rule.values.length === attention.size &&
          rule.values.every((value) => attention.has(value)),
      );
    const rules = state.filters.rules.filter((rule) => rule.field !== "status");
    state.setFilters({ status: "", rules: active ? rules : [...rules, newRule("status", [...NEEDS_ATTENTION])] });
  }

  function toggleDimensionValue(selected: (typeof DIMENSIONS)[number], value: string) {
    if (!value) return;
    if (selected.filterKey) toggleCoreFilter(selected.filterKey, selected.field, value);
    else toggleRuleValue(selected.field, value);
  }

  function dimensionValueIsActive(selected: (typeof DIMENSIONS)[number], value: string) {
    if (selected.filterKey) return state.filters[selected.filterKey] === value;
    return state.filters.rules.some((rule) => rule.field === selected.field && rule.op === "inArray" && rule.values.includes(value));
  }

  const selectedDimension = DIMENSIONS.find((entry) => entry.id === dimension)!;
  const dimensionRows = summary?.breakdowns[dimension].slice(0, 12) ?? [];
  const working = summary?.byEffectiveStatus.WORKING ?? 0;
  const operationalPercent = !summary?.total ? 0 : Math.round((working / summary.total) * 100);
  const attentionFilterActive = activeStatusKeys.length === NEEDS_ATTENTION.length && NEEDS_ATTENTION.every((status) => activeStatusKeys.includes(status));

  const conditionSegments: DashboardChartSegment[] = summary
    ? STATUS_ORDER.filter((status) => (summary.byEffectiveStatus[status] ?? 0) > 0).map((status) => ({
        key: status,
        label: STATUS_LABEL[status],
        value: summary.byEffectiveStatus[status] ?? 0,
        color: STATUS_COLOR[status],
      }))
    : [];

  const categoryRows = (summary?.breakdowns.category ?? []).slice(0, 8).map((row, index) => ({
    key: row.key,
    label: row.label,
    value: row.total,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  }));

  const problemLocations = (summary?.breakdowns.location ?? [])
    .map((row) => ({
      key: row.key,
      label: row.label,
      value: NEEDS_ATTENTION.reduce((total, status) => total + (row.byEffectiveStatus[status] ?? 0), 0),
      color: "var(--bad)",
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  const activeLocationKeys = state.filters.rules
    .filter((rule) => rule.field === "location" && rule.op === "inArray")
    .flatMap((rule) => rule.values);

  return (
    <Screen>
      {(error || state.error) && <ErrorNote>{error ?? state.error}</ErrorNote>}
      <Panel title="Filter dashboard">
        <FilterBar filters={state.filters} onChange={state.setFilters} onClear={state.clearFilters} />
      </Panel>
      {!summary ? (
        <Panel title="Overview">
          <PanelLoading rows={6} />
        </Panel>
      ) : (
        <>
          <div className="grid gap-10 sm:grid-cols-3">
            <StatTile
              label={hasFilters ? "Matching resources" : "Resources in your scope"}
              value={summary.total.toLocaleString()}
              sub={hasFilters ? "under the current filter" : "available to you"}
            />
            <StatTile
              label="Fully operational"
              value={`${operationalPercent}%`}
              sub={`${working.toLocaleString()} working normally`}
              tone={operationalPercent >= 90 ? "good" : operationalPercent >= 75 ? "warn" : "bad"}
              active={activeStatusKeys.length === 1 && activeStatusKeys[0] === "WORKING"}
              onClick={() => toggleCoreFilter("status", "status", "WORKING")}
            />
            <StatTile
              label="Needs attention"
              value={summary.needsAttention.toLocaleString()}
              sub="broken, impaired, in maintenance or lost"
              tone={summary.needsAttention === 0 ? "good" : "bad"}
              active={attentionFilterActive}
              onClick={toggleAttention}
            />
          </div>

          <div className="grid gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
            <Panel title="Condition">
              {summary.total === 0 ? (
                <EmptyChart>Nothing matches the current filter.</EmptyChart>
              ) : (
                <DashboardDonut
                  segments={conditionSegments}
                  centerValue={summary.total.toLocaleString()}
                  centerLabel={hasFilters ? "matching" : "resources"}
                  activeKeys={activeStatusKeys}
                  onSelect={(status) => toggleCoreFilter("status", "status", status)}
                />
              )}
            </Panel>

            <Panel
              title="Breakdown"
              actions={
                <div className="flex flex-wrap overflow-hidden rounded-2 border border-border2">
                  {DIMENSIONS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setDimension(entry.id)}
                      className={`h-22 border-r border-border2 px-8 text-9.5 font-medium last:border-r-0 ${
                        dimension === entry.id ? "bg-accent text-white" : "bg-panel2 text-dim hover:text-text"
                      }`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              }
            >
              <BreakdownTable
                label={selectedDimension.label}
                rows={dimensionRows}
                isActive={(value) => dimensionValueIsActive(selectedDimension, value)}
                onSelectValue={(value) => toggleDimensionValue(selectedDimension, value)}
                onSelectStatus={(status) => toggleCoreFilter("status", "status", status)}
              />
            </Panel>
          </div>

          <div className="grid gap-14 lg:grid-cols-2">
            <Panel title="What we own most of">
              <DashboardRankedBars
                rows={categoryRows}
                activeKeys={state.filters.categoryId ? [state.filters.categoryId] : []}
                onSelect={(categoryId) => toggleCoreFilter("categoryId", "category", categoryId)}
              />
            </Panel>
            <Panel
              title="Where the problems are"
              actions={
                summary.needsAttention > 0 ? (
                  <span className="rounded-2 bg-badbg px-7 py-3 font-mono text-9.5 font-medium text-bad">
                    {summary.needsAttention} items
                  </span>
                ) : null
              }
            >
              <DashboardRankedBars
                rows={problemLocations}
                activeKeys={activeLocationKeys}
                onSelect={(locationId) => toggleRuleValue("location", locationId)}
                emptyText="Nothing needs attention here."
              />
            </Panel>
          </div>

          <Panel
            title={hasFilters ? "Matching resource hierarchy" : "Register hierarchy"}
            actions={
              <button
                type="button"
                onClick={() => state.setExpanded(allExpanded ? {} : true)}
                title={allExpanded ? "Collapse every row" : "Expand every row"}
                className="flex h-24 items-center gap-5 rounded-2 border border-border2 bg-panel2 px-9 text-10.5 text-dim"
              >
                <ChevronsDownUp className="size-13" />
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
            }
          >
            {state.loading ? (
              <PanelLoading rows={6} />
            ) : (
              <ResourceTable
                rows={state.rowNodes}
                byId={state.byId}
                expanded={state.expanded}
                onExpandedChange={state.setExpanded}
                selection={state.selection}
                onSelectionChange={state.setSelection}
                onInspect={setInspectId}
                selectable={false}
              />
            )}
          </Panel>

          <Inspector itemId={inspectId} onClose={() => setInspectId(null)} onChanged={state.refetch} onNavigate={setInspectId} />
        </>
      )}
    </Screen>
  );
}

function BreakdownTable({
  label,
  rows,
  isActive,
  onSelectValue,
  onSelectStatus,
}: {
  label: string;
  rows: ItemSummaryBreakdownDto[];
  isActive: (value: string) => boolean;
  onSelectValue: (value: string) => void;
  onSelectStatus: (status: EffectiveStatus) => void;
}) {
  if (rows.length === 0) return <EmptyChart>Nothing matches the current filter.</EmptyChart>;
  return (
    <div className="overflow-x-auto p-14">
      <table className="w-full min-w-[560px] text-10.5">
        <thead>
          <tr className="text-9.5 uppercase tracking-label text-faint">
            <th className="pb-7 text-left font-semibold">{label}</th>
            <th className="pb-7 text-right font-semibold">Total</th>
            <th className="pb-7 text-right font-semibold">Working</th>
            <th className="w-[38%] pb-7 pl-12 text-left font-semibold">Condition</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const working = row.byEffectiveStatus.WORKING ?? 0;
            return (
              <tr key={row.key} className="border-t border-border">
                <td className="py-7 pr-8">
                  <button
                    type="button"
                    onClick={() => onSelectValue(row.key)}
                    className={`max-w-230 truncate rounded-2 px-5 py-3 text-left hover:text-accent ${isActive(row.key) ? "bg-sel text-accent" : ""}`}
                  >
                    {row.label}
                  </button>
                </td>
                <td className="py-7 text-right font-mono font-medium">{row.total}</td>
                <td className="py-7 text-right font-mono">
                  <span className={working === row.total ? "text-good" : ""}>{working}</span>
                  <span className="ml-5 text-9.5 text-faint">({Math.round((working / row.total) * 100)}%)</span>
                </td>
                <td className="py-7 pl-12">
                  <div className="flex h-7 w-full overflow-hidden rounded-full bg-panel3">
                    {STATUS_ORDER.map((status) => {
                      const count = row.byEffectiveStatus[status] ?? 0;
                      if (!count) return null;
                      return (
                        <button
                          key={status}
                          type="button"
                          title={`${row.label} · ${STATUS_LABEL[status]}: ${count}`}
                          aria-label={`Filter by ${STATUS_LABEL[status]}`}
                          onClick={() => onSelectStatus(status)}
                          style={{ width: `${(count / row.total) * 100}%`, background: STATUS_COLOR[status] }}
                          className="h-full hover:opacity-70"
                        />
                      );
                    })}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** useSearchParams inside the shared register state requires a Suspense boundary. */
export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardPageInner />
    </Suspense>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "warn" | "bad";
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="text-9.5 font-semibold uppercase tracking-label text-faint">{label}</div>
      <div className={`mt-4 font-mono text-21 font-semibold ${tone ? STAT_TONE_CLASS[tone] : ""}`}>{value}</div>
      <div className="mt-3 text-10 text-dim">{sub}</div>
    </>
  );
  const className = `rounded-3 border bg-panel px-14 py-12 text-left ${
    active ? "border-accent bg-soft" : "border-border"
  } ${onClick ? "transition-colors hover:border-accent hover:bg-panel2" : ""}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="px-14 py-32 text-center text-11 text-faint">{children}</div>;
}

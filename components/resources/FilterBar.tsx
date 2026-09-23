"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemFilterFieldDef, FilterVariant, ItemRowDto } from "@/lib/shared";
import { STATUS_LABEL } from "@/lib/domain/status";
import { opsFor, OP_LABEL, VALUELESS_OPS, newRule, type FilterOp, type FilterRule } from "@/lib/domain/filters";
import { api } from "@/lib/api";
import { Button, Tag } from "@/components/ui";
import type { RegisterFilters } from "@/lib/register/useRegisterState";

/**
 * Core fields get their own dropdowns (status/category/owner/currentOrg/custodian) —
 * unchanged from before. Everything else the register can filter on — the "location"/
 * "contains" fields and every category's own and descendant ("parts") properties —
 * goes through the "Add filter" builder below as an `ItemQuery.rules` entry, closing
 * the disclosed Phase 6 gap: the full lib/domain/filters.ts engine (prop:/desc:
 * synthetic fields, its whole operator set, AND/OR composition), not core fields only.
 */
type CoreFilterKey = "categoryId" | "status" | "ownerOrgNodeId" | "currentOrgNodeId" | "custodianId";
const CORE_FIELDS: Array<{ id: string; key: CoreFilterKey }> = [
  { id: "category", key: "categoryId" },
  { id: "status", key: "status" },
  { id: "owner", key: "ownerOrgNodeId" },
  { id: "currentOrg", key: "currentOrgNodeId" },
  { id: "custodian", key: "custodianId" },
];
const CORE_FIELD_IDS = new Set(CORE_FIELDS.map((f) => f.id));

/** The wire's `variant` collapses down to the domain `opsFor`'s three field kinds —
 *  every variant `buildFilterFields`/`toWireFilterField` actually produces is one of
 *  these three (multiSelect for enum, or text/number verbatim). */
function kindOf(variant: FilterVariant): "enum" | "text" | "number" {
  return variant === "multiSelect" ? "enum" : variant === "number" ? "number" : "text";
}

function describeRule(field: ItemFilterFieldDef | undefined, rule: FilterRule): string {
  const label = field?.label ?? rule.field;
  if (VALUELESS_OPS.includes(rule.op)) return `${label} ${rule.op === "isEmpty" ? "is blank" : "is filled in"}`;
  const shown = rule.values.map((v) => field?.options?.find((o) => o.value === v)?.label ?? v);
  const verb = rule.op === "inArray" ? "is" : rule.op === "notInArray" ? "is not" : rule.op === "contains" ? "contains" : rule.op === "gte" ? "≥" : "≤";
  return `${label} ${verb} ${shown.join(" or ")}${field?.unit ? ` ${field.unit}` : ""}`;
}

/** A checked set of options behind a button, opening as an absolutely-positioned
 *  floating panel — not a native `<select multiple>`, whose inline listbox either
 *  crops most options into a 1-line box or, sized open, pushes the whole toolbar
 *  taller every time someone picks an enum field. Closes on an outside click or Esc. */
function MultiSelectPopover({
  options,
  selected,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  const summary =
    selected.length === 0 ? "Select…" : selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? selected[0]) : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-24 min-w-[120px] px-8 rounded-2 border border-border2 bg-panel text-10.5 text-left outline-none focus:border-accent"
      >
        {summary}
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-2 min-w-[160px] max-h-[220px] overflow-y-auto rounded-2 border border-border2 bg-panel py-2">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-6 px-8 py-4 text-10.5 whitespace-nowrap cursor-pointer hover:bg-panel2">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function AddRuleForm({ fields, onAdd }: { fields: ItemFilterFieldDef[]; onAdd: (rule: FilterRule) => void }) {
  const [fieldId, setFieldId] = useState("");
  const [op, setOp] = useState<FilterOp>("inArray");
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const field = fields.find((f) => f.id === fieldId);
  const ops = field ? opsFor(kindOf(field.variant)) : [];

  // The available fields shrink whenever the active category changes (or clears) —
  // most visibly on "Clear filters", which drops categoryId and so every prop:/desc:
  // field along with it. Without this, `fieldId` keeps pointing at an option that no
  // longer exists: `field` resolves to undefined, and the operator/value/Add controls
  // below (all gated on `field`) silently disappear instead of the builder resetting
  // to its own empty state.
  useEffect(() => {
    if (fieldId && !fields.some((f) => f.id === fieldId)) {
      setFieldId("");
      setText("");
      setSelected([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  function resetValue() {
    setText("");
    setSelected([]);
  }

  function pickField(id: string) {
    setFieldId(id);
    const f = fields.find((x) => x.id === id);
    setOp(f ? opsFor(kindOf(f.variant))[0] : "inArray");
    resetValue();
  }

  function add() {
    if (!field) return;
    const values = VALUELESS_OPS.includes(op) ? [] : field.options ? selected : text.split(",").map((v) => v.trim()).filter(Boolean);
    if (!VALUELESS_OPS.includes(op) && values.length === 0) return;
    onAdd({ ...newRule(field.id, values), op });
    setFieldId("");
    resetValue();
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <select
        value={fieldId}
        onChange={(e) => pickField(e.target.value)}
        className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 text-dim outline-none focus:border-accent"
      >
        <option value="">+ Add filter…</option>
        {Object.entries(
          fields.reduce<Record<string, ItemFilterFieldDef[]>>((groups, f) => {
            const group = f.id.startsWith("prop:") || f.id.startsWith("desc:") ? f.label.split(" · ")[0] : f.id.startsWith("custom:") ? "Custom properties" : "Core";
            (groups[group] ??= []).push(f);
            return groups;
          }, {}),
        ).map(([group, groupFields]) => (
          <optgroup key={group} label={group}>
            {groupFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {field && (
        <>
          <select
            value={op}
            onChange={(e) => {
              setOp(e.target.value as FilterOp);
              resetValue();
            }}
            className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 text-dim outline-none focus:border-accent"
          >
            {ops.map((o) => (
              <option key={o} value={o}>
                {OP_LABEL[o]}
              </option>
            ))}
          </select>
          {!VALUELESS_OPS.includes(op) &&
            (field.options ? (
              <MultiSelectPopover options={field.options} selected={selected} onChange={setSelected} />
            ) : (
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={op === "inArray" || op === "notInArray" ? "value, value…" : "value"}
                type={field.variant === "number" ? "number" : "text"}
                className="h-24 px-8 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent w-[120px]"
              />
            ))}
          <Button onClick={add}>Add</Button>
        </>
      )}
    </div>
  );
}

/** "Department: Computer Science and Engineering 624 · …" — one line of the summary,
 *  the largest first, the rest behind "+N more". */
function BreakdownLine({ label, counts }: { label: string; counts: Map<string, number> }) {
  const [all, setAll] = useState(false);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
  const shown = all ? sorted : sorted.slice(0, 6);
  return (
    <div className="text-10.5 text-dim leading-relaxed">
      <span className="text-faint">{label}:</span>{" "}
      {shown.map(([k, n], i) => (
        <span key={k}>
          {i > 0 && " · "}
          {k} <span className="font-mono text-text">{n.toLocaleString()}</span>
        </span>
      ))}
      {sorted.length > 6 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="ml-6 text-accent hover:underline">
          {all ? "show fewer" : `+${sorted.length - 6} more`}
        </button>
      )}
    </div>
  );
}

function tally(rows: ItemRowDto[], key: (r: ItemRowDto) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + (r.countingMode === "BULK" ? r.qty : 1));
  return m;
}

export function FilterBar({
  filters,
  onChange,
  onClear,
  scope,
  matches,
  matchCount,
}: {
  filters: RegisterFilters;
  onChange: (patch: Partial<RegisterFilters>) => void;
  onClear: () => void;
  /** The rows that match the filters (not the context around them), for the written
   *  summary and its breakdowns — null when only a count is known (the paged search
   *  list), omitted when the page shows no summary. */
  matches?: ItemRowDto[] | null;
  /** How many resources match, when `matches` is only one page of them. */
  matchCount?: number;
  /** The university-wide browse (10b of
   *  ~/.claude/plans/three-product-changes-dynamic-thompson.md) — passed straight
   *  through to `/filter-fields` so its owner/custodian option lists match the same
   *  university-wide reach the register rows themselves are fetched under; omitted,
   *  this is the caller's own default scope, unchanged from before this prop existed. */
  scope?: "UNIVERSITY";
}) {
  const [fields, setFields] = useState<ItemFilterFieldDef[]>([]);

  useEffect(() => {
    const qp = new URLSearchParams();
    if (filters.categoryId) qp.set("categoryId", filters.categoryId);
    if (scope) qp.set("scope", scope);
    const qs = qp.toString();
    api
      .get<ItemFilterFieldDef[]>(`/resources/items/filter-fields${qs ? `?${qs}` : ""}`)
      .then(setFields)
      .catch(() => setFields([]));
  }, [filters.categoryId, scope]);

  // A search keystroke updates the URL (via onChange), which re-fetches the register —
  // debounced so a fast typist doesn't fire one request per character. `draft` is the
  // responsive local echo; it re-syncs from `filters.q` whenever that changes from
  // elsewhere (Clear filters, back/forward navigation).
  const [draft, setDraft] = useState(filters.q);
  useEffect(() => setDraft(filters.q), [filters.q]);
  useEffect(() => {
    if (draft === filters.q) return;
    const t = setTimeout(() => onChange({ q: draft }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  const advancedFields = useMemo(() => fields.filter((f) => !CORE_FIELD_IDS.has(f.id)), [fields]);
  const active = Boolean(filters.q || filters.categoryId || filters.status || filters.ownerOrgNodeId || filters.currentOrgNodeId || filters.custodianId || filters.rules.length);

  function addRule(rule: FilterRule) {
    onChange({ rules: [...filters.rules, rule] });
  }
  function removeRule(id: string) {
    onChange({ rules: filters.rules.filter((r) => r.id !== id) });
  }
  function toggleJoin() {
    onChange({ join: filters.join === "and" ? "or" : "and" });
  }

  // One removable chip per active filter — the search, each core dropdown, each rule —
  // so a single one can be dropped without clearing the rest.
  const chips: Array<{ id: string; text: string; remove: () => void }> = [];
  if (filters.q) chips.push({ id: "q", text: `Search: "${filters.q}"`, remove: () => onChange({ q: "" }) });
  for (const { id, key } of CORE_FIELDS) {
    if (!filters[key]) continue;
    const field = fieldsById.get(id);
    const value = field?.options?.find((o) => o.value === filters[key])?.label ?? filters[key];
    // Dropping the category also drops the rules that only exist for it.
    const patch: Partial<RegisterFilters> =
      key === "categoryId" ? { categoryId: "", rules: filters.rules.filter((r) => !r.field.startsWith("prop:") && !r.field.startsWith("desc:")) } : { [key]: "" };
    chips.push({ id, text: `${field?.label ?? id} is ${value}`, remove: () => onChange(patch) });
  }
  for (const r of filters.rules) chips.push({ id: r.id, text: describeRule(fieldsById.get(r.field), r), remove: () => removeRule(r.id) });
  const joinWord = filters.join === "and" ? " and " : " or ";

  const count = matches ? matches.reduce((a, r) => a + (r.countingMode === "BULK" ? r.qty : 1), 0) : matchCount;
  const kinds = matches ? tally(matches, (r) => r.categoryName) : null;

  return (
    <div className="flex flex-col gap-6 px-14 py-9 border-b border-border bg-panel2">
      <div className="flex flex-wrap items-center gap-8">
        <input
          placeholder="Search…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent w-[200px]"
        />
        {CORE_FIELDS.map(({ id, key }) => {
          const field = fieldsById.get(id);
          return (
            <select
              key={id}
              value={filters[key]}
              onChange={(e) => onChange({ [key]: e.target.value } as Partial<RegisterFilters>)}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 text-dim outline-none focus:border-accent"
            >
              <option value="">{field?.label ?? id}: any</option>
              {(field?.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        })}
        <AddRuleForm fields={advancedFields} onAdd={addRule} />
      </div>
      {active && (
        <div className="flex flex-wrap items-center gap-6">
          <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Filtered by</span>
          {chips.length > 1 && (
            <button
              onClick={toggleJoin}
              title="Toggle whether a resource must match all of these filters, or any one of them"
              className="h-20 px-8 rounded-2 border border-accent bg-soft text-accent text-9.5 font-mono font-medium"
            >
              {filters.join === "and" ? "ALL" : "ANY"}
            </button>
          )}
          {chips.map((c) => (
            <Tag key={c.id} tone="accent">
              <span className="inline-flex items-center gap-4">
                {c.text}
                <button onClick={c.remove} aria-label={`Remove filter: ${c.text}`} title="Remove this filter" className="font-sans hover:text-text">
                  ×
                </button>
              </span>
            </Tag>
          ))}
          <button onClick={onClear} className="text-10.5 text-accent ml-auto hover:underline">
            Clear all
          </button>
        </div>
      )}
      {active && count !== undefined && (
        <div className="flex flex-col gap-3 rounded-2 border border-border bg-panel px-10 py-8">
          <div className="text-11.5">
            {/* "40 × Computer match: category is Computer and custodian is Ali Kibret Muhamed." */}
            <span className="font-semibold font-mono">{count.toLocaleString()}</span>{" "}
            {kinds && kinds.size === 1 ? <span className="font-semibold">× {[...kinds.keys()][0]}</span> : count === 1 ? "resource" : "resources"}{" "}
            {count === 1 ? "matches" : "match"}: <span className="text-dim">{chips.map((c) => c.text.charAt(0).toLowerCase() + c.text.slice(1)).join(joinWord)}</span>.
          </div>
          {matches && matches.length > 0 && (
            <>
              {kinds && kinds.size > 1 && <BreakdownLine label="Category" counts={kinds} />}
              <BreakdownLine label="Department" counts={tally(matches, (r) => r.ownerOrgNodeName)} />
              <BreakdownLine label="Custodian" counts={tally(matches, (r) => r.custodianName)} />
              <BreakdownLine label="Status" counts={tally(matches, (r) => STATUS_LABEL[r.effectiveStatus] ?? r.effectiveStatus)} />
              <BreakdownLine label="Lab / place" counts={tally(matches, (r) => r.path[0] ?? r.name)} />
            </>
          )}
          {!matches && (
            <div className="text-10.5 text-faint">Switch to Hierarchy or Grouped to see them broken down by department, custodian, status and lab.</div>
          )}
        </div>
      )}
    </div>
  );
}

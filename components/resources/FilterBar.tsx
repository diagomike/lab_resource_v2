"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemFilterFieldDef, FilterVariant } from "@/lib/shared";
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
            const group = f.id.startsWith("prop:") || f.id.startsWith("desc:") ? f.label.split(" · ")[0] : "Core";
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

export function FilterBar({
  filters,
  onChange,
  onClear,
}: {
  filters: RegisterFilters;
  onChange: (patch: Partial<RegisterFilters>) => void;
  onClear: () => void;
}) {
  const [fields, setFields] = useState<ItemFilterFieldDef[]>([]);

  useEffect(() => {
    const qs = filters.categoryId ? `?categoryId=${encodeURIComponent(filters.categoryId)}` : "";
    api
      .get<ItemFilterFieldDef[]>(`/resources/items/filter-fields${qs}`)
      .then(setFields)
      .catch(() => setFields([]));
  }, [filters.categoryId]);

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
        {active && (
          <button onClick={onClear} className="text-10.5 text-accent ml-auto">
            Clear filters
          </button>
        )}
      </div>
      {filters.rules.length > 0 && (
        <div className="flex flex-wrap items-center gap-6">
          {filters.rules.length > 1 && (
            <button
              onClick={toggleJoin}
              title="Toggle how the filters below combine"
              className="h-20 px-8 rounded-2 border border-accent bg-soft text-accent text-9.5 font-mono font-medium"
            >
              {filters.join === "and" ? "AND" : "OR"}
            </button>
          )}
          {filters.rules.map((r) => (
            <Tag key={r.id} tone="accent">
              <span className="inline-flex items-center gap-4">
                {describeRule(fieldsById.get(r.field), r)}
                <button onClick={() => removeRule(r.id)} aria-label="Remove filter" className="font-sans">
                  ×
                </button>
              </span>
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}

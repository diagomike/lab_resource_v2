"use client";

import { useEffect, useState } from "react";
import type { ItemFilterFieldDef } from "@/lib/shared";
import { api } from "@/lib/api";
import type { RegisterFilters } from "@/lib/register/useRegisterState";

/**
 * Core fields only — see useRegisterState.ts's own note on why the full generalised
 * filter-rule engine (prop:/desc: synthetic fields, the wider operator set) is
 * deferred. Options come from `/api/resources/items/filter-fields` with no active
 * categories named, which is exactly the core set (status/category/owner/
 * currentOrg/custodian/location/contains) items.ts's `buildFilterFields` always
 * includes regardless.
 */
const CORE_FIELDS: Array<{ id: string; key: keyof RegisterFilters }> = [
  { id: "category", key: "categoryId" },
  { id: "status", key: "status" },
  { id: "owner", key: "ownerOrgNodeId" },
  { id: "currentOrg", key: "currentOrgNodeId" },
  { id: "custodian", key: "custodianId" },
];

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
    api
      .get<ItemFilterFieldDef[]>("/resources/items/filter-fields")
      .then(setFields)
      .catch(() => setFields([]));
  }, []);

  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const active = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-8 px-14 py-9 border-b border-border bg-panel2">
      <input
        placeholder="Search…"
        value={filters.q}
        onChange={(e) => onChange({ q: e.target.value })}
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
      {active && (
        <button onClick={onClear} className="text-10.5 text-accent ml-auto">
          Clear filters
        </button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { ItemFilterFieldDef, OrgNodeDto } from "@/lib/shared";
import { api } from "@/lib/api";
import type { TreeOption } from "@/components/TreePicker";

export interface EditOption {
  value: string;
  label: string;
}

export interface EditOptions {
  owner: EditOption[];
  currentOrg: EditOption[];
  custodian: EditOption[];
  /** Unit options → an indented org tree (College → Department …) for TreePicker. */
  unitTree: (units: EditOption[]) => TreeOption[];
}

const KIND_ICON: Record<string, string> = { UNIVERSITY: "Landmark", COLLEGE: "Building2", DEPARTMENT: "Building", OFFICE: "Briefcase" };

export function makeUnitTree(nodes: OrgNodeDto[]): (units: EditOption[]) => TreeOption[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // The org chart is a DAG (a department can sit under two colleges) — a picker needs
  // one line of ancestry, so it follows each node's first parent.
  const chain = (id: string) => {
    const out: Array<{ id: string; label: string; iconKey?: string }> = [];
    const seen = new Set<string>([id]);
    let cur = byId.get(id)?.parentIds[0];
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = byId.get(cur);
      if (!n) break;
      out.unshift({ id: n.id, label: n.name, iconKey: KIND_ICON[n.kind] });
      cur = n.parentIds[0];
    }
    return out;
  };
  return (units) =>
    units.map((u) => {
      const n = byId.get(u.value);
      return { id: u.value, label: u.label, iconKey: n ? KIND_ICON[n.kind] : undefined, hint: n?.kind.toLowerCase(), ancestors: chain(u.value) };
    });
}

const EMPTY: EditOptions = { owner: [], currentOrg: [], custodian: [], unitTree: makeUnitTree([]) };

/** Owning-unit / current-unit / custodian picker options for the edit surfaces
 *  (Inspector, the bulk toolbar) — the same core field list FilterBar already fetches
 *  from `/resources/items/filter-fields` with no active category, just read for the
 *  three fields that double as edit targets rather than filters. A second network
 *  call, not a shared fetch with FilterBar, matching this app's existing per-component
 *  fetch style rather than threading options through several prop layers for it. The
 *  org chart (`/org/nodes`) is fetched alongside so unit choices can nest. */
export function useEditOptions(): EditOptions {
  const [options, setOptions] = useState<EditOptions>(EMPTY);

  useEffect(() => {
    Promise.all([api.get<ItemFilterFieldDef[]>("/resources/items/filter-fields"), api.get<OrgNodeDto[]>("/org/nodes").catch(() => [] as OrgNodeDto[])])
      .then(([fields, nodes]) => {
        const byId = new Map(fields.map((f) => [f.id, f]));
        setOptions({
          owner: byId.get("owner")?.options ?? [],
          currentOrg: byId.get("currentOrg")?.options ?? [],
          custodian: byId.get("custodian")?.options ?? [],
          unitTree: makeUnitTree(nodes),
        });
      })
      .catch(() => setOptions(EMPTY));
  }, []);

  return options;
}

"use client";

import { useEffect, useState } from "react";
import type { ItemFilterFieldDef } from "@/lib/shared";
import { api } from "@/lib/api";

export interface EditOption {
  value: string;
  label: string;
}

export interface EditOptions {
  owner: EditOption[];
  currentOrg: EditOption[];
  custodian: EditOption[];
}

const EMPTY: EditOptions = { owner: [], currentOrg: [], custodian: [] };

/** Owning-unit / current-unit / custodian picker options for the edit surfaces
 *  (Inspector, the bulk toolbar) — the same core field list FilterBar already fetches
 *  from `/resources/items/filter-fields` with no active category, just read for the
 *  three fields that double as edit targets rather than filters. A second network
 *  call, not a shared fetch with FilterBar, matching this app's existing per-component
 *  fetch style rather than threading options through several prop layers for it. */
export function useEditOptions(): EditOptions {
  const [options, setOptions] = useState<EditOptions>(EMPTY);

  useEffect(() => {
    api
      .get<ItemFilterFieldDef[]>("/resources/items/filter-fields")
      .then((fields) => {
        const byId = new Map(fields.map((f) => [f.id, f]));
        setOptions({
          owner: byId.get("owner")?.options ?? [],
          currentOrg: byId.get("currentOrg")?.options ?? [],
          custodian: byId.get("custodian")?.options ?? [],
        });
      })
      .catch(() => setOptions(EMPTY));
  }, []);

  return options;
}

"use client";

import { useEffect, useState } from "react";
import type { ResourceCategoryDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote, Tag } from "@/components/ui";
import { PanelLoading, EmptyState } from "@/components/states";

/**
 * A read-only list — full CRUD already exists server-side
 * (lib/server/resources/categories.ts) but the three-tab admin editor is Phase 8 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md. This proves the read path and gives
 * every signed-in person the same shared vocabulary view categories are meant to be.
 */
export default function CategoriesPage() {
  const [categories, setCategories] = useState<ResourceCategoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then(setCategories)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load categories"));
  }, []);

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel title="Categories">
        {!categories ? (
          <PanelLoading rows={5} />
        ) : categories.length === 0 ? (
          <EmptyState
            title="No categories yet"
            body="Categories define the typed schema every resource is filed under — the admin editor for creating and editing them lands in a later phase."
          />
        ) : (
          <div>
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-10 px-14 py-9 border-b border-border last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-11.5 font-medium truncate">{c.name}</div>
                  <div className="text-9.5 text-faint font-mono">{c.key}</div>
                </div>
                <Tag>{c.groupName}</Tag>
                <Tag>{c.countingMode === "SERIALIZED" ? "Individual units" : `Bulk${c.unit ? ` · ${c.unit}` : ""}`}</Tag>
                {c.fields.length > 0 && <span className="text-10 text-dim">{c.fields.length} field{c.fields.length === 1 ? "" : "s"}</span>}
                {!c.active && <Tag>Disabled</Tag>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </Screen>
  );
}

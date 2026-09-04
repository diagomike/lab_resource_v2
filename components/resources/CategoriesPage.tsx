"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryGroupDto, ResourceCategoryDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Panel, Screen, ErrorNote, Button, Tag } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { CategoryIcon } from "./IconPicker";
import { CategoryEditor } from "./CategoryEditor";
import { CategoryGroupManager } from "./CategoryGroupManager";

/**
 * The database-backed Category Studio — replaces the Phase-6 read-only list. Ported
 * behaviorally from temp_works/src/app/categories/page.tsx: categories grouped by the
 * managed group vocabulary in a sidebar, a selected category's full editor in the main
 * panel, "Manage groups" as its own modal. See CategoryEditor.tsx for the
 * create/edit/impact-preview/delete behavior this page hosts.
 *
 * Everyone signed in reads this page; only SYS_ADMIN/PROPERTY_ADMIN see the controls
 * that write anything (`canManage`, threaded down) — the server's own role gate on
 * every category/category-group Route Handler is what actually enforces that, this is
 * only about not offering a control that would just be refused.
 */
export default function CategoriesPage() {
  const { user } = useAuth();
  const canManage = user?.roles.some((r) => r === "SYS_ADMIN" || r === "PROPERTY_ADMIN") ?? false;

  const [categories, setCategories] = useState<ResourceCategoryDto[] | null>(null);
  const [groups, setGroups] = useState<CategoryGroupDto[] | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null | "__new__">(null);
  const [groupsOpen, setGroupsOpen] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api.get<ResourceCategoryDto[]>("/resources/categories"),
      api.get<CategoryGroupDto[]>("/resources/category-groups"),
      api.get<Record<string, number>>("/resources/categories/usage"),
    ])
      .then(([cats, grps, use]) => {
        setCategories(cats);
        setGroups(grps);
        setUsage(use);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load categories"));
  }, []);

  useEffect(load, [load]);

  const grouped = useMemo(() => {
    if (!categories || !groups) return [];
    const byGroup = new Map<string, ResourceCategoryDto[]>();
    for (const c of categories) {
      const arr = byGroup.get(c.groupId);
      if (arr) arr.push(c);
      else byGroup.set(c.groupId, [c]);
    }
    for (const arr of byGroup.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return groups.map((g) => [g, byGroup.get(g.id) ?? []] as const).filter(([, cats]) => cats.length > 0 || canManage);
  }, [categories, groups, canManage]);

  const groupUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of categories ?? []) m.set(c.groupId, (m.get(c.groupId) ?? 0) + 1);
    return m;
  }, [categories]);

  const selected = selectedId && selectedId !== "__new__" ? (categories?.find((c) => c.id === selectedId) ?? null) : null;
  const editing = selectedId === "__new__" ? null : selected;
  const showEditor = selectedId !== null;

  function onSaved() {
    setSelectedId(null);
    load();
  }
  function onDeleted() {
    setSelectedId(null);
    load();
  }

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel
        title="Categories"
        actions={
          canManage ? (
            <div className="flex items-center gap-8">
              <Button onClick={() => setGroupsOpen(true)}>Manage groups</Button>
              <Button variant="primary" onClick={() => setSelectedId("__new__")}>
                + New category
              </Button>
            </div>
          ) : undefined
        }
      >
        {!categories || !groups ? (
          <PanelLoading rows={5} />
        ) : (
          <div className="grid lg:grid-cols-[280px_1fr]">
            <aside className="border-r border-border p-8 flex flex-col gap-10 lg:max-h-[70vh] lg:overflow-y-auto">
              {grouped.map(([g, cats]) => (
                <div key={g.id}>
                  <div className="px-4 py-4 text-9.5 uppercase tracking-label text-faint font-semibold">{g.name}</div>
                  {cats.length === 0 ? (
                    <div className="px-8 py-6 text-10 text-faint">No categories yet</div>
                  ) : (
                    cats.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className={`flex items-center gap-8 w-full px-8 py-6 rounded-2 text-left text-11 ${
                          selectedId === c.id ? "bg-accent text-white" : "hover:bg-panel2"
                        }`}
                      >
                        <CategoryIcon iconKey={c.iconKey} className="size-14 flex-none" />
                        <span className="flex-1 truncate">{c.name}</span>
                        {!c.active && <Tag>Disabled</Tag>}
                        <span className={`text-9.5 font-mono ${selectedId === c.id ? "opacity-70" : "text-faint"}`}>{usage[c.id] ?? 0}</span>
                      </button>
                    ))
                  )}
                </div>
              ))}
              {categories.length === 0 && <div className="px-8 py-6 text-10.5 text-faint">No categories yet.</div>}
            </aside>

            <div className="p-14">
              {showEditor ? (
                <CategoryEditor
                  category={editing}
                  groups={groups}
                  categories={categories}
                  usageCount={editing ? (usage[editing.id] ?? 0) : 0}
                  canManage={canManage}
                  onSaved={onSaved}
                  onDeleted={onDeleted}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-11 text-faint py-40">
                  Pick a category to inspect it{canManage ? ", or create a new one" : ""}.
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      {groupsOpen && groups && (
        <CategoryGroupManager
          groups={groups}
          usage={groupUsage}
          onClose={() => setGroupsOpen(false)}
          onChanged={load}
        />
      )}
    </Screen>
  );
}

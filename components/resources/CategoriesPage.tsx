"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CategoryChangeDto, CategoryChangesDto, CategoryGroupDto, ResourceCategoryDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Panel, Screen, Button, Tag, ConfirmDialog } from "@/components/ui";
import { InlineError, PanelLoading } from "@/components/states";
import { CategoryIcon } from "./IconPicker";
import { CategoryEditor } from "./CategoryEditor";
import { CategoryGroupManager } from "./CategoryGroupManager";
import { CategoryChangeCard } from "./CategoryChangeCard";

/**
 * Categories: the kinds of things the university records, and the details each one
 * keeps. Everyone reads them; custodians and department heads add and change them for
 * their department (the admin and Property Administration for the whole university).
 * Changes that touch data wait for approval — the ones waiting for the viewer show at
 * the top. `?id=` opens a category, `?change=` one of its waiting changes, `?new=1` a
 * blank one; leaving unsaved edits asks first.
 */
function CategoriesInner() {
  const { me } = useAuth();
  const caps = me?.caps;
  const isTop = Boolean(caps?.isAdmin || caps?.isPropertyAdmin);
  const canEdit = Boolean(caps && (isTop || caps.isCustodian || caps.headOf.length || caps.deanOf.length || caps.isAdaa));

  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("new") ? "__new__" : params.get("id");
  const focusChangeId = params.get("change");

  const [categories, setCategories] = useState<ResourceCategoryDto[] | null>(null);
  const [groups, setGroups] = useState<CategoryGroupDto[] | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [waiting, setWaiting] = useState<CategoryChangeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      api.get<ResourceCategoryDto[]>("/resources/categories"),
      api.get<CategoryGroupDto[]>("/resources/category-groups"),
      api.get<Record<string, number>>("/resources/categories/usage"),
      api.get<CategoryChangesDto>("/resources/category-changes").catch(() => ({ waiting: [], mine: [] })),
    ])
      .then(([cats, grps, use, changes]) => {
        setCategories(cats);
        setGroups(grps);
        setUsage(use);
        setWaiting(changes.waiting);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the categories"));
  }, []);
  useEffect(load, [load]);

  // Leaving the page with unsaved edits asks the browser's own question.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const href = useCallback(
    (target: string | null) => {
      if (target === "__new__") return `${pathname}?new=1`;
      return target ? `${pathname}?id=${target}` : pathname;
    },
    [pathname],
  );
  /** Open another category — asking first when the open one has unsaved edits. */
  function open(target: string | null) {
    if (dirtyRef.current) setPendingNav(href(target));
    else router.push(href(target), { scroll: false });
  }
  const onDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  const needle = search.trim().toLowerCase();
  const grouped = useMemo(() => {
    if (!categories || !groups) return [];
    const byGroup = new Map<string, ResourceCategoryDto[]>();
    for (const c of categories) {
      if (needle && !`${c.name} ${c.description ?? ""} ${c.groupName} ${c.fields.map((f) => f.label).join(" ")}`.toLowerCase().includes(needle)) continue;
      byGroup.set(c.groupId, [...(byGroup.get(c.groupId) ?? []), c]);
    }
    for (const arr of byGroup.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return groups.map((g) => [g, byGroup.get(g.id) ?? []] as const).filter(([, cats]) => cats.length > 0);
  }, [categories, groups, needle]);

  const groupUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of categories ?? []) m.set(c.groupId, (m.get(c.groupId) ?? 0) + 1);
    return m;
  }, [categories]);

  const selected = selectedId && selectedId !== "__new__" ? (categories?.find((c) => c.id === selectedId) ?? null) : null;
  const showEditor = selectedId === "__new__" || Boolean(selected);

  return (
    <Screen>
      {waiting.length > 0 && (
        <Panel title={`Waiting for your approval (${waiting.length})`}>
          <div className="p-12 flex flex-col gap-8">
            {waiting.map((c) => (
              <CategoryChangeCard
                key={c.id}
                change={c}
                highlight={c.id === focusChangeId}
                onChanged={(next) => {
                  setWaiting((list) => list.filter((x) => x.id !== next.id || next.canDecide));
                  load();
                }}
              />
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Categories"
        actions={
          <div className="flex items-center gap-8">
            {isTop && <Button onClick={() => setGroupsOpen(true)}>Manage groups</Button>}
            {canEdit && (
              <Button variant="primary" onClick={() => open("__new__")}>
                + Add a category
              </Button>
            )}
          </div>
        }
      >
        {error ? (
          <div className="p-12">
            <InlineError message={error} onRetry={load} />
          </div>
        ) : !categories || !groups ? (
          <PanelLoading rows={5} />
        ) : (
          <div className="grid lg:grid-cols-[300px_1fr]">
            <aside className="border-b lg:border-b-0 lg:border-r border-border p-8 flex flex-col gap-8 lg:max-h-[75vh] lg:overflow-y-auto">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Find among ${categories.length} categories…`}
                aria-label="Find a category"
                className="h-28 w-full px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
              />
              {grouped.map(([g, cats]) => (
                <div key={g.id}>
                  <div className="px-4 py-4 text-11 uppercase tracking-label text-dim font-semibold">{g.name}</div>
                  {cats.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => open(c.id)}
                      aria-current={selectedId === c.id ? "true" : undefined}
                      className={`flex items-center gap-8 w-full px-8 py-6 rounded-2 text-left text-11.5 ${selectedId === c.id ? "bg-accent text-white" : "hover:bg-panel2"}`}
                    >
                      <CategoryIcon iconKey={c.iconKey} className="size-14 flex-none" />
                      <span className="flex-1 truncate">{c.name}</span>
                      {c.pendingChanges > 0 && <Tag tone="warn">waiting</Tag>}
                      {!c.active && <Tag>not in use</Tag>}
                      <span className={`text-11 font-mono ${selectedId === c.id ? "opacity-80" : "text-dim"}`}>{usage[c.id] ?? 0}</span>
                    </button>
                  ))}
                </div>
              ))}
              {grouped.length === 0 && <div className="px-8 py-6 text-11 text-dim">{needle ? `Nothing matches “${search.trim()}”.` : "No categories yet."}</div>}
            </aside>

            <div className="p-14 min-w-0">
              {showEditor ? (
                <>
                  {/* An existing category's name heads its own view (the read-only header,
                      or the editor's Name field), so it is never printed twice. */}
                  {!selected && <h2 className="text-14 font-semibold mb-12">A new category</h2>}
                  <CategoryEditor
                    category={selected}
                    groups={groups}
                    categories={categories}
                    usageCount={selected ? (usage[selected.id] ?? 0) : 0}
                    canEdit={canEdit}
                    isTop={isTop}
                    focusChangeId={focusChangeId}
                    onSaved={() => load()}
                    onDeleted={() => {
                      router.push(pathname, { scroll: false });
                      load();
                    }}
                    onDirty={onDirty}
                    onOpen={(id) => router.push(href(id), { scroll: false })}
                  />
                </>
              ) : selectedId && !selected ? (
                <div className="py-44 text-center text-11.5 text-dim">That category no longer exists.</div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-6 text-11.5 text-dim py-44 text-center">
                  <span>Pick a category to see the details it records{canEdit ? ", or add a new one" : ""}.</span>
                  {canEdit && <span className="text-11">Changes that only add apply at once; changes to what items already hold go to your head first.</span>}
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      {groupsOpen && groups && <CategoryGroupManager groups={groups} usage={groupUsage} onClose={() => setGroupsOpen(false)} onChanged={load} />}

      {pendingNav && (
        <ConfirmDialog
          title="Leave without saving?"
          message="Your edits to this category haven't been saved. Leave them?"
          confirmLabel="Leave them"
          tone="warn"
          onConfirm={() => {
            dirtyRef.current = false;
            router.push(pendingNav, { scroll: false });
            setPendingNav(null);
          }}
          onCancel={() => setPendingNav(null)}
        />
      )}
    </Screen>
  );
}

/** useSearchParams needs a Suspense boundary. */
export default function CategoriesPage() {
  return (
    <Suspense>
      <CategoriesInner />
    </Suspense>
  );
}

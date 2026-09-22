"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import type { CategoryFieldDto, ContainerOptionDto, ResourceCategoryDto } from "@/lib/shared";
import { useRegisterState, MODE_LABEL, MODE_HELP, type RegisterMode } from "@/lib/register/useRegisterState";
import { usePendingChange } from "@/lib/register/usePendingChange";
import { useEditOptions } from "@/lib/register/useEditOptions";
import { useActiveViewId } from "@/lib/register/active-view";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Panel, Screen, ErrorNote, Button, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { ResourceTable } from "./ResourceTable";
import { FilterBar } from "./FilterBar";
import { Inspector } from "./Inspector";
import { AddModal } from "./AddModal";
import { BulkPropModal } from "./BulkPropModal";
import { TransferModal } from "./TransferModal";

const MODES: RegisterMode[] = ["tree", "rollup", "flat"];

function RegisterPageInner() {
  const state = useRegisterState();
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [propField, setPropField] = useState<CategoryFieldDto | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const allExpanded = state.expanded === true;
  const options = useEditOptions();

  // "Look but do not touch" — the currently active access view's own canEdit flag
  // (Track 1 of ~/.claude/plans/lets-merge-the-work-memoized-journal.md), mirrored
  // client-side from the exact same fallback the server's `resolveEffectiveView`
  // uses (chosen view if it's one of theirs, else their most specific default). The
  // server enforces this independently in mutate.ts's `assertViewAllowsEdit` — this
  // is only about not offering what a write would then refuse, same as everywhere
  // else in this app.
  const { me } = useAuth();
  const activeViewId = useActiveViewId();
  const views = me?.views ?? [];
  const viewAllowsEdit = views.length === 0 || (views.find((v) => v.id === activeViewId) ?? views[0])?.canEdit !== false;
  // Only custodians (and store keepers, and the admin) change resources — a head reads
  // the register and approves through Lab states / Approvals (scope.ts's own note).
  const holdsWriteRole = Boolean(me?.user.roles.some((r) => r === "CUSTODIAN" || r === "STORE_KEEPER" || r === "SYS_ADMIN"));
  const canEdit = viewAllowsEdit && holdsWriteRole;
  // Transfers are pulled from University resources (Track 5); pushing stock out is the
  // store keeper's handover only.
  const canHandOver = Boolean(me?.user.roles.some((r) => r === "STORE_KEEPER" || r === "SYS_ADMIN"));

  useEffect(() => {
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const { pending, busy, error: pendingError, request, confirm, cancel } = usePendingChange(() => {
    state.setSelection({});
    state.refetch();
  });

  const selectedIds = state.selectedItemIds;
  /** Ticking a row ticks everything inside it too; a move or transfer is about the
   *  top-most of those only — their contents travel with them (the server collapses
   *  the selection the same way). */
  const selectedRootIds = useMemo(() => {
    const chosen = new Set(selectedIds);
    return selectedIds.filter((id) => {
      let parentId = state.byId.get(id)?.parentId ?? null;
      while (parentId) {
        if (chosen.has(parentId)) return false;
        parentId = state.byId.get(parentId)?.parentId ?? null;
      }
      return true;
    });
  }, [selectedIds, state.byId]);
  const selectedRows = useMemo(() => selectedIds.map((id) => state.byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)), [selectedIds, state.byId]);

  /** "Move to…"'s own options — the same container-picker endpoint AddModal's "Into"
   *  uses, so a bulk move never offers a destination the write path would then refuse.
   *  A selection can span several categories at once; mutate.ts's own placement check
   *  is whole-refusal (every selected root must satisfy it for the move to apply at
   *  all), so a destination is only offered here when it is legal for EVERY selected
   *  item's category — one fetch per distinct category, intersected. */
  const [moveTargets, setMoveTargets] = useState<ContainerOptionDto[]>([]);
  useEffect(() => {
    const categoryIds = [...new Set(selectedRows.map((r) => r.categoryId))];
    if (!categoryIds.length) {
      setMoveTargets([]);
      return;
    }
    let cancelled = false;
    const exclude = selectedIds.join(",");
    Promise.all(categoryIds.map((id) => api.get<ContainerOptionDto[]>(`/resources/items/containers?categoryId=${encodeURIComponent(id)}&exclude=${encodeURIComponent(exclude)}`)))
      .then((sets) => {
        if (cancelled) return;
        const [first, ...rest] = sets;
        const common = first.filter((o) => rest.every((set) => set.some((r) => r.id === o.id)));
        setMoveTargets(common);
      })
      .catch(() => !cancelled && setMoveTargets([]));
    return () => {
      cancelled = true;
    };
  }, [selectedRows, selectedIds]);

  /** Property fields every selected item's own category defines in common — offering
   *  anything narrower would let the bulk write reach a category that cannot hold it,
   *  which the server refuses outright (see BulkPropModal's own note). */
  const commonPropFields = useMemo(() => {
    if (!selectedRows.length) return [];
    const categoryIds = new Set(selectedRows.map((r) => r.categoryId));
    const fieldSets = [...categoryIds].map((id) => categories.find((c) => c.id === id)?.fields ?? []);
    if (fieldSets.some((f) => f.length === 0)) return [];
    const [first, ...rest] = fieldSets;
    return first.filter((f) => rest.every((fs) => fs.some((x) => x.key === f.key)));
  }, [selectedRows, categories]);

  function bulkRequestSelect(kind: "setStatus" | "setCustodian" | "setOwnerOrg" | "setCurrentOrg", value: string, label: string) {
    if (!value) return;
    request({
      input: { kind, itemIds: selectedIds, value } as never,
      title: label,
      message: `Apply "${label}" to ${selectedIds.length} selected resources?`,
      tone: "warn",
    });
  }

  const MOVE_TOP_LEVEL = "__top_level__";
  function bulkMove(rawValue: string) {
    if (!rawValue) return; // the picker's own placeholder, not a real choice
    const value = rawValue === MOVE_TOP_LEVEL ? null : rawValue;
    request({
      input: { kind: "moveInTree", itemIds: selectedRootIds, value },
      title: "Relocation",
      message: `Move ${selectedRootIds.length} selected resource${selectedRootIds.length === 1 ? "" : "s"} (with everything inside them) to ${value ? "the chosen destination" : "the top level"}?`,
      tone: "warn",
    });
  }

  function bulkRename(value: string) {
    if (!value.trim()) return;
    request({
      input: { kind: "setName", itemIds: selectedIds, value: value.trim() },
      title: "Rename",
      message: `Rename ${selectedIds.length} selected resources to "${value.trim()}"?`,
      tone: "warn",
    });
  }

  function bulkDelete() {
    request({
      input: { kind: "deleteItem", itemIds: selectedIds },
      title: "Delete resources",
      message: `Delete ${selectedIds.length} selected resources and everything physically nested inside them? This cannot be undone.`,
      tone: "danger",
      confirmLabel: "Delete",
    });
  }

  return (
    <Screen>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      <Panel
        title="Register"
        actions={
          <div className="flex items-center gap-10">
            {canEdit && (
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                + Add resources
              </Button>
            )}
            {state.mode !== "flat" && (
              <button
                onClick={() => state.setExpanded(allExpanded ? {} : true)}
                title={allExpanded ? "Collapse all" : "Expand all"}
                className="border border-border2 bg-panel2 text-dim h-24 px-9 rounded-2 text-10.5 flex items-center gap-5 flex-none"
              >
                <span>{allExpanded ? "▾" : "▸"}</span>
                <span>{allExpanded ? "Collapse all" : "Expand all"}</span>
              </button>
            )}
            <div className="flex items-center gap-4">
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => state.setMode(m)}
                  title={MODE_HELP[m]}
                  style={{
                    background: state.mode === m ? "var(--accent)" : "var(--panel2)",
                    color: state.mode === m ? "#fff" : "var(--dim)",
                  }}
                  className="border-0 text-10.5 font-medium px-9 py-4 rounded-2"
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <FilterBar filters={state.filters} onChange={state.setFilters} onClear={state.clearFilters} />

        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-8 px-14 py-9 border-b border-border bg-soft">
            <span className="text-10.5 text-accent font-medium">{selectedIds.length} selected</span>
            <select
              defaultValue=""
              onChange={(e) => {
                bulkRequestSelect("setStatus", e.target.value, "Status change");
                e.target.value = "";
              }}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
            >
              <option value="">Set status…</option>
              {["WORKING", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              onChange={(e) => {
                bulkRequestSelect("setCustodian", e.target.value, "Custody transfer");
                e.target.value = "";
              }}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
            >
              <option value="">Set custodian…</option>
              {options.custodian.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              onChange={(e) => {
                bulkRequestSelect("setOwnerOrg", e.target.value, "Ownership transfer");
                e.target.value = "";
              }}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
            >
              <option value="">Set owning unit…</option>
              {options.owner.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              onChange={(e) => {
                bulkRequestSelect("setCurrentOrg", e.target.value, "Current unit change");
                e.target.value = "";
              }}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
            >
              <option value="">Set current unit…</option>
              {options.currentOrg.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              onChange={(e) => {
                bulkMove(e.target.value);
                e.target.value = "";
              }}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
            >
              <option value="">Move to…</option>
              {selectedRows.every((r) => categories.find((c) => c.id === r.categoryId)?.canBeRoot) && (
                <option value={MOVE_TOP_LEVEL}>Top level</option>
              )}
              {moveTargets.map((c) => (
                <option key={c.id} value={c.id}>
                  {[...c.path, c.name].join(" / ")}
                </option>
              ))}
            </select>
            <input
              placeholder="Rename to…"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                bulkRename((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = "";
              }}
              className="h-24 px-8 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent w-[140px]"
            />
            {commonPropFields.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  setPropField(commonPropFields.find((f) => f.key === e.target.value) ?? null);
                  e.target.value = "";
                }}
                className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
              >
                <option value="">Set property…</option>
                {commonPropFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
            {canHandOver && <Button onClick={() => setTransferOpen(true)}>Hand over…</Button>}
            <button onClick={bulkDelete} className="text-10.5 text-bad ml-auto">
              Delete selected
            </button>
          </div>
        )}

        {state.loading ? (
          <PanelLoading rows={6} />
        ) : (
          <>
            <ResourceTable
              rows={state.rowNodes}
              byId={state.byId}
              expanded={state.expanded}
              onExpandedChange={state.setExpanded}
              selection={state.selection}
              onSelectionChange={state.setSelection}
              onInspect={setInspectId}
              showPath={state.mode === "flat"}
              selectable={canEdit}
            />

            {state.mode === "flat" && state.total > state.pageSize && (
              <div className="flex items-center justify-between px-14 py-9 border-t border-border">
                <span className="text-10.5 text-dim">
                  {(state.page - 1) * state.pageSize + 1}–{Math.min(state.page * state.pageSize, state.total)} of {state.total}
                </span>
                <div className="flex items-center gap-6">
                  <Button disabled={state.page <= 1} onClick={() => state.setPage(state.page - 1)}>
                    Previous
                  </Button>
                  <Button disabled={state.page * state.pageSize >= state.total} onClick={() => state.setPage(state.page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      <Inspector itemId={inspectId} onClose={() => setInspectId(null)} onChanged={state.refetch} onNavigate={setInspectId} readOnly={!canEdit} />

      {canEdit && <AddModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={state.refetch} />}

      {propField && (
        <BulkPropModal
          itemIds={selectedIds}
          field={propField}
          onClose={() => setPropField(null)}
          onApplied={() => {
            setPropField(null);
            state.setSelection({});
            state.refetch();
          }}
        />
      )}

      {transferOpen && selectedRootIds.length > 0 && (
        <TransferModal
          itemIds={selectedRootIds}
          label={selectedRootIds.length === 1 ? `"${state.byId.get(selectedRootIds[0])?.name ?? "1 resource"}"` : `${selectedRootIds.length} resources`}
          onClose={() => setTransferOpen(false)}
          onDone={() => {
            setTransferOpen(false);
            state.setSelection({});
            state.refetch();
          }}
        />
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          message={pending.message}
          tone={pending.tone}
          confirmLabel={pending.confirmLabel}
          busy={busy}
          error={pendingError}
          onConfirm={confirm}
          onCancel={cancel}
        />
      )}
    </Screen>
  );
}

/** useSearchParams needs a Suspense boundary in the Next.js App Router. */
export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterPageInner />
    </Suspense>
  );
}

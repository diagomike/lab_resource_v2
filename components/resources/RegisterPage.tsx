"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CategoryFieldDto, ContainerOptionDto, ResourceCategoryDto } from "@/lib/shared";
import { TreePicker, containerTreeOptions } from "@/components/TreePicker";
import { useRegisterState, EMPTY_FILTERS, MODE_LABEL, MODE_HELP, type RegisterMode } from "@/lib/register/useRegisterState";
import { usePendingChange } from "@/lib/register/usePendingChange";
import { useEditOptions } from "@/lib/register/useEditOptions";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { STATUS_LABEL } from "@/lib/domain/status";
import { Panel, Screen, ErrorNote, Button, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { ResourceTable } from "./ResourceTable";
import { FilterBar } from "./FilterBar";
import { Inspector } from "./Inspector";
import { AddModal } from "./AddModal";
import { BulkPropModal } from "./BulkPropModal";
import { TransferModal } from "./TransferModal";
import { ReturnToStoreModal } from "./ReturnToStoreModal";
import { GroupByBar } from "./GroupByBar";
import { usePendingMarkers } from "@/lib/register/usePendingMarkers";
import { RegisterScopeSwitch, mayBrowseUniversity } from "./RegisterScopeSwitch";
import { WholeUniversityRegister } from "./WholeUniversityRegister";
import { couldNotLoad } from "@/components/toast";
import { ExportViewButton } from "./ExportViewButton";

const MODES: RegisterMode[] = ["grouped", "tree", "rollup", "flat"];

function MyRegister({ canSwitch }: { canSwitch: boolean }) {
  const state = useRegisterState();
  // `?item=<id>` (a link from Home, a notice, another screen) opens that item's details.
  const searchParams = useSearchParams();
  const [inspectId, setInspectId] = useState<string | null>(() => searchParams.get("item"));
  const [addOpen, setAddOpen] = useState(false);
  const [propField, setPropField] = useState<CategoryFieldDto | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [bulkMore, setBulkMore] = useState(false);
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const options = useEditOptions();
  const { markers, transfers: transferMarkers, refresh: refreshMarkers } = usePendingMarkers();
  /** After any edit: the table, and the draft markers (the edit may have been staged). */
  const afterChange = () => {
    state.refetch();
    refreshMarkers();
  };

  const { me } = useAuth();
  // Only custodians (and store keepers, and the admin) change resources — a head reads
  // the register and approves through Lab states / Approvals (scope.ts's own note).
  const holdsWriteRole = Boolean(me?.user.roles.some((r) => r === "CUSTODIAN" || r === "STORE_KEEPER" || r === "SYS_ADMIN"));
  const canEdit = holdsWriteRole;
  // Transfers are pulled from University resources (Track 5); pushing stock out is the
  // store keeper's handover only.
  const canHandOver = Boolean(me?.user.roles.some((r) => r === "STORE_KEEPER" || r === "SYS_ADMIN"));

  useEffect(() => {
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then(setCategories)
      .catch(couldNotLoad("the categories", () => setCategories([])));
  }, []);

  const { pending, busy, error: pendingError, request, confirm, cancel } = usePendingChange(() => {
    state.setSelection({});
    afterChange();
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

  function bulkRequestSelect(kind: "setStatus" | "setCustodian" | "setOwnerOrg" | "setCurrentOrg", value: string, label: string, valueLabel: string) {
    if (!value) return;
    request({
      input: { kind, itemIds: selectedIds, value } as never,
      title: label,
      // Name the value, so the confirmation says what is about to happen, not just what kind of change.
      message: `${label} to "${valueLabel}" for ${selectedIds.length} selected resource${selectedIds.length === 1 ? "" : "s"}. Apply?`,
      tone: "warn",
    });
  }

  function bulkMove(value: string) {
    if (!value) return; // the picker's own placeholder, not a real choice
    request({
      input: { kind: "moveInTree", itemIds: selectedRootIds, value },
      title: "Relocation",
      message: `Move ${selectedRootIds.length} selected resource${selectedRootIds.length === 1 ? "" : "s"} (with everything inside them) to ${moveTargets.find((t) => t.id === value)?.name ?? "the chosen destination"}?`,
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
            {canSwitch && <RegisterScopeSwitch scope="mine" />}
            {state.refreshing && <span className="text-11 text-faint">Updating…</span>}
            {canEdit && (
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                + Add resources
              </Button>
            )}
            <ExportViewButton rows={state.rowNodes} byId={state.byId} fileBase="Resources" paged={state.mode === "flat" && state.total > state.pageSize} />
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
                  className="border-0 text-11 font-medium px-9 py-4 rounded-2"
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <FilterBar filters={state.filters} onChange={state.setFilters} onClear={state.clearFilters} {...state.filterSummary} />
        {state.mode === "grouped" && <GroupByBar value={state.groupBy} onChange={state.setGroupBy} />}

        {selectedIds.length > 0 && (
          <div className="border-b border-border bg-soft">
            {/* The common actions; the rest under More, so the bar reads at a glance. */}
            <div className="flex flex-wrap items-center gap-8 px-14 py-9">
              <span className="text-11 text-accent font-medium">{selectedIds.length} selected</span>
            <select
              defaultValue=""
              onChange={(e) => {
                bulkRequestSelect("setStatus", e.target.value, "Status change", STATUS_LABEL[e.target.value as keyof typeof STATUS_LABEL] ?? e.target.value);
                e.target.value = "";
              }}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
            >
              <option value="">Set status…</option>
              {(["WORKING", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"] as const).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {commonPropFields.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => {
                  setPropField(commonPropFields.find((f) => f.key === e.target.value) ?? null);
                  e.target.value = "";
                }}
                className="h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
              >
                <option value="">Edit details…</option>
                {commonPropFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}
            <div className="w-[190px]">
              <TreePicker
                options={containerTreeOptions(moveTargets)}
                value=""
                onChange={(id) => id && bulkMove(id)}
                placeholder="Put inside…"
              />
            </div>
            {canHandOver && <Button onClick={() => setTransferOpen(true)}>Move to another place…</Button>}
            {!canHandOver && <Button onClick={() => setReturnOpen(true)}>Return to store…</Button>}
            <Button onClick={() => setBulkMore((v) => !v)}>{bulkMore ? "Fewer actions" : "More…"}</Button>
            <button type="button" onClick={() => state.setSelection({})} className="text-11 text-dim ml-auto border-0 bg-transparent cursor-pointer">
              Clear selection
            </button>
            </div>
            {bulkMore && (
              <div className="flex flex-wrap items-center gap-8 px-14 pb-9">
            <select
              defaultValue=""
              onChange={(e) => {
                bulkRequestSelect("setCustodian", e.target.value, "Custody transfer", e.target.selectedOptions[0]?.text ?? e.target.value);
                e.target.value = "";
              }}
              className="h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
            >
              <option value="">Set custodian…</option>
              {options.custodian.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="w-[170px]">
              <TreePicker
                options={options.unitTree(options.owner)}
                value=""
                onChange={(id) => id && bulkRequestSelect("setOwnerOrg", id, "Ownership transfer", options.owner.find((o) => o.value === id)?.label ?? id)}
                placeholder="Set owning unit…"
              />
            </div>
            <div className="w-[170px]">
              <TreePicker
                options={options.unitTree(options.currentOrg)}
                value=""
                onChange={(id) => id && bulkRequestSelect("setCurrentOrg", id, "Current unit change", options.currentOrg.find((o) => o.value === id)?.label ?? id)}
                placeholder="Set current unit…"
              />
            </div>
            <input
              placeholder="Rename to…"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                bulkRename((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).value = "";
              }}
              className="h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent w-[140px]"
            />
            <button onClick={bulkDelete} className="text-11 text-bad ml-auto">
              Delete selected
            </button>
              </div>
            )}
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
              pending={markers}
              pendingTransfers={transferMarkers}
              matched={state.matched}
              matchedUnder={state.matchedUnder}
              emptyText={JSON.stringify(state.filters) === JSON.stringify(EMPTY_FILTERS) ? "Nothing is in your care yet. When a head assigns you a lab or store, what is in it shows here." : undefined}
            />

            {state.mode === "flat" && state.total > state.pageSize && (
              <div className="flex items-center justify-between px-14 py-9 border-t border-border">
                <span className="text-11 text-dim">
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

      <Inspector itemId={inspectId} onClose={() => setInspectId(null)} onChanged={afterChange} onNavigate={setInspectId} readOnly={!canEdit} />

      {canEdit && <AddModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={afterChange} />}

      {propField && (
        <BulkPropModal
          itemIds={selectedIds}
          field={propField}
          onClose={() => setPropField(null)}
          onApplied={() => {
            setPropField(null);
            state.setSelection({});
            afterChange();
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
            refreshMarkers();
          }}
        />
      )}

      {returnOpen && selectedRootIds.length > 0 && (
        <ReturnToStoreModal
          itemIds={selectedRootIds}
          label={selectedRootIds.length === 1 ? `"${state.byId.get(selectedRootIds[0])?.name ?? "1 resource"}"` : `${selectedRootIds.length} resources`}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false);
            state.setSelection({});
            state.refetch();
            refreshMarkers();
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

/** Mine, or the whole university (`?scope=university`) for those who may look that far. */
function RegisterPageInner() {
  const { me } = useAuth();
  const searchParams = useSearchParams();
  const canSwitch = mayBrowseUniversity(me?.user.roles);
  // Keyed by scope: each view keeps its own register state, starting fresh on a switch.
  return canSwitch && searchParams.get("scope") === "university" ? <WholeUniversityRegister key="university" /> : <MyRegister key="mine" canSwitch={canSwitch} />;
}

/** useSearchParams needs a Suspense boundary in the Next.js App Router. */
export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterPageInner />
    </Suspense>
  );
}

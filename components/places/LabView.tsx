"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DiffEntryDto, LabCommitRequestDto, LabStatesDto, LabTreeNodeDto, LabVersionDto, ResourceCategoryDto, VersionOpInput } from "@/lib/shared";
import { STATUS_LABEL } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { Button, ConfirmDialog, ErrorNote, Modal, Panel, Tag } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { StatusChip } from "@/components/resources/StatusChip";
import { CategoryIcon } from "@/components/resources/IconPicker";
import { CategoryCombobox } from "@/components/resources/AddModal";
import { LabCommitCard } from "@/components/resources/LabCommitCard";
import { couldNotLoad, toast } from "@/components/toast";

/**
 * One lab's contents and changes, as horizontal tabs (the lab's own page, places/[id],
 * shows its name, details and custodian above these):
 *  - In the lab:  the live register for this lab.
 *  - Changes:     the whole lab with its pending changes applied (changed · added ·
 *                 removed marked in place). The custodian's register edits gather here;
 *                 they send them once and the head approves — then they merge.
 *  - Approvals:   this lab's requests, and (for a head) everything waiting on them.
 */

export type LabTab = "current" | "draft" | "approvals";
type Tab = LabTab;
export const LAB_TABS: Array<{ key: Tab; label: string }> = [
  { key: "current", label: "In the lab" },
  { key: "draft", label: "My changes" },
  { key: "approvals", label: "Approvals" },
];
const EDITABLE_STATUSES = ["WORKING", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"] as const;

// ── One lab ─────────────────────────────────────────────────────────────

export function LabView({ states, tab, onTab, focusItem, onChanged }: { states: LabStatesDto; tab: Tab; onTab: (t: Tab) => void; focusItem: string | null; onChanged: () => void }) {
  const pendingCount = states.commits.filter((c) => c.status === "PENDING").length;
  const badge: Record<Tab, ReactNode> = {
    current: null,
    draft: states.draft ? <Tag tone={states.draft.status === "SUBMITTED" ? "warn" : "accent"}>{states.draft.diff.length}</Tag> : null,
    approvals: pendingCount ? <Tag tone="warn">{pendingCount}</Tag> : null,
  };
  return (
    <div className="flex flex-col gap-10 min-w-0">
      <div role="tablist" aria-label="This lab" className="flex gap-2 border-b border-border overflow-x-auto">
        {LAB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => onTab(t.key)}
            className={`px-12 h-32 text-12 font-medium flex items-center gap-6 border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? "border-accent text-text" : "border-transparent text-dim hover:text-text"}`}
          >
            {t.label}
            {badge[t.key]}
          </button>
        ))}
      </div>

      {tab === "current" && (
        <Panel title="In the lab: the live register">
          <TreeView nodes={states.current} markers={markersFromDiff(states.draft?.diff ?? [])} focusItem={focusItem} />
        </Panel>
      )}
      {tab === "draft" && <DraftTab states={states} focusItem={focusItem} onChanged={onChanged} />}
      {tab === "approvals" && <ApprovalsTab states={states} onChanged={onChanged} />}
    </div>
  );
}

function markersFromDiff(diff: DiffEntryDto[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const d of diff) {
    if (!d.markerItemId) continue;
    const line = d.kind === "added" ? `+ ${d.name} (new)` : d.kind === "removed" ? `${d.name}: removed` : d.lines.join(" · ");
    m.set(d.markerItemId, [...(m.get(d.markerItemId) ?? []), line]);
  }
  return m;
}

// ── Draft ───────────────────────────────────────────────────────────────

function DraftTab({ states, focusItem, onChanged }: { states: LabStatesDto; focusItem: string | null; onChanged: () => void }) {
  const draft = states.draft;
  const commit = states.commits.find((c) => c.targetKind === "VISIBLE" && c.status === "PENDING");
  return (
    <VersionPanel
      title="Changes: the place with what you've changed"
      explain={`Mark what broke, went for maintenance or was used up; rename, add or remove things. Nothing changes in the register until you send these and ${states.lab.approverLabel} approves. Then it all applies at once.`}
      states={states}
      version={draft}
      kind="draft"
      commit={commit}
      focusItem={focusItem}
      onChanged={onChanged}
      emptyText={`No changes yet. Edit here or in Resources, then send the changes to ${states.lab.approverLabel}.`}
      compareLabel="Compared with the lab as it is"
      removedFrom={states.current}
    />
  );
}

// ── The lab's changes: toolbar, changes, editable tree ──

function VersionPanel({
  title,
  explain,
  states,
  version,
  kind,
  commit,
  focusItem,
  onChanged,
  emptyText,
  compareLabel,
  removedFrom,
}: {
  title: string;
  explain: string;
  states: LabStatesDto;
  version: LabVersionDto | null;
  kind: "draft";
  commit: LabCommitRequestDto | undefined;
  focusItem: string | null;
  onChanged: () => void;
  emptyText: string;
  compareLabel: string;
  removedFrom: LabTreeNodeDto[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "discard" | "refresh">(null);
  const labId = states.lab.id;
  const editable = states.canEdit && version?.status === "EDITING";

  async function action(a: "start" | "submit" | "withdraw" | "discard" | "refresh") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/labs/${labId}/versions/${kind}/${a}`);
      setConfirm(null);
      const said: Partial<Record<typeof a, string>> = {
        submit: `Sent to ${states.lab.approverLabel} for approval. You'll be told when they decide.`,
        withdraw: "Taken back. You can keep editing.",
        discard: "Your unsent changes were discarded.",
        refresh: "Started again from what is in the lab now.",
      };
      if (said[a]) toast.success(said[a]!);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  async function op(input: VersionOpInput, dryRun = false): Promise<{ touched: string[]; plannedNames?: string[] } | null> {
    setError(null);
    try {
      const r = await api.post<{ touched: string[]; plannedNames?: string[] }>(`/resources/labs/${labId}/versions/${kind}/ops${dryRun ? "?dryRun=1" : ""}`, input);
      if (!dryRun) onChanged();
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That change was refused");
      return null;
    }
  }

  return (
    <Panel
      title={title}
      actions={
        <div className="flex flex-wrap items-center gap-6">
          {!version && states.canEdit && (
            <Button variant="primary" disabled={busy} onClick={() => action("start")}>
              Start making changes
            </Button>
          )}
          {version?.status === "EDITING" && states.canEdit && (
            <>
              <Button variant="primary" disabled={busy || version.diff.length === 0} onClick={() => action("submit")}>
                Send to {states.lab.approverLabel}
              </Button>
              <Button disabled={busy} onClick={() => setConfirm("refresh")}>
                Start again from the lab
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setConfirm("discard")}>
                Discard changes
              </Button>
            </>
          )}
          {version?.status === "SUBMITTED" && states.canEdit && (
            <Button disabled={busy} onClick={() => action("withdraw")}>
              Take back to edit
            </Button>
          )}
        </div>
      }
    >
      <div className="px-14 py-9 text-11 text-dim border-b border-border">{explain}</div>
      {error && (
        <div className="px-14 pt-9">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!version ? (
        <div className="px-14 py-12 text-11 text-dim">{emptyText}</div>
      ) : (
        <>
          <div className="px-14 py-9 border-b border-border flex flex-wrap items-center gap-8 text-11">
            <Tag tone={version.status === "SUBMITTED" ? "warn" : "accent"}>{version.status === "SUBMITTED" ? `Waiting for ${states.lab.approverLabel}` : "Not sent yet"}</Tag>
            <span className="text-dim">
              by {version.createdByName} · updated {new Date(version.updatedAt).toLocaleString()}
            </span>
            {version.rejectionNote && <span className="text-bad">Sent back: “{version.rejectionNote}”</span>}
          </div>
          {commit && (
            <div className="p-12 border-b border-border">
              <LabCommitCard request={commit} onDecided={onChanged} showLabLink={false} />
            </div>
          )}
          <ChangesList diff={version.diff} label={compareLabel} />
          <VersionTree version={version} editable={editable} focusItem={focusItem} removedFrom={removedFrom} onOp={op} />
        </>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm === "discard" ? "Discard changes" : "Start again from the lab"}
          tone={confirm === "discard" ? "danger" : "warn"}
          confirmLabel={confirm === "discard" ? "Discard" : "Start again"}
          busy={busy}
          error={null}
          message={confirm === "discard" ? "Throw away every change you've made to this lab? Nothing in the register changes." : "Replace your changes with a fresh copy of the lab as it is now? The changes made so far are lost."}
          onConfirm={() => action(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Panel>
  );
}

function ChangesList({ diff, label }: { diff: DiffEntryDto[]; label: string }) {
  const [open, setOpen] = useState(true);
  const tone = { changed: "text-warn", added: "text-good", removed: "text-bad" } as const;
  const word = { changed: "changed", added: "new", removed: "removed" } as const;
  return (
    <div className="border-b border-border">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full text-left px-14 py-8 text-11 font-semibold uppercase tracking-label text-faint flex items-center gap-6">
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        What it changes · {diff.length} {diff.length === 1 ? "entry" : "entries"} <span className="normal-case tracking-normal font-normal">({label})</span>
      </button>
      {open && (
        <div className="px-14 pb-10 flex flex-col gap-3 max-h-[240px] overflow-y-auto">
          {diff.length === 0 && <div className="text-11 text-faint">Nothing yet. It matches.</div>}
          {diff.map((d, i) => (
            <div key={i} className="text-11 flex gap-8">
              <span className={`w-60 flex-none font-semibold ${tone[d.kind]}`}>{word[d.kind]}</span>
              <span className="font-medium">
                {d.name}
                {d.where && <span className="font-normal text-faint"> in {d.where}</span>}
              </span>
              <span className="text-dim">{d.lines.join(" · ")}</span>
              {d.note && <span className="text-faint italic">“{d.note}”</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Trees ───────────────────────────────────────────────────────────────

interface Row {
  node: LabTreeNodeDto;
  depth: number;
  hasKids: boolean;
  removed?: boolean;
}

function flatten(nodes: LabTreeNodeDto[], collapsed: Set<string>, extraRemoved: Array<{ node: LabTreeNodeDto; parentId: string | null }>): Row[] {
  const kids = new Map<string | null, LabTreeNodeDto[]>();
  const removedKids = new Map<string | null, LabTreeNodeDto[]>();
  for (const n of nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  for (const r of extraRemoved) removedKids.set(r.parentId, [...(removedKids.get(r.parentId) ?? []), r.node]);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const out: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const list = [...(kids.get(parentId) ?? [])].sort((a, b) => collator.compare(a.name, b.name));
    for (const n of list) {
      const hasKids = (kids.get(n.id)?.length ?? 0) > 0 || (removedKids.get(n.id)?.length ?? 0) > 0;
      out.push({ node: n, depth, hasKids });
      if (hasKids && !collapsed.has(n.id)) walk(n.id, depth + 1);
    }
    for (const r of removedKids.get(parentId) ?? []) out.push({ node: r, depth, hasKids: false, removed: true });
  };
  walk(null, 0);
  return out;
}

/** Collapse everything below the lab's direct contents, except the path to `focus`. */
function initialCollapsed(nodes: LabTreeNodeDto[], focus: string | null): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keep = new Set<string>();
  let cur = focus ? (byId.get(focus) ?? nodes.find((n) => n.sourceItemId === focus)) : undefined;
  while (cur) {
    keep.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  const parents = new Set(nodes.map((n) => n.parentId).filter((p): p is string => Boolean(p)));
  const root = nodes.find((n) => n.parentId === null);
  return new Set([...parents].filter((p) => p !== root?.id && !keep.has(p)));
}

function TreeView({ nodes, markers, focusItem, addedIds }: { nodes: LabTreeNodeDto[]; markers?: Map<string, string[]>; focusItem: string | null; addedIds?: Set<string> }) {
  const [collapsed, setCollapsed] = useState(() => initialCollapsed(nodes, focusItem));
  const rows = flatten(nodes, collapsed, []);
  const toggle = (id: string) => setCollapsed((c) => (c.has(id) ? (c.delete(id), new Set(c)) : new Set(c).add(id)));
  return (
    <div className="max-h-[65vh] overflow-y-auto">
      <TreeControls onCollapse={() => setCollapsed(initialCollapsed(nodes, null))} />
      {rows.map(({ node, depth, hasKids }) => (
        <TreeRow key={node.id} node={node} depth={depth} hasKids={hasKids} open={!collapsed.has(node.id)} onToggle={() => toggle(node.id)} focused={node.id === focusItem || node.sourceItemId === focusItem}>
          {addedIds?.has(node.id) && <Tag tone="good">to acquire</Tag>}
          {markers?.get(node.id) && (
            <span className="text-11 text-warn truncate" title={markers.get(node.id)!.join("\n")}>
              * {markers.get(node.id)!.join(" · ")}
            </span>
          )}
        </TreeRow>
      ))}
    </div>
  );
}

function TreeControls({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div className="flex gap-10 px-14 py-6 border-b border-border text-11">
      <button onClick={onCollapse} className="text-accent hover:underline">
        Collapse all
      </button>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  hasKids,
  open,
  onToggle,
  focused,
  removed,
  selected,
  onSelect,
  children,
}: {
  node: LabTreeNodeDto;
  depth: number;
  hasKids: boolean;
  open: boolean;
  onToggle: () => void;
  focused?: boolean;
  removed?: boolean;
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-6 border-b border-border px-10 py-4 text-11 ${focused ? "bg-soft" : selected ? "bg-sel" : ""} ${removed ? "opacity-70" : ""}`}
      style={{ paddingLeft: 10 + depth * 16 }}
    >
      {onSelect && !removed ? (
        <input type="checkbox" checked={Boolean(selected)} onChange={(e) => onSelect(e.target.checked)} className="flex-none" />
      ) : (
        onSelect && <span className="w-13 flex-none" />
      )}
      <button
        onClick={onToggle}
        aria-expanded={hasKids ? open : undefined}
        aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
        tabIndex={hasKids ? undefined : -1}
        aria-hidden={hasKids ? undefined : true}
        className={`w-14 flex-none text-10.5 text-dim ${hasKids ? "" : "invisible"}`}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      <CategoryIcon iconKey={node.categoryIconKey} className="size-12 flex-none text-dim" />
      <span className={`truncate ${removed ? "line-through text-bad" : ""} ${depth === 0 ? "font-semibold" : ""}`}>{node.name}</span>
      <span className="text-11 text-faint truncate flex-none max-w-[120px]">{node.categoryName}</span>
      <span className="flex-none">
        <StatusChip status={node.effectiveStatus} />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-6 justify-end">{children}</span>
    </div>
  );
}

function VersionTree({
  version,
  editable,
  focusItem,
  removedFrom,
  onOp,
}: {
  version: LabVersionDto;
  editable: boolean;
  focusItem: string | null;
  removedFrom: LabTreeNodeDto[];
  onOp: (input: VersionOpInput, dryRun?: boolean) => Promise<{ touched: string[]; plannedNames?: string[] } | null>;
}) {
  const [collapsed, setCollapsed] = useState(() => initialCollapsed(version.nodes, focusItem));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addTo, setAddTo] = useState<LabTreeNodeDto | null>(null);
  const [renaming, setRenaming] = useState<LabTreeNodeDto | null>(null);
  const [removing, setRemoving] = useState<LabTreeNodeDto[] | null>(null);
  useEffect(() => setSelected(new Set()), [version.updatedAt]);

  const bySource = useMemo(() => new Map(version.nodes.filter((n) => n.sourceItemId).map((n) => [n.sourceItemId!, n.id])), [version.nodes]);
  const changedLines = useMemo(() => new Map(version.diff.filter((d) => d.kind === "changed" && d.versionItemId).map((d) => [d.versionItemId!, d.lines])), [version.diff]);
  const addedTop = useMemo(() => new Set(version.diff.filter((d) => d.kind === "added" && d.versionItemId).map((d) => d.versionItemId!)), [version.diff]);
  const addedAll = useMemo(() => new Set(version.nodes.filter((n) => !n.sourceItemId).map((n) => n.id)), [version.nodes]);
  // Removed real items, placed back under the version row their parent maps to.
  const removed = useMemo(() => {
    const liveById = new Map(removedFrom.map((n) => [n.id, n]));
    return version.diff
      .filter((d) => d.kind === "removed" && d.sourceItemId && liveById.has(d.sourceItemId))
      .map((d) => {
        const live = liveById.get(d.sourceItemId!)!;
        return { node: { ...live, id: `removed:${live.id}` }, parentId: live.parentId ? (bySource.get(live.parentId) ?? null) : null };
      });
  }, [version.diff, removedFrom, bySource]);

  const rows = flatten(version.nodes, collapsed, removed);
  const toggle = (id: string) => setCollapsed((c) => (c.has(id) ? (c.delete(id), new Set(c)) : new Set(c).add(id)));
  const selectedIds = [...selected];

  const setStatus = async (ids: string[], value: string) => {
    if (!value) return;
    await onOp({ kind: "setStatus", itemIds: ids, value: value as (typeof EDITABLE_STATUSES)[number] });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-10 px-14 py-6 border-b border-border text-11">
        <button onClick={() => setCollapsed(initialCollapsed(version.nodes, null))} className="text-accent hover:underline">
          Collapse all
        </button>
        {editable && selectedIds.length > 0 && (
          <span className="flex items-center gap-6 ml-auto">
            <span className="text-accent font-medium">{selectedIds.length} selected</span>
            <select defaultValue="" onChange={(e) => (setStatus(selectedIds, e.target.value), (e.target.value = ""))} className="h-22 px-6 rounded-2 border border-border2 bg-panel text-11">
              <option value="">Set status…</option>
              {EDITABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <Button variant="danger" onClick={() => setRemoving(version.nodes.filter((n) => selected.has(n.id)))}>
              Remove
            </Button>
            <button onClick={() => setSelected(new Set())} className="text-faint">
              Clear
            </button>
          </span>
        )}
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        {rows.map(({ node, depth, hasKids, removed: isRemoved }) => {
          const isRoot = node.parentId === null && !isRemoved;
          return (
            <TreeRow
              key={node.id}
              node={node}
              depth={depth}
              hasKids={hasKids}
              open={!collapsed.has(node.id)}
              onToggle={() => toggle(node.id)}
              focused={node.id === focusItem || node.sourceItemId === focusItem}
              removed={isRemoved}
              selected={selected.has(node.id)}
              onSelect={editable && !isRoot ? (on) => setSelected((s) => (on ? new Set(s).add(node.id) : (s.delete(node.id), new Set(s)))) : undefined}
            >
              {isRemoved && <Tag tone="bad">removed</Tag>}
              {addedTop.has(node.id) ? <Tag tone="good">new</Tag> : addedAll.has(node.id) ? <span className="text-10.5 text-good">new</span> : null}
              {changedLines.get(node.id) && (
                <span className="text-11 text-warn truncate" title={changedLines.get(node.id)!.join("\n")}>
                  {changedLines.get(node.id)!.join(" · ")}
                </span>
              )}
              {editable && !isRemoved && (
                <span className="flex flex-none items-center gap-4">
                  {!isRoot && (
                    <select
                      value={node.status}
                      onChange={(e) => setStatus([node.id], e.target.value)}
                      title="Set this item's own status"
                      className="h-20 px-4 rounded-2 border border-border2 bg-panel text-11"
                    >
                      {EDITABLE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  )}
                  <RowButton onClick={() => setAddTo(node)} title="Add inside">
                    + add
                  </RowButton>
                  {!isRoot && (
                    <>
                      <RowButton onClick={() => setRenaming(node)} title="Rename">
                        rename
                      </RowButton>
                      <RowButton onClick={() => setRemoving([node])} title="Remove">
                        ✕
                      </RowButton>
                    </>
                  )}
                </span>
              )}
            </TreeRow>
          );
        })}
      </div>

      {addTo && <AddInsideDialog parent={addTo} onOp={onOp} onClose={() => setAddTo(null)} />}
      {renaming && <RenameDialog node={renaming} onOp={onOp} onClose={() => setRenaming(null)} />}
      {removing && (
        <ConfirmDialog
          title="Remove"
          tone="danger"
          confirmLabel="Remove"
          busy={false}
          error={null}
          message={`Remove ${removing.length === 1 ? `"${removing[0].name}"` : `${removing.length} items`} (and anything inside) from this copy?`}
          onConfirm={async () => {
            const ids = removing.map((n) => n.id);
            setRemoving(null);
            await onOp({ kind: "deleteItem", itemIds: ids });
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function RowButton({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button onClick={onClick} title={title} className="h-20 px-5 rounded-2 border border-border2 text-11 text-dim hover:text-accent hover:border-accent">
      {children}
    </button>
  );
}

function RenameDialog({ node, onOp, onClose }: { node: LabTreeNodeDto; onOp: (i: VersionOpInput) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(node.name);
  const canRename = Boolean(name.trim()) && name.trim() !== node.name;
  return (
    <Modal title={`Rename "${node.name}"`} onClose={onClose} width="380px">
      {/* A form, so Enter renames — typing a name and pressing Enter is what people do. */}
      <form
        className="flex flex-col gap-14"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canRename) return;
          await onOp({ kind: "setName", itemIds: [node.id], value: name.trim() });
          onClose();
        }}
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="w-full h-26 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent" />
        <div className="flex gap-8">
          <Button type="submit" variant="primary" disabled={!canRename}>
            Rename
          </Button>
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Add N × a category inside a row — name defaults to the category's, numbering
 *  continues, and a preview shows the names before anything is added. */
function AddInsideDialog({ parent, onOp, onClose }: { parent: LabTreeNodeDto; onOp: (i: VersionOpInput, dryRun?: boolean) => Promise<{ touched: string[]; plannedNames?: string[] } | null>; onClose: () => void }) {
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryId, setCategoryId] = useState("");
  const [count, setCount] = useState(1);
  const [name, setName] = useState("");
  const [planned, setPlanned] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then((rows) => setCategories(rows.filter((c) => c.active)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    setName(categories.find((c) => c.id === categoryId)?.name ?? "");
    setPlanned(null);
  }, [categoryId, categories]);
  useEffect(() => setPlanned(null), [count, name]);

  const input: VersionOpInput = { kind: "createItem", parentId: parent.id, categoryId, count, ...(name.trim() ? { name: name.trim() } : {}) };

  return (
    <Modal title={`Add inside ${parent.name}`} onClose={onClose} width="440px">
      <label className="block">
        <div className="text-10.5 uppercase tracking-label text-faint font-semibold mb-3">Category</div>
        <CategoryCombobox categories={categories} value={categoryId} loading={loading} onChange={setCategoryId} onAddCategory={onClose} />
      </label>
      {categoryId && (
        <div className="grid grid-cols-[1fr_90px] gap-8">
          <label className="block">
            <div className="text-10.5 uppercase tracking-label text-faint font-semibold mb-3">Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent" />
          </label>
          <label className="block">
            <div className="text-10.5 uppercase tracking-label text-faint font-semibold mb-3">How many</div>
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 font-mono outline-none focus:border-accent"
            />
          </label>
        </div>
      )}
      {planned && (
        <div className="rounded-2 border border-good bg-goodbg px-10 py-7 text-11">
          <div className="font-semibold text-good mb-3">Will add</div>
          {planned.join(", ")}
        </div>
      )}
      <div className="flex gap-8">
        {!planned ? (
          <Button
            variant="primary"
            disabled={!categoryId || busy}
            onClick={async () => {
              setBusy(true);
              const r = await onOp(input, true);
              setBusy(false);
              if (r) setPlanned(r.plannedNames ?? []);
            }}
          >
            {busy ? "Checking…" : "Preview…"}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await onOp(input);
              setBusy(false);
              if (r) onClose();
            }}
          >
            {busy ? "Adding…" : `Add ${planned.length}`}
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  );
}

// ── Approvals ───────────────────────────────────────────────────────────

function ApprovalsTab({ states, onChanged }: { states: LabStatesDto; onChanged: () => void }) {
  const [inbox, setInbox] = useState<LabCommitRequestDto[] | null>(null);
  useEffect(() => {
    api
      .get<LabCommitRequestDto[]>("/resources/lab-commits?box=inbox")
      .then(setInbox)
      .catch(couldNotLoad("the bookings waiting on this lab", () => setInbox([])));
  }, [states]);
  const others = (inbox ?? []).filter((r) => r.labItemId !== states.lab.id);
  return (
    <div className="flex flex-col gap-10">
      <Panel title={`${states.lab.name}: requests`}>
        {states.commits.length === 0 ? (
          <div className="px-14 py-12 text-11 text-dim">No changes have been sent for this lab yet.</div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {states.commits.map((c) => (
              <LabCommitCard key={c.id} request={c} onDecided={onChanged} showLabLink={false} />
            ))}
          </div>
        )}
      </Panel>
      {others.length > 0 && (
        <Panel title="Also waiting on you">
          <div className="p-12 flex flex-col gap-10">
            {others.map((c) => (
              <LabCommitCard key={c.id} request={c} onDecided={onChanged} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

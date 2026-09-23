"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DiffEntryDto, LabCommitRequestDto, LabStatesDto, LabSummaryDto, LabTreeNodeDto, LabVersionDto, IdealStatRowDto, ResourceCategoryDto, VersionOpInput } from "@/lib/shared";
import { STATUS_LABEL } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { Button, ConfirmDialog, ErrorNote, Modal, Panel, Screen, Tag } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { StatusChip } from "./StatusChip";
import { CategoryIcon } from "./IconPicker";
import { CategoryCombobox } from "./AddModal";
import { LabCommitCard } from "./LabCommitCard";

/**
 * Lab states — one page, one lab at a time, as horizontal tabs:
 *  - Current:   the live register for this lab.
 *  - Draft:     the whole lab with its pending update applied (changed · added · removed
 *               marked in place). The custodian edits it here (or just edits the register
 *               when the department uses drafts); the head approves it — it then merges.
 *  - Ideal:     what the lab should hold — a whole tree too — with Ideal · Current · Gap
 *               per category. The custodian proposes; the head approves. Purchasing
 *               measures the lab against the approved Ideal.
 *  - Approvals: this lab's requests, and (for a head) everything waiting on them.
 */

type Tab = "current" | "draft" | "ideal" | "approvals";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "current", label: "Current" },
  { key: "draft", label: "Draft" },
  { key: "ideal", label: "Ideal" },
  { key: "approvals", label: "Approvals" },
];
const EDITABLE_STATUSES = ["WORKING", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"] as const;

function LabStatesInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const labId = params.get("lab");
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "current") as Tab;
  const focusItem = params.get("item");

  const [labs, setLabs] = useState<LabSummaryDto[] | null>(null);
  const [states, setStates] = useState<LabStatesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const go = useCallback(
    (patch: Record<string, string | null>) => {
      const qp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) (v === null ? qp.delete(k) : qp.set(k, v));
      router.replace(`${pathname}?${qp.toString()}`);
    },
    [params, pathname, router],
  );

  useEffect(() => {
    api
      .get<LabSummaryDto[]>("/resources/labs")
      .then((rows) => {
        setLabs(rows);
        if (!labId && rows.length) go({ lab: rows[0].id });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load your labs"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  useEffect(() => {
    if (!labId) return;
    let live = true;
    api
      .get<LabStatesDto>(`/resources/labs/${labId}/states`)
      .then((s) => live && (setStates(s), setError(null)))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Could not load this lab"));
    return () => {
      live = false;
    };
  }, [labId, reloadToken]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (labs ?? []).filter((l) => !needle || `${l.name} ${l.ownerOrgNodeName} ${l.custodianName}`.toLowerCase().includes(needle));
  }, [labs, filter]);
  const byUnit = useMemo(() => {
    const m = new Map<string, LabSummaryDto[]>();
    for (const l of shown) m.set(l.ownerOrgNodeName, [...(m.get(l.ownerOrgNodeName) ?? []), l]);
    return [...m.entries()];
  }, [shown]);

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid gap-12 md:grid-cols-[250px_minmax(0,1fr)] items-start">
        <Panel title="Labs">
          <div className="p-8 border-b border-border">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a lab…"
              className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
            />
          </div>
          {labs === null ? (
            <PanelLoading rows={4} />
          ) : labs.length === 0 ? (
            <div className="px-12 py-12 text-11 text-dim">You don&apos;t hold or head any lab.</div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto py-4">
              {byUnit.map(([unit, rows]) => (
                <div key={unit}>
                  <div className="px-12 pt-8 pb-3 text-9.5 uppercase tracking-label text-faint font-semibold">{unit}</div>
                  {rows.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => go({ lab: l.id, item: null })}
                      className={`w-full text-left px-12 py-6 flex flex-col gap-2 ${l.id === labId ? "bg-sel" : "hover:bg-panel2"}`}
                    >
                      <span className="flex items-center gap-6 text-11">
                        <CategoryIcon iconKey={l.categoryIconKey} className="size-12 flex-none text-dim" />
                        <span className="truncate font-medium">{l.name}</span>
                      </span>
                      <span className="flex flex-wrap gap-4 pl-18">
                        {l.draft && <Tag tone={l.draft === "SUBMITTED" ? "warn" : "accent"}>{l.draft === "SUBMITTED" ? "draft submitted" : `draft · ${l.draftChanges}`}</Tag>}
                        {l.proposal && <Tag tone={l.proposal === "SUBMITTED" ? "warn" : "accent"}>{l.proposal === "SUBMITTED" ? "ideal submitted" : "ideal proposal"}</Tag>}
                        {l.hasIdeal ? <Tag tone="good">ideal set</Tag> : <Tag tone="neutral">no ideal</Tag>}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {!labId ? (
          <Panel>
            <div className="px-14 py-14 text-11.5 text-dim">Choose a lab.</div>
          </Panel>
        ) : !states || states.lab.id !== labId ? (
          <Panel>
            <PanelLoading rows={6} />
          </Panel>
        ) : (
          <LabView states={states} tab={tab} onTab={(t) => go({ tab: t })} focusItem={focusItem} onChanged={reload} />
        )}
      </div>
    </Screen>
  );
}

// ── One lab ─────────────────────────────────────────────────────────────

function LabView({ states, tab, onTab, focusItem, onChanged }: { states: LabStatesDto; tab: Tab; onTab: (t: Tab) => void; focusItem: string | null; onChanged: () => void }) {
  const { lab } = states;
  const pendingCount = states.commits.filter((c) => c.status === "PENDING").length;
  const badge: Record<Tab, ReactNode> = {
    current: null,
    draft: states.draft ? <Tag tone={states.draft.status === "SUBMITTED" ? "warn" : "accent"}>{states.draft.diff.length}</Tag> : null,
    ideal: states.idealProposal ? <Tag tone="warn">proposal</Tag> : states.ideal ? <Tag tone="good">set</Tag> : null,
    approvals: pendingCount ? <Tag tone="warn">{pendingCount}</Tag> : null,
  };
  return (
    <div className="flex flex-col gap-10 min-w-0">
      <div className="bg-panel border border-border rounded-3 px-14 py-10">
        <div className="text-13 font-semibold">{lab.name}</div>
        <div className="text-10.5 text-dim mt-2">
          {lab.ownerOrgNodeName} · custodian {lab.custodianName} · head {lab.headName ?? <span className="text-warn">vacant</span>}
          {lab.draftWorkflowEnabled && <> · <span className="text-accent">edits in the register go into the draft</span></>}
        </div>
        <div className="flex gap-4 mt-10 border-b border-border -mb-10">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onTab(t.key)}
              className={`px-12 py-7 text-11 font-medium flex items-center gap-6 border-b-2 -mb-px ${tab === t.key ? "border-accent text-text" : "border-transparent text-dim hover:text-text"}`}
            >
              {t.label}
              {badge[t.key]}
            </button>
          ))}
        </div>
      </div>

      {tab === "current" && (
        <Panel title="Current — the live register">
          <TreeView nodes={states.current} markers={markersFromDiff(states.draft?.diff ?? [])} focusItem={focusItem} />
        </Panel>
      )}
      {tab === "draft" && <DraftTab states={states} focusItem={focusItem} onChanged={onChanged} />}
      {tab === "ideal" && <IdealTab states={states} focusItem={focusItem} onChanged={onChanged} />}
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
      title="Draft — the lab with its pending update"
      explain="Mark what broke, went for maintenance or was consumed; rename, add or remove things. Nothing changes in the register until the department head approves — then it all applies at once."
      states={states}
      version={draft}
      kind="draft"
      commit={commit}
      focusItem={focusItem}
      onChanged={onChanged}
      emptyText="No draft open. Start one to prepare an update of this lab for the head's approval."
      compareLabel="Compared with Current"
      removedFrom={states.current}
    />
  );
}

// ── Ideal ───────────────────────────────────────────────────────────────

function IdealTab({ states, focusItem, onChanged }: { states: LabStatesDto; focusItem: string | null; onChanged: () => void }) {
  const [show, setShow] = useState<"approved" | "proposal">(states.idealProposal ? "proposal" : "approved");
  const commit = states.commits.find((c) => c.targetKind === "IDEAL" && c.status === "PENDING");
  return (
    <div className="flex flex-col gap-10">
      <Panel
        title={show === "approved" ? "Ideal vs Current (approved ideal)" : "Proposal vs Current"}
        actions={
          <div className="flex gap-4">
            {(["approved", "proposal"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setShow(k)}
                style={{ background: show === k ? "var(--accent)" : "var(--panel2)", color: show === k ? "#fff" : "var(--dim)" }}
                className="border-0 text-10.5 font-medium px-9 py-4 rounded-2"
              >
                {k === "approved" ? "Approved ideal" : "Proposal"}
              </button>
            ))}
          </div>
        }
      >
        <StatsTable rows={show === "approved" ? states.idealStats : states.proposalStats} empty={show === "approved" ? "No ideal approved yet for this lab." : "No proposal open."} />
      </Panel>
      {show === "approved" ? (
        <Panel title="Approved ideal — what the lab should hold">
          {states.ideal ? (
            <TreeView nodes={states.ideal.nodes} focusItem={focusItem} addedIds={new Set(states.ideal.nodes.filter((n) => !n.sourceItemId).map((n) => n.id))} />
          ) : (
            <div className="px-14 py-12 text-11 text-dim">
              None yet. {states.canEdit ? "Open the Proposal view and start one — it begins as a copy of the lab as it is now." : "The custodian proposes one; the head approves it."}
            </div>
          )}
        </Panel>
      ) : (
        <VersionPanel
          title="Ideal proposal — what this lab should hold"
          explain="Start from the lab as it is (or the current ideal) and shape it into what the lab should have: add the missing workstations, outlets… The head approves it; purchasing then measures the lab against it. The register itself never changes from here."
          states={states}
          version={states.idealProposal}
          kind="ideal"
          commit={commit}
          focusItem={focusItem}
          onChanged={onChanged}
          emptyText={states.ideal ? "Propose a change to the approved ideal — it starts as a copy of it." : "Propose this lab's ideal — it starts as a copy of the lab as it is now."}
          compareLabel="Compared with Current"
          removedFrom={states.current}
        />
      )}
    </div>
  );
}

function StatsTable({ rows, empty }: { rows: IdealStatRowDto[]; empty: string }) {
  if (!rows.length) return <div className="px-14 py-12 text-11 text-dim">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-11">
        <thead>
          <tr className="text-9.5 uppercase tracking-label text-faint font-semibold border-b border-border">
            <th className="text-left px-14 py-7">Category</th>
            <th className="text-right px-10 py-7">Ideal</th>
            <th className="text-right px-10 py-7">Current</th>
            <th className="text-right px-10 py-7">Gap</th>
            <th className="text-right px-10 py-7">Needs attention</th>
            <th className="text-left px-14 py-7">Missing (to acquire)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.categoryId} className="border-b border-border last:border-0">
              <td className="px-14 py-6">
                <span className="flex items-center gap-6">
                  <CategoryIcon iconKey={r.categoryIconKey} className="size-12 text-dim" />
                  {r.categoryName}
                </span>
              </td>
              <td className="px-10 py-6 text-right font-mono">{r.idealCount}</td>
              <td className="px-10 py-6 text-right font-mono">{r.currentCount}</td>
              <td className={`px-10 py-6 text-right font-mono ${r.gap > 0 ? "text-bad font-semibold" : "text-faint"}`}>{r.gap}</td>
              <td className={`px-10 py-6 text-right font-mono ${r.needsAttention > 0 ? "text-warn" : "text-faint"}`}>{r.needsAttention}</td>
              <td className="px-14 py-6 text-10.5 text-dim">
                {r.missing.length ? summarizeNames(r.missing.map((m) => m.name)) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── A version (Draft or Ideal proposal): toolbar, changes, editable tree ──

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
  kind: "draft" | "ideal";
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
              {kind === "draft" ? "Start a draft" : "Start a proposal"}
            </Button>
          )}
          {version?.status === "EDITING" && states.canEdit && (
            <>
              <Button variant="primary" disabled={busy || (kind === "draft" && version.diff.length === 0)} onClick={() => action("submit")}>
                Submit for approval
              </Button>
              {kind === "draft" && (
                <Button disabled={busy} onClick={() => setConfirm("refresh")}>
                  Refresh from Current
                </Button>
              )}
              <Button variant="danger" disabled={busy} onClick={() => setConfirm("discard")}>
                Discard
              </Button>
            </>
          )}
          {version?.status === "SUBMITTED" && states.canEdit && (
            <Button disabled={busy} onClick={() => action("withdraw")}>
              Withdraw to edit
            </Button>
          )}
        </div>
      }
    >
      <div className="px-14 py-9 text-10.5 text-dim border-b border-border">{explain}</div>
      {error && (
        <div className="px-14 pt-9">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!version ? (
        <div className="px-14 py-12 text-11 text-dim">{emptyText}</div>
      ) : (
        <>
          <div className="px-14 py-9 border-b border-border flex flex-wrap items-center gap-8 text-10.5">
            <Tag tone={version.status === "SUBMITTED" ? "warn" : "accent"}>{version.status === "SUBMITTED" ? "Waiting for the head" : "Editing"}</Tag>
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
          title={confirm === "discard" ? "Discard" : "Refresh from Current"}
          tone={confirm === "discard" ? "danger" : "primary"}
          confirmLabel={confirm === "discard" ? "Discard" : "Refresh"}
          busy={busy}
          error={null}
          message={confirm === "discard" ? "Throw away everything in this copy? Nothing in the register changes." : "Replace this draft with a fresh copy of the lab as it is now? Changes made in the draft so far are lost."}
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
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left px-14 py-8 text-10.5 font-semibold uppercase tracking-label text-faint flex items-center gap-6">
        <span>{open ? "▾" : "▸"}</span>
        What it changes · {diff.length} {diff.length === 1 ? "entry" : "entries"} <span className="normal-case tracking-normal font-normal">({label})</span>
      </button>
      {open && (
        <div className="px-14 pb-10 flex flex-col gap-3 max-h-[240px] overflow-y-auto">
          {diff.length === 0 && <div className="text-10.5 text-faint">Nothing yet — it matches.</div>}
          {diff.map((d, i) => (
            <div key={i} className="text-10.5 flex gap-8">
              <span className={`w-60 flex-none font-semibold ${tone[d.kind]}`}>{word[d.kind]}</span>
              <span className="font-medium">{d.name}</span>
              <span className="text-dim">{d.lines.join(" · ")}</span>
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
      <TreeControls onExpand={() => setCollapsed(new Set())} onCollapse={() => setCollapsed(initialCollapsed(nodes, null))} />
      {rows.map(({ node, depth, hasKids }) => (
        <TreeRow key={node.id} node={node} depth={depth} hasKids={hasKids} open={!collapsed.has(node.id)} onToggle={() => toggle(node.id)} focused={node.id === focusItem || node.sourceItemId === focusItem}>
          {addedIds?.has(node.id) && <Tag tone="good">to acquire</Tag>}
          {markers?.get(node.id) && (
            <span className="text-10 text-warn truncate" title={markers.get(node.id)!.join("\n")}>
              * {markers.get(node.id)!.join(" · ")}
            </span>
          )}
        </TreeRow>
      ))}
    </div>
  );
}

function TreeControls({ onExpand, onCollapse }: { onExpand: () => void; onCollapse: () => void }) {
  return (
    <div className="flex gap-10 px-14 py-6 border-b border-border text-10.5">
      <button onClick={onExpand} className="text-accent hover:underline">
        Expand all
      </button>
      <button onClick={onCollapse} className="text-accent hover:underline">
        Collapse
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
      <button onClick={onToggle} className={`w-14 flex-none text-9.5 text-dim ${hasKids ? "" : "invisible"}`}>
        {open ? "▾" : "▸"}
      </button>
      <CategoryIcon iconKey={node.categoryIconKey} className="size-12 flex-none text-dim" />
      <span className={`truncate ${removed ? "line-through text-bad" : ""} ${depth === 0 ? "font-semibold" : ""}`}>{node.name}</span>
      <span className="text-10 text-faint truncate flex-none max-w-[120px]">{node.categoryName}</span>
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
      <div className="flex flex-wrap items-center gap-10 px-14 py-6 border-b border-border text-10.5">
        <button onClick={() => setCollapsed(new Set())} className="text-accent hover:underline">
          Expand all
        </button>
        <button onClick={() => setCollapsed(initialCollapsed(version.nodes, null))} className="text-accent hover:underline">
          Collapse
        </button>
        {editable && selectedIds.length > 0 && (
          <span className="flex items-center gap-6 ml-auto">
            <span className="text-accent font-medium">{selectedIds.length} selected</span>
            <select defaultValue="" onChange={(e) => (setStatus(selectedIds, e.target.value), (e.target.value = ""))} className="h-22 px-6 rounded-2 border border-border2 bg-panel text-10.5">
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
              {addedTop.has(node.id) ? <Tag tone="good">new</Tag> : addedAll.has(node.id) ? <span className="text-9.5 text-good">new</span> : null}
              {changedLines.get(node.id) && (
                <span className="text-10 text-warn truncate" title={changedLines.get(node.id)!.join("\n")}>
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
                      className="h-20 px-4 rounded-2 border border-border2 bg-panel text-10"
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
    <button onClick={onClick} title={title} className="h-20 px-5 rounded-2 border border-border2 text-10 text-dim hover:text-accent hover:border-accent">
      {children}
    </button>
  );
}

function RenameDialog({ node, onOp, onClose }: { node: LabTreeNodeDto; onOp: (i: VersionOpInput) => Promise<unknown>; onClose: () => void }) {
  const [name, setName] = useState(node.name);
  return (
    <Modal title={`Rename "${node.name}"`} onClose={onClose} width="380px">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="w-full h-26 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent" />
      <div className="flex gap-8">
        <Button
          variant="primary"
          disabled={!name.trim() || name.trim() === node.name}
          onClick={async () => {
            await onOp({ kind: "setName", itemIds: [node.id], value: name.trim() });
            onClose();
          }}
        >
          Rename
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
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
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Category</div>
        <CategoryCombobox categories={categories} value={categoryId} loading={loading} onChange={setCategoryId} onAddCategory={onClose} />
      </label>
      {categoryId && (
        <div className="grid grid-cols-[1fr_90px] gap-8">
          <label className="block">
            <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent" />
          </label>
          <label className="block">
            <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">How many</div>
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
        <div className="rounded-2 border border-good bg-goodbg px-10 py-7 text-10.5">
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
      .catch(() => setInbox([]));
  }, [states]);
  const others = (inbox ?? []).filter((r) => r.labItemId !== states.lab.id);
  return (
    <div className="flex flex-col gap-10">
      <Panel title={`${states.lab.name} — requests`}>
        {states.commits.length === 0 ? (
          <div className="px-14 py-12 text-11 text-dim">No drafts or ideal proposals have been submitted for this lab yet.</div>
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

/** useSearchParams needs a Suspense boundary in the Next.js App Router. */
export default function LabStatesPage() {
  return (
    <Suspense>
      <LabStatesInner />
    </Suspense>
  );
}

/** "Computer ×5, Workstation 21, Workstation 22 +3": identical names collapse into a count. */
function summarizeNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const parts = [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n));
  return parts.length > 6 ? `${parts.slice(0, 6).join(", ")} +${parts.length - 6}` : parts.join(", ");
}

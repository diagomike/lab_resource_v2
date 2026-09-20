"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import type { OrgNodeDto, OrgNodeKind, PersonDto, RoleKind } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, Tag, Button, ErrorNote, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { EntityPicker } from "@/components/EntityPicker";

/**
 * The whole org chart on one canvas — one place to see the structure AND create a node
 * of any kind (University/College/Department/Office), rather than three separate
 * per-kind pages. There is no "mark this node an approval office" toggle: being a
 * PARENT is what will make a node a mandatory approval step once the procurement module
 * exists — the org chart drawn here already IS that route, nothing more to configure.
 * (The chain-preview feature that read this live is deferred along with procurement
 * itself — see PROGRESS-SNAPSHOT.md.)
 */

const KIND_OPTIONS: OrgNodeKind[] = ["UNIVERSITY", "COLLEGE", "DEPARTMENT", "OFFICE"];
const NODE_WIDTH = 220;
const NODE_HEIGHT = 82;

interface CardData extends Record<string, unknown> {
  node: OrgNodeDto;
  selected: boolean;
}

function OrgNodeCard({ data }: NodeProps<Node<CardData>>) {
  const { node, selected } = data;
  return (
    <div
      className={`rounded-3 border px-10 py-8 bg-panel text-left ${selected ? "border-accent" : "border-border2"}`}
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border2" />
      <Handle type="source" position={Position.Bottom} className="!bg-border2" />
      <div className="flex items-center justify-between gap-6">
        <span className="text-11.5 font-medium leading-tight">{node.name}</span>
      </div>
      <div className="mt-4 flex items-center gap-4 flex-wrap">
        <Tag>{node.kind.toLowerCase()}</Tag>
        {!node.active && <Tag tone="bad">inactive</Tag>}
      </div>
      <div className="mt-4 text-9.5 text-faint truncate">
        {node.occupant ? node.occupant.name : "headless"}
      </div>
    </div>
  );
}

function layoutNodes(nodes: OrgNodeDto[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 36, ranksep: 90 });
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const n of nodes) for (const p of n.parentIds) g.setEdge(p, n.id);
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    positions.set(n.id, p ? { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 } : { x: 0, y: 0 });
  }
  return positions;
}

/** Graph/Cards, switched like tabs — a plain toggle rather than a dropdown since there
 *  are only ever these two and the admin should see both options at a glance. */
function ViewModeTabs({
  value,
  onChange,
}: {
  value: "graph" | "cards";
  onChange: (v: "graph" | "cards") => void;
}) {
  const options: { key: "graph" | "cards"; label: string }[] = [
    { key: "graph", label: "Graph" },
    { key: "cards", label: "Cards" },
  ];
  return (
    <div className="flex items-center border border-border2 rounded-2 overflow-hidden shrink-0 self-start">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`h-24 px-12 text-11 font-medium ${i > 0 ? "border-l border-border2" : ""} ${
            value === o.key ? "bg-accent text-white" : "bg-panel2 text-dim"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The mobile-friendly alternative to the canvas — same click-to-inspect behavior, no
 * pinch-zoom or pan required. Grouped by level since that's the one relationship a flat
 * list can still show at a glance; parent names are spelled out per card since the list
 * can't draw the connecting lines the graph does.
 */
function NodeCardList({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: OrgNodeDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const byLevel = useMemo(() => {
    const groups = new Map<number, OrgNodeDto[]>();
    for (const n of nodes) groups.set(n.level, [...(groups.get(n.level) ?? []), n]);
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [nodes]);

  if (nodes.length === 0) {
    return <div className="px-14 py-20 text-11.5 text-faint">No nodes yet — create one below.</div>;
  }

  return (
    <div className="h-full overflow-y-auto px-14 py-12 flex flex-col gap-16">
      {byLevel.map(([level, levelNodes]) => (
        <div key={level}>
          <div className="text-9.5 uppercase tracking-wider text-faint font-semibold mb-6">Level {level}</div>
          <div className="flex flex-col gap-6">
            {levelNodes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelect(n.id)}
                className={`text-left rounded-3 border px-10 py-8 bg-panel ${
                  n.id === selectedId ? "border-accent" : "border-border2"
                }`}
              >
                <div className="flex items-center justify-between gap-6">
                  <span className="text-11.5 font-medium leading-tight">{n.name}</span>
                  <Tag>{n.kind.toLowerCase()}</Tag>
                </div>
                <div className="mt-4 flex items-center gap-4 flex-wrap">
                  {!n.active && <Tag tone="bad">inactive</Tag>}
                  {n.parentIds.length > 0 && (
                    <span className="text-9.5 text-faint">
                      under {n.parentIds.map((p) => nodeById.get(p)?.name ?? "?").join(", ")}
                    </span>
                  )}
                </div>
                <div className="mt-4 text-9.5 text-faint truncate">
                  {n.occupant ? n.occupant.name : "headless"}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Every action here that changes who has access, destroys something, or changes how a
 * node is understood in the hierarchy goes through ConfirmDialog rather than firing on
 * the spot — a stray click on the occupant picker, kind dropdown, or a button shouldn't
 * silently revoke someone's login, delete a node, or relabel it. Creating a node and
 * reassigning parents are NOT in this set: reassigning is reversible (drag it back), and
 * creation only ever adds, never removes, access.
 */
type PendingAction =
  | { kind: "assignOccupant"; personId: string; personName: string }
  | { kind: "vacateOccupant" }
  | { kind: "changeKind"; newKind: OrgNodeKind }
  | { kind: "deactivate" }
  | { kind: "delete" };

/** Defaults to the card list on a narrow screen — the ReactFlow/dagre canvas is a lot of
 *  moving, pinch-zoomable furniture for a phone. Desktop still opens on the graph. Either
 *  way it's a tab the admin can flip anytime; this only picks which one loads first. */
function defaultViewMode(): "graph" | "cards" {
  return typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "graph";
}

export default function OrgStudioPage() {
  const [nodes, setNodes] = useState<OrgNodeDto[] | null>(null);
  const [people, setPeople] = useState<PersonDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"graph" | "cards">(defaultViewMode);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function reload() {
    api
      .get<OrgNodeDto[]>("/org/nodes?scope=all")
      .then(setNodes)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the org map"));
    api.get<PersonDto[]>("/people").then(setPeople).catch(() => setPeople([]));
  }
  useEffect(reload, []);

  const nodeById = useMemo(() => new Map((nodes ?? []).map((n) => [n.id, n])), [nodes]);
  const selected = selectedId ? (nodeById.get(selectedId) ?? null) : null;

  /** Selecting a different node closes any in-progress invite form or confirmation left
   *  over from the last one — both are keyed to `selected`, and neither should silently
   *  carry over to a node the admin never meant to act on. */
  function selectNode(id: string) {
    setSelectedId(id);
    setShowInviteForm(false);
    setPending(null);
    setActionError(null);
  }

  function cancelPending() {
    setPending(null);
    setActionError(null);
  }

  async function confirmPending() {
    if (!pending || !selected) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (pending.kind === "assignOccupant") {
        await api.post(`/people/${pending.personId}/assign-node`, { nodeId: selected.id, reason: "Assigned via Org Studio" });
      } else if (pending.kind === "vacateOccupant") {
        if (selected.occupant) {
          await api.post(`/people/${selected.occupant.id}/assign-node`, { nodeId: null, reason: "Vacated via Org Studio" });
        }
      } else if (pending.kind === "changeKind") {
        await api.patch(`/org/nodes/${selected.id}`, { kind: pending.newKind });
      } else if (pending.kind === "deactivate") {
        await api.post(`/org/nodes/${selected.id}/deactivate`);
      } else {
        await api.delete(`/org/nodes/${selected.id}`);
        setSelectedId(null);
      }
      setPending(null);
      reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not complete this action");
    } finally {
      setActionBusy(false);
    }
  }

  async function reactivateNode() {
    if (!selected) return;
    try {
      await api.post(`/org/nodes/${selected.id}/reactivate`);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reactivate this node");
    }
  }

  /** Track 2's per-department rollout switch — reversible and purely additive
   *  (it only ever narrows/widens whether THIS department's custodians go through
   *  draft-then-approve; nothing already staged or applied is touched either way),
   *  so it applies immediately with no confirmation, matching this app's own
   *  established rule for that class of action. */
  async function toggleDraftWorkflow(enabled: boolean) {
    if (!selected) return;
    try {
      await api.post(`/org/nodes/${selected.id}/draft-workflow`, { enabled });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the draft workflow setting");
    }
  }

  async function saveParents(parentIds: string[]) {
    if (!selected) return;
    try {
      await api.put(`/org/nodes/${selected.id}/parents`, { parentIds });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reassign this node's parents");
    }
  }

  // Skipped entirely in cards mode — no reason to pay for a dagre layout pass on a phone
  // that's never going to render it.
  const flowNodes: Node<CardData>[] = useMemo(() => {
    if (!nodes || viewMode !== "graph") return [];
    const positions = layoutNodes(nodes);
    return nodes.map((n) => ({
      id: n.id,
      type: "orgNode",
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { node: n, selected: n.id === selectedId },
    }));
  }, [nodes, selectedId, viewMode]);

  const flowEdges: Edge[] = useMemo(() => {
    if (!nodes || viewMode !== "graph") return [];
    return nodes.flatMap((n) =>
      n.parentIds.map((p) => ({
        id: `${p}-${n.id}`,
        source: p,
        target: n.id,
        style: { stroke: "var(--border2)" },
      })),
    );
  }, [nodes, viewMode]);

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel
        title="Org structure"
        actions={
          <Button variant="primary" onClick={() => setShowNewForm((s) => !s)}>
            {showNewForm ? "Cancel" : "+ New node"}
          </Button>
        }
      >
        <div className="px-14 py-10 border-b border-border flex flex-col md:flex-row md:items-center md:justify-between gap-8">
          <div className="text-11 text-dim leading-loose">
            Click any node to inspect it — assign or vacate its occupant, reassign its parent(s), or
            deactivate/delete it. Pick University, College, Department or Office right in the create form below;
            there's no separate page per kind.
          </div>
          <ViewModeTabs value={viewMode} onChange={setViewMode} />
        </div>
        {showNewForm && (
          <NewNodeForm
            nodes={nodes ?? []}
            onDone={() => {
              setShowNewForm(false);
              reload();
            }}
            onError={setError}
          />
        )}

        {/* Below md, the canvas and inspector stack instead of sitting side by side — at
            phone widths a 320px-wide docked panel left almost nothing for the canvas, and
            vice versa. Each gets the full viewport width in turn. */}
        {nodes === null ? (
          <PanelLoading rows={8} />
        ) : (
          <div className="flex flex-col md:flex-row md:h-[560px]">
            <div className="h-[360px] md:h-auto md:flex-1 border-b md:border-b-0 md:border-r border-border overflow-y-auto">
              {viewMode === "graph" ? (
                <ReactFlowProvider>
                  <ReactFlow
                    nodes={flowNodes}
                    edges={flowEdges}
                    nodeTypes={{ orgNode: OrgNodeCard }}
                    onNodeClick={(_e, n) => selectNode(n.id)}
                    fitView
                    nodesConnectable={false}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </ReactFlowProvider>
              ) : (
                <NodeCardList nodes={nodes} selectedId={selectedId} onSelect={selectNode} />
              )}
            </div>

            <div className="w-full md:w-320 md:shrink-0 overflow-y-auto">
              {!selected ? (
                <div className="px-14 py-20 text-11.5 text-faint">Select a node on the map to inspect it.</div>
              ) : (
                <div className="flex flex-col gap-14 px-14 py-14">
                  <NodeHeaderEditor
                    selected={selected}
                    onSaved={reload}
                    onError={setError}
                    onRequestKindChange={(newKind) => setPending({ kind: "changeKind", newKind })}
                  />

                  <div>
                    <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-6">Occupant</div>
                    <EntityPicker
                      options={people
                        .filter((p) => p.status !== "DISABLED")
                        .map((p) => ({ id: p.id, label: p.name, sublabel: p.email }))}
                      value={selected.occupant?.id ?? null}
                      onSelect={(id) =>
                        id
                          ? setPending({ kind: "assignOccupant", personId: id, personName: people.find((p) => p.id === id)?.name ?? "this person" })
                          : setPending({ kind: "vacateOccupant" })
                      }
                      placeholder="Assign an occupant…"
                      clearLabel="Vacate this node"
                    />
                    {!showInviteForm ? (
                      <button
                        type="button"
                        onClick={() => setShowInviteForm(true)}
                        className="mt-6 text-10.5 text-accent"
                      >
                        + Invite someone new and assign them here
                      </button>
                    ) : (
                      <div className="mt-8">
                        <InviteAndAssignForm
                          nodeId={selected.id}
                          onDone={() => {
                            setShowInviteForm(false);
                            reload();
                          }}
                          onCancel={() => setShowInviteForm(false)}
                        />
                      </div>
                    )}
                  </div>

                  {selected.level > 0 && (
                    <ParentsEditor
                      selected={selected}
                      candidates={(nodes ?? []).filter((n) => n.level === selected.level - 1 && n.active)}
                      onSave={saveParents}
                    />
                  )}

                  <div>
                    <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-6">Resource drafts</div>
                    <label className="flex items-center gap-8 text-11.5">
                      <input
                        type="checkbox"
                        checked={selected.draftWorkflowEnabled}
                        onChange={(e) => toggleDraftWorkflow(e.target.checked)}
                      />
                      Custodians here draft changes for head approval before they go visible
                    </label>
                    <p className="mt-4 text-9.5 text-faint">
                      Off by default. A custodian can still edit directly until this is turned on for their unit.
                    </p>
                  </div>

                  <div className="flex items-center gap-8 pt-4 border-t border-border">
                    {selected.active ? (
                      <Button variant="danger" onClick={() => setPending({ kind: "deactivate" })}>
                        Deactivate
                      </Button>
                    ) : (
                      <Button variant="primary" onClick={reactivateNode}>
                        Reactivate
                      </Button>
                    )}
                    <Button variant="danger" onClick={() => setPending({ kind: "delete" })}>
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      {pending && selected && (
        <ConfirmDialog
          title={
            pending.kind === "assignOccupant"
              ? "Assign occupant"
              : pending.kind === "vacateOccupant"
                ? "Vacate node"
                : pending.kind === "changeKind"
                  ? "Change node type"
                  : pending.kind === "deactivate"
                    ? "Deactivate node"
                    : "Delete node"
          }
          message={
            pending.kind === "assignOccupant" ? (
              <>
                Assign <b className="text-text">{pending.personName}</b> as the occupant of{" "}
                <b className="text-text">"{selected.name}"</b>?
                {selected.occupant && (
                  <>
                    {" "}
                    This replaces <b className="text-text">{selected.occupant.name}</b>, who will be vacated.
                  </>
                )}{" "}
                They'll get an email letting them know.
              </>
            ) : pending.kind === "vacateOccupant" ? (
              <>
                Vacate <b className="text-text">"{selected.name}"</b>?{" "}
                <b className="text-text">{selected.occupant?.name}</b> will be revoked and no longer able to act for
                this unit.
              </>
            ) : pending.kind === "changeKind" ? (
              <>
                Change <b className="text-text">"{selected.name}"</b> from a{" "}
                <b className="text-text">{selected.kind.toLowerCase()}</b> to a{" "}
                <b className="text-text">{pending.newKind.toLowerCase()}</b>? This changes how it's labeled and
                treated throughout the org structure — its parent/child links and occupant are unaffected.
              </>
            ) : pending.kind === "deactivate" ? (
              <>
                Deactivate <b className="text-text">"{selected.name}"</b>? Its occupant, if any, will be vacated from
                this post — their account itself is unaffected. You can reactivate it again later.
              </>
            ) : (
              <>
                Delete <b className="text-text">"{selected.name}"</b>? This cannot be undone.
              </>
            )
          }
          confirmLabel={
            pending.kind === "assignOccupant"
              ? "Assign"
              : pending.kind === "vacateOccupant"
                ? "Vacate"
                : pending.kind === "changeKind"
                  ? "Change type"
                  : pending.kind === "deactivate"
                    ? "Deactivate"
                    : "Delete"
          }
          tone={
            pending.kind === "assignOccupant"
              ? "primary"
              : pending.kind === "vacateOccupant"
                ? "warn"
                : pending.kind === "changeKind"
                  ? "warn"
                  : "danger"
          }
          busy={actionBusy}
          error={actionError}
          onConfirm={confirmPending}
          onCancel={cancelPending}
        />
      )}
    </Screen>
  );
}

/**
 * A node's parent(s) must sit exactly one level above it — org.service.ts's
 * assertAdjacentParents enforces this server-side, but filtering the candidate list to
 * `level - 1` up front means the admin can never even SELECT an invalid combination.
 */
function ParentsEditor({
  selected,
  candidates,
  onSave,
}: {
  selected: OrgNodeDto;
  candidates: OrgNodeDto[];
  onSave: (parentIds: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected.parentIds);
  const dirty = JSON.stringify([...draft].sort()) !== JSON.stringify([...selected.parentIds].sort());

  useEffect(() => setDraft(selected.parentIds), [selected.id]);

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  return (
    <div>
      <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-6">
        Parent(s) — level {selected.level - 1}
      </div>
      {candidates.length === 0 ? (
        <div className="text-10.5 text-faint">No active nodes exist at level {selected.level - 1} yet.</div>
      ) : (
        <div className="flex flex-wrap gap-6">
          {candidates.map((n) => (
            <label key={n.id} className="flex items-center gap-5 text-10.5 text-dim border border-border2 rounded-2 px-8 py-4">
              <input type="checkbox" checked={draft.includes(n.id)} onChange={() => toggle(n.id)} />
              {n.name}
            </label>
          ))}
        </div>
      )}
      {dirty && (
        <div className="mt-8">
          <Button variant="primary" disabled={draft.length === 0} onClick={() => onSave(draft)}>
            Save parents
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Name and kind, edited right where they're displayed — the same "click it, change it,
 * it saves" directness as the Occupant picker just above it in the detail panel. Name
 * gets an explicit Save so a half-typed rename can't fire on every keystroke. Kind does
 * NOT save on selection — it routes through the same ConfirmDialog as occupant/
 * deactivate/delete, since it changes how the node is labeled and treated across the
 * whole org structure and a stray dropdown click shouldn't silently change that.
 */
function NodeHeaderEditor({
  selected,
  onSaved,
  onError,
  onRequestKindChange,
}: {
  selected: OrgNodeDto;
  onSaved: () => void;
  onError: (m: string) => void;
  onRequestKindChange: (kind: OrgNodeKind) => void;
}) {
  const [name, setName] = useState(selected.name);
  const [nameSaving, setNameSaving] = useState(false);
  const nameDirty = name.trim() !== selected.name && name.trim().length > 0;

  useEffect(() => setName(selected.name), [selected.id]);

  async function saveName() {
    setNameSaving(true);
    try {
      await api.patch(`/org/nodes/${selected.id}`, { name: name.trim() });
      onSaved();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not rename this node");
    } finally {
      setNameSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-8">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 border border-border2 bg-panel h-27 px-8 rounded-3 text-13 font-medium outline-none focus:border-accent"
        />
        {nameDirty && (
          <Button variant="primary" onClick={saveName} disabled={nameSaving}>
            {nameSaving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>

      <div className="mt-6 flex items-center gap-6 flex-wrap">
        <select
          value={selected.kind}
          onChange={(e) => onRequestKindChange(e.target.value as OrgNodeKind)}
          className="border border-border2 bg-panel h-22 px-6 rounded-2 text-10.5 outline-none focus:border-accent"
        >
          {KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {k.charAt(0) + k.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <Tag>level {selected.level}</Tag>
        <Tag tone={selected.active ? "good" : "bad"}>{selected.active ? "active" : "inactive"}</Tag>
      </div>
    </div>
  );
}

/** A node's occupant is its head/administrator, so the only roles worth offering here are
 *  the headship ones — MANAGER for a college/department, PROPERTY_ADMIN/PROCUREMENT for
 *  the two university-wide offices. SYS_ADMIN deliberately occupies no node (see
 *  auth.controller.ts's workspacesFor), so it isn't offered. */
const OCCUPANT_ROLE_OPTIONS: RoleKind[] = ["MANAGER", "PROPERTY_ADMIN", "PROCUREMENT"];

/**
 * Invites a brand-new person and assigns them as this node's occupant in one step —
 * people.service.ts's create() already does both atomically when given a nodeId, and
 * already sends the invitation email (mentioning the assignment). No separate
 * confirmation dialog: filling out and submitting this form is already the deliberate
 * action, the same way creating a node isn't double-confirmed either.
 */
function InviteAndAssignForm({
  nodeId,
  onDone,
  onCancel,
}: {
  nodeId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<RoleKind[]>(["MANAGER"]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleRole(r: RoleKind) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function submit() {
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required");
      return;
    }
    if (roles.length === 0) {
      setError("Pick at least one role");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/people", { name: name.trim(), email: email.trim(), roles, nodeId });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not invite this person");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-border2 rounded-3 p-10 bg-panel2 flex flex-col gap-9">
      <label className="block">
        <div className="text-10.5 text-dim mb-3">Name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="w-full border border-border2 bg-panel h-24 px-7 rounded-2 text-11 outline-none focus:border-accent"
        />
      </label>
      <label className="block">
        <div className="text-10.5 text-dim mb-3">Email</div>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-border2 bg-panel h-24 px-7 rounded-2 text-11 outline-none focus:border-accent"
        />
      </label>
      <div>
        <div className="text-10.5 text-dim mb-3">Role</div>
        <div className="flex gap-6 flex-wrap">
          {OCCUPANT_ROLE_OPTIONS.map((r) => {
            const on = roles.includes(r);
            return (
              <button
                type="button"
                key={r}
                onClick={() => toggleRole(r)}
                style={{
                  borderColor: on ? "var(--accent)" : "var(--border2)",
                  background: on ? "var(--soft)" : "var(--panel)",
                  color: on ? "var(--accent)" : "var(--dim)",
                }}
                className="border h-22 px-8 rounded-2 text-10.5"
              >
                {r.toLowerCase().replace("_", " ")}
              </button>
            );
          })}
        </div>
      </div>
      {error && <div className="text-11 text-bad">{error}</div>}
      <div className="flex items-center gap-8">
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Inviting…" : "Invite & assign"}
        </Button>
        <button type="button" onClick={onCancel} className="text-11 text-dim">
          Cancel
        </button>
      </div>
    </div>
  );
}

function NewNodeForm({
  nodes,
  onDone,
  onError,
}: {
  nodes: OrgNodeDto[];
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const maxLevel = nodes.length ? Math.max(...nodes.map((n) => n.level)) : -1;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrgNodeKind>(maxLevel < 0 ? "UNIVERSITY" : "DEPARTMENT");
  const [level, setLevel] = useState(Math.max(maxLevel + 1, 0));
  const [parentIds, setParentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const parentCandidates = nodes.filter((n) => n.level === level - 1 && n.active);

  function toggleParent(id: string) {
    setParentIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function changeLevel(next: number) {
    setLevel(next);
    setParentIds([]); // the old selection almost certainly isn't at the new level - 1
  }

  async function submit() {
    if (!name.trim()) {
      onError("Name is required");
      return;
    }
    if (level > 0 && parentIds.length === 0) {
      onError("Pick at least one parent — only a level 0 node has none");
      return;
    }
    setBusy(true);
    try {
      await api.post("/org/nodes", { name: name.trim(), level, kind, parentIds: level === 0 ? [] : parentIds });
      onDone();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not create this node");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-14 py-12 border-b border-border flex flex-col gap-10 bg-panel2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
        <label className="block">
          <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "College of Engineering"'
            className="mt-4 w-full bg-panel border border-border2 rounded-2 h-26 px-8 text-11.5 outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Level</span>
          <input
            type="number"
            min={0}
            value={level}
            onChange={(e) => changeLevel(Math.max(0, Number(e.target.value)))}
            className="mt-4 w-full bg-panel border border-border2 rounded-2 h-26 px-8 text-11.5 outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as OrgNodeKind)}
            className="mt-4 w-full bg-panel border border-border2 rounded-2 h-26 px-6 text-11.5 outline-none focus:border-accent"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k.charAt(0) + k.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      {level === 0 ? (
        <div className="text-10.5 text-faint">Level 0 is the university root — it has no parent.</div>
      ) : (
        <div>
          <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Parent(s) — level {level - 1}</span>
          <div className="mt-6 flex flex-wrap gap-8 max-h-[140px] overflow-y-auto">
            {parentCandidates.length === 0 ? (
              <span className="text-10.5 text-faint">No active nodes exist at level {level - 1} yet.</span>
            ) : (
              parentCandidates.map((n) => (
                <label key={n.id} className="flex items-center gap-5 text-11 text-dim border border-border2 rounded-2 px-8 py-4">
                  <input type="checkbox" checked={parentIds.includes(n.id)} onChange={() => toggleParent(n.id)} />
                  {n.name}
                </label>
              ))
            )}
          </div>
        </div>
      )}
      <div>
        <Button variant="primary" disabled={busy} onClick={submit}>
          {busy ? "Creating…" : "Create node"}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { roleKinds, type AccessViewDto, type OrgNodeDto, type PersonDto, type RoleKind, type ScopeMode, type UpsertAccessViewInput, type ViewAudienceDto } from "@/lib/shared";
import { SCOPE_LABEL, SCOPE_HELP } from "@/lib/domain/views";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, Table, Tag, Button, Modal, ErrorNote, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";

const SCOPE_MODES: ScopeMode[] = ["UNIVERSITY", "ORG_SUBTREE", "MY_CUSTODY", "EXPLICIT_NODES"];

function audienceLabel(a: ViewAudienceDto): string {
  if (a.type === "EVERYONE") return "Everyone";
  if (a.type === "ROLE") return a.role;
  return a.personName || a.personId;
}

function audiencesSummary(audiences: ViewAudienceDto[]): string {
  if (!audiences.length) return "Nobody";
  return audiences.map(audienceLabel).join(", ");
}

type DraftAudience = { key: string; type: "EVERYONE" | "ROLE" | "PERSON"; role?: RoleKind; personId?: string; personName?: string };

function emptyDraft(): {
  id?: string;
  name: string;
  description: string;
  scope: ScopeMode;
  explicitNodeIds: string[];
  audiences: DraftAudience[];
  canEdit: boolean;
  active: boolean;
} {
  return { name: "", description: "", scope: "ORG_SUBTREE", explicitNodeIds: [], audiences: [], canEdit: true, active: true };
}

/**
 * Admin authoring for access views — Direction.md's first headline ask: "admin can
 * create views; and then he can give personnel types specific views" so a custodian
 * is filtered to their own custody, a department head to their subtree, an office to
 * everything or a deliberate slice of it. Authored the way a category is: named,
 * saved, assigned to an audience.
 *
 * Deliberately does NOT author a saved filter (`AccessView.extraFilters`) yet — the
 * four `ScopeMode`s plus an explicit node list already cover Direction.md's stated
 * cases; a saved-query authoring surface reusing the register's own `FilterBar` is a
 * self-contained follow-up, not a capability gap (the server and wire contract
 * already carry the field — see views.ts's own header).
 */
export default function AccessViewsPage() {
  const [views, setViews] = useState<AccessViewDto[] | null>(null);
  const [nodes, setNodes] = useState<OrgNodeDto[]>([]);
  const [people, setPeople] = useState<PersonDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReturnType<typeof emptyDraft> | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    setError(null);
    api
      .get<AccessViewDto[]>("/resources/access-views")
      .then(setViews)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load access views"));
  }

  useEffect(() => {
    load();
    api.get<OrgNodeDto[]>("/org/nodes").then(setNodes).catch(() => setNodes([]));
    api.get<PersonDto[]>("/people").then(setPeople).catch(() => setPeople([]));
  }, []);

  function openNew() {
    setEditing(emptyDraft());
  }

  function openEdit(v: AccessViewDto) {
    setEditing({
      id: v.id,
      name: v.name,
      description: v.description ?? "",
      scope: v.scope,
      explicitNodeIds: v.explicitNodeIds,
      audiences: v.audiences.map((a, i) => ({
        key: `${i}`,
        type: a.type,
        role: a.type === "ROLE" ? a.role : undefined,
        personId: a.type === "PERSON" ? a.personId : undefined,
        personName: a.type === "PERSON" ? a.personName : undefined,
      })),
      canEdit: v.canEdit,
      active: v.active,
    });
  }

  async function save() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setError("A view needs a name.");
      return;
    }
    if (!editing.audiences.length) {
      setError("A view needs at least one audience — who is it for?");
      return;
    }
    const audiences: UpsertAccessViewInput["audiences"] = editing.audiences.map((a) =>
      a.type === "ROLE" ? { type: "ROLE", role: a.role as RoleKind } : a.type === "PERSON" ? { type: "PERSON", personId: a.personId as string } : { type: "EVERYONE" },
    );
    const body: UpsertAccessViewInput = {
      id: editing.id,
      name,
      description: editing.description.trim() || undefined,
      scope: editing.scope,
      explicitNodeIds: editing.scope === "EXPLICIT_NODES" ? editing.explicitNodeIds : [],
      audiences,
      canEdit: editing.canEdit,
      active: editing.active,
    };
    setBusy(true);
    setError(null);
    try {
      if (editing.id) await api.patch(`/resources/access-views/${editing.id}`, body);
      else await api.post("/resources/access-views", body);
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save this view");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!confirmDeleteId) return;
    setBusy(true);
    try {
      await api.delete(`/resources/access-views/${confirmDeleteId}`);
      setConfirmDeleteId(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete this view");
    } finally {
      setBusy(false);
    }
  }

  function addAudience(type: DraftAudience["type"]) {
    if (!editing) return;
    const key = `${Date.now()}`;
    const defaults: DraftAudience = type === "ROLE" ? { key, type, role: roleKinds[0] } : type === "PERSON" ? { key, type, personId: people[0]?.id, personName: people[0]?.name } : { key, type };
    setEditing({ ...editing, audiences: [...editing.audiences, defaults] });
  }

  function removeAudience(key: string) {
    if (!editing) return;
    setEditing({ ...editing, audiences: editing.audiences.filter((a) => a.key !== key) });
  }

  function updateAudience(key: string, patch: Partial<DraftAudience>) {
    if (!editing) return;
    setEditing({ ...editing, audiences: editing.audiences.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  }

  const viewToDelete = views?.find((v) => v.id === confirmDeleteId) ?? null;

  return (
    <Screen>
      {error && !editing && <ErrorNote>{error}</ErrorNote>}
      <Panel title="Access views" actions={<Button variant="primary" onClick={openNew}>+ Add view</Button>}>
        {views === null ? (
          <PanelLoading rows={4} />
        ) : (
          <Table
            columns={[
              { header: "Name", cell: (v: AccessViewDto) => <span className="font-medium">{v.name}</span> },
              { header: "Scope", cell: (v: AccessViewDto) => SCOPE_LABEL[v.scope] },
              { header: "Assigned to", cell: (v: AccessViewDto) => audiencesSummary(v.audiences) },
              { header: "Edit", cell: (v: AccessViewDto) => <Tag tone={v.canEdit ? "good" : "neutral"}>{v.canEdit ? "can edit" : "read only"}</Tag> },
              { header: "Active", cell: (v: AccessViewDto) => <Tag tone={v.active ? "good" : "bad"}>{v.active ? "active" : "inactive"}</Tag> },
              {
                header: "",
                cell: (v: AccessViewDto) => (
                  <div className="flex items-center gap-8 justify-end">
                    <button className="text-10.5 text-accent" onClick={() => openEdit(v)}>
                      Edit
                    </button>
                    <button className="text-10.5 text-bad" onClick={() => setConfirmDeleteId(v.id)}>
                      Delete
                    </button>
                  </div>
                ),
              },
            ]}
            rows={views}
            rowKey={(v) => v.id}
            empty={<div className="px-14 py-14 text-11.5 text-dim">No access views yet — everyone sees their own default scope.</div>}
          />
        )}
      </Panel>

      {editing && (
        <Modal title={editing.id ? "Edit access view" : "Add access view"} onClose={() => setEditing(null)} width="620px">
          {error && <ErrorNote>{error}</ErrorNote>}

          <label className="block">
            <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Name</span>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="w-full mt-4 h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Description (optional)</span>
            <input
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              className="w-full mt-4 h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Which resources</span>
            <select
              value={editing.scope}
              onChange={(e) => setEditing({ ...editing, scope: e.target.value as ScopeMode })}
              className="w-full mt-4 h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
            >
              {SCOPE_MODES.map((m) => (
                <option key={m} value={m}>
                  {SCOPE_LABEL[m]}
                </option>
              ))}
            </select>
            <span className="block mt-4 text-10.5 text-dim">{SCOPE_HELP[editing.scope]}</span>
          </label>

          {editing.scope === "EXPLICIT_NODES" && (
            <div>
              <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Units</span>
              <div className="mt-6 max-h-[180px] overflow-y-auto border border-border2 rounded-2 p-8 flex flex-col gap-4">
                {nodes
                  .filter((n) => n.active)
                  .map((n) => (
                    <label key={n.id} className="flex items-center gap-8 text-11">
                      <input
                        type="checkbox"
                        checked={editing.explicitNodeIds.includes(n.id)}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            explicitNodeIds: e.target.checked ? [...editing.explicitNodeIds, n.id] : editing.explicitNodeIds.filter((id) => id !== n.id),
                          })
                        }
                      />
                      {n.name}
                    </label>
                  ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Assigned to</span>
              <div className="flex items-center gap-6">
                <button className="text-10 text-accent" onClick={() => addAudience("EVERYONE")}>
                  + Everyone
                </button>
                <button className="text-10 text-accent" onClick={() => addAudience("ROLE")}>
                  + Role
                </button>
                <button className="text-10 text-accent" onClick={() => addAudience("PERSON")}>
                  + Person
                </button>
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-6">
              {editing.audiences.length === 0 && <span className="text-10.5 text-dim">No audience yet — this view will not be offered to anyone.</span>}
              {editing.audiences.map((a) => (
                <div key={a.key} className="flex items-center gap-8">
                  {a.type === "EVERYONE" && <span className="text-11">Everyone signed in</span>}
                  {a.type === "ROLE" && (
                    <select
                      value={a.role}
                      onChange={(e) => updateAudience(a.key, { role: e.target.value as RoleKind })}
                      className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
                    >
                      {roleKinds.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  )}
                  {a.type === "PERSON" && (
                    <select
                      value={a.personId}
                      onChange={(e) => updateAudience(a.key, { personId: e.target.value, personName: people.find((p) => p.id === e.target.value)?.name })}
                      className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
                    >
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button className="text-10.5 text-bad" onClick={() => removeAudience(a.key)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-16">
            <label className="flex items-center gap-8 text-11">
              <input type="checkbox" checked={editing.canEdit} onChange={(e) => setEditing({ ...editing, canEdit: e.target.checked })} />
              Can edit (unchecked = look but do not touch)
            </label>
            <label className="flex items-center gap-8 text-11">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Active
            </label>
          </div>

          <div className="flex items-center gap-8">
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete access view"
          message={`Delete "${viewToDelete?.name ?? "this view"}"? Anyone currently assigned to it falls back to their next-best view, or their own default scope if none remain.`}
          confirmLabel="Delete"
          busy={busy}
          error={null}
          onConfirm={doDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </Screen>
  );
}

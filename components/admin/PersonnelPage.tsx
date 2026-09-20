"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { SortingState } from "@tanstack/react-table";
import type { OrgNodeDto, PersonDto, RoleKind } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PeopleTable } from "@/components/people/PeopleTable";
import { Panel, Screen, Tag, Button, ErrorNote, Modal } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { EntityPicker } from "@/components/EntityPicker";

/**
 * The personnel register that /register/people promised since Phase 0 and never had. One
 * component serves both SYS_ADMIN (full register, every action) and a department head
 * (their own department's people, invite-only) — the backend (people.service.ts) already
 * enforces the narrower rule for a MANAGER, so this just hides what a head could not do
 * anyway rather than duplicating that logic client-side.
 */
// Defined locally rather than imported as a value from lib/shared's `roleKinds` — this
// file only imports TYPES from lib/shared (see lib/shared's own module-boundary
// discipline), so the runtime array is restated here.
const ALL_ROLE_KINDS: RoleKind[] = [
  "SYS_ADMIN",
  "PROPERTY_ADMIN",
  "PROCUREMENT",
  "MANAGER",
  "CUSTODIAN",
  "STAFF",
  "STUDENT",
  "STORE_KEEPER",
  "EXTERNAL",
];
const MANAGER_INVITABLE: RoleKind[] = ["CUSTODIAN", "STAFF"];

export default function PersonnelPage() {
  const { user, me } = useAuth();
  const isAdmin = (user?.roles ?? []).includes("SYS_ADMIN");
  // Occupancy, not the MANAGER role (F-017 of the 2026-09-15 campaign) — a head who
  // occupies a node manages their own staff (F-014) even without that role label.
  const isHead = Boolean(me?.scope?.isOccupant);
  const canManageStaff = isAdmin || isHead;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [people, setPeople] = useState<PersonDto[] | null>(null);
  const [nodes, setNodes] = useState<OrgNodeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  /** Surfaced once after an invite is sent or resent — see InviteLinkModal's own
   *  header for why: SMTP failing from a serverless host must not be the only way to
   *  onboard someone. */
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // URL-persisted so a reload (or a shared link) reproduces the same search — the one
  // piece of filter state worth surviving a reload here; role/status stay local, this
  // register is small enough that losing them on reload costs nothing.
  const search = searchParams.get("people_q") ?? "";
  const setSearch = (q: string) => {
    const qp = new URLSearchParams(searchParams);
    if (q) qp.set("people_q", q);
    else qp.delete("people_q");
    router.replace(`${pathname}?${qp.toString()}`);
  };

  const filteredPeople = useMemo(() => {
    if (!people) return null;
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.email.toLowerCase().includes(q)) return false;
      if (roleFilter && !p.roles.includes(roleFilter as RoleKind)) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      return true;
    });
  }, [people, search, roleFilter, statusFilter]);

  function reload() {
    setError(null);
    api
      .get<PersonDto[]>("/people")
      .then(setPeople)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load personnel"));
  }
  useEffect(reload, []);
  useEffect(() => {
    if (isAdmin || isHead) api.get<OrgNodeDto[]>("/org/nodes").then(setNodes).catch(() => setNodes([]));
  }, [isAdmin, isHead]);

  /** F-018: the units a head may add people into — the nodes they occupy plus everything beneath them
   *  (the same subtree the server checks, `scope.visibleNodeIds`). Admins pick from the whole chart. */
  const inviteNodes = useMemo(() => {
    if (isAdmin) return nodes;
    const reach = new Set(nodes.filter((n) => n.active && n.occupant?.id === user?.id).map((n) => n.id));
    for (let grew = true; grew; ) {
      grew = false;
      for (const n of nodes) {
        if (!n.active || reach.has(n.id)) continue;
        if (n.parentIds.some((p) => reach.has(p))) {
          reach.add(n.id);
          grew = true;
        }
      }
    }
    return nodes.filter((n) => n.active && reach.has(n.id));
  }, [nodes, isAdmin, user?.id]);

  async function deactivate(p: PersonDto) {
    if (!confirm(`Deactivate ${p.name}? They will no longer be able to sign in.`)) return;
    try {
      const res = await api.post<{ vacatedNodeName: string | null }>(`/people/${p.id}/deactivate`);
      if (res.vacatedNodeName) alert(`${p.name} occupied "${res.vacatedNodeName}" — that node is now unassigned.`);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not deactivate this person");
    }
  }

  async function reactivate(p: PersonDto) {
    try {
      await api.post(`/people/${p.id}/reactivate`);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reactivate this person");
    }
  }

  async function resendInvite(p: PersonDto) {
    try {
      const result = await api.post<{ inviteUrl: string }>(`/people/${p.id}/resend-invite`);
      setInviteLink(result.inviteUrl);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resend the invitation");
    }
  }

  async function assignNode(personId: string, nodeId: string | null) {
    try {
      await api.post(`/people/${personId}/assign-node`, { nodeId, reason: "Reassigned via admin console" });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not assign this node");
    }
  }

  async function moveHomeNode(personId: string, nodeId: string | null) {
    try {
      await api.post(`/people/${personId}/home-node`, { nodeId, reason: "Moved via admin console" });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not move this person's department");
    }
  }

  async function updateRoles(personId: string, roles: RoleKind[]) {
    try {
      await api.post(`/people/${personId}/roles`, { roles });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update this person's roles");
    }
  }

  const managing = people?.find((p) => p.id === manageId) ?? null;

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel
        title={isAdmin ? "Personnel register" : "Your department's people"}
        actions={<Button variant="primary" onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "Add personnel"}</Button>}
      >
        {showForm && (
          <PersonForm
            isAdmin={isAdmin}
            nodes={inviteNodes}
            onDone={(inviteUrl) => {
              setShowForm(false);
              setInviteLink(inviteUrl);
              reload();
            }}
            onError={setError}
          />
        )}
        {people === null ? (
          <PanelLoading rows={5} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-8 px-14 py-9 border-b border-border bg-panel2">
              <input
                placeholder="Search name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent w-[220px]"
              />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 text-dim outline-none focus:border-accent"
              >
                <option value="">Role: any</option>
                {ALL_ROLE_KINDS.map((r) => (
                  <option key={r} value={r}>
                    {r.toLowerCase().replace("_", " ")}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 text-dim outline-none focus:border-accent"
              >
                <option value="">Status: any</option>
                <option value="ACTIVE">active</option>
                <option value="INVITED">invited</option>
                <option value="DISABLED">disabled</option>
              </select>
              {(search || roleFilter || statusFilter) && (
                <button
                  onClick={() => {
                    setSearch("");
                    setRoleFilter("");
                    setStatusFilter("");
                  }}
                  className="text-10.5 text-accent ml-auto"
                >
                  Clear filters
                </button>
              )}
            </div>
            <PeopleTable
              rows={filteredPeople ?? []}
              sorting={sorting}
              onSortingChange={setSorting}
              isAdmin={isAdmin}
              canManage={canManageStaff}
              onManage={(p) => setManageId(p.id)}
              onResendInvite={resendInvite}
            />
          </>
        )}
      </Panel>

      {managing && (
        <PersonManageModal
          person={managing}
          nodes={nodes}
          isAdmin={isAdmin}
          isSelf={managing.id === user?.id}
          onClose={() => setManageId(null)}
          onSaveRoles={(roles) => updateRoles(managing.id, roles)}
          onAssignNode={(nodeId) => assignNode(managing.id, nodeId)}
          onMoveHomeNode={(nodeId) => moveHomeNode(managing.id, nodeId)}
          onDeactivate={() => deactivate(managing)}
          onReactivate={() => reactivate(managing)}
          onError={setError}
        />
      )}

      {inviteLink && <InviteLinkModal url={inviteLink} onClose={() => setInviteLink(null)} />}
    </Screen>
  );
}

/**
 * Shown once right after an invite is sent or resent. The email already went out (best
 * effort — mail.send never throws, see lib/server/mail/mail.ts), but Gmail SMTP from a
 * serverless host is not something to bet onboarding on, so the same link the email
 * carries is put here to copy and send over any other channel. Nothing sensitive beyond
 * the invitation itself: possessing this link only lets someone set a password for the
 * exact account it was minted for, same as clicking it from the email would.
 */
function InviteLinkModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the link is still
      // selectable text in the input below, so this is a convenience, not the only path.
    }
  }

  return (
    <Modal title="Invitation link" onClose={onClose} width="480px">
      <p className="text-11 text-dim">
        The invitation email was sent. If it does not arrive, copy this link and send it to them directly — it works exactly the same way.
      </p>
      <div className="flex items-center gap-6">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="flex-1 h-26 px-8 rounded-2 border border-border2 bg-panel text-10.5 font-mono outline-none"
        />
        <Button variant="primary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * A toggleable pill, standing in for a bare `<input type=checkbox>` — a checked state you
 * can see across a room (filled, a check mark) and a target big enough to hit without
 * lining up a cursor on an 11px box. Used everywhere a set of roles is picked, here and in
 * PersonForm below.
 */
function RoleChip({
  role,
  active,
  disabled,
  onToggle,
}: {
  role: RoleKind;
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      title={disabled ? "You cannot remove your own admin access" : undefined}
      className={`inline-flex items-center gap-6 border rounded-2 pl-6 pr-10 py-5 text-10.5 font-mono transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? "bg-accent border-accent text-white" : "bg-panel2 border-border2 text-dim hover:border-accent"
      }`}
    >
      <span
        className={`w-13 h-13 rounded-1 border flex items-center justify-center shrink-0 ${
          active ? "bg-white border-white" : "border-border2"
        }`}
      >
        {active && <span className="text-accent text-9.5 leading-none">✓</span>}
      </span>
      {role.toLowerCase().replace("_", " ")}
    </button>
  );
}

/**
 * Everything an admin can change about one person, in one place — assign-node, roles and
 * deactivate/reactivate used to be three separate row actions (one of them a prompt()
 * dialog); consolidated per the user's own request. `managing` in the parent is derived
 * live from the `people` list, so every action here just calls its handler and lets the
 * subsequent reload() flow back in — no manual close-and-reopen needed to see the result.
 */
function PersonManageModal({
  person,
  nodes,
  isAdmin,
  isSelf,
  onClose,
  onSaveRoles,
  onAssignNode,
  onMoveHomeNode,
  onDeactivate,
  onReactivate,
  onError,
}: {
  person: PersonDto;
  nodes: OrgNodeDto[];
  isAdmin: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSaveRoles: (roles: RoleKind[]) => void;
  onAssignNode: (nodeId: string | null) => void;
  onMoveHomeNode: (nodeId: string | null) => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onError: (m: string) => void;
}) {
  const [roleDraft, setRoleDraft] = useState<RoleKind[]>(person.roles);
  const rolesDirty = JSON.stringify([...roleDraft].sort()) !== JSON.stringify([...person.roles].sort());
  // A head sees and may only ever set CUSTODIAN/STAFF — the server enforces the
  // identical floor (F-014 of the 2026-09-15 campaign); this just keeps the UI from
  // offering a control that would only 403.
  const editableRoles = isAdmin ? ALL_ROLE_KINDS : MANAGER_INVITABLE;

  function toggleRole(r: RoleKind) {
    if (isSelf && r === "SYS_ADMIN") return;
    setRoleDraft((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  return (
    <Modal title={`Manage · ${person.name}`} onClose={onClose}>
      <div>
        <div className="text-11.5 font-medium">{person.name}</div>
        <div className="text-10.5 font-mono text-faint">{person.email}</div>
        <div className="mt-6">
          <Tag tone={person.status === "ACTIVE" ? "good" : person.status === "INVITED" ? "warn" : "bad"}>
            {person.status.toLowerCase()}
          </Tag>
        </div>
      </div>

      <div>
        <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-8">Roles</div>
        <div className="flex flex-wrap gap-8">
          {editableRoles.map((r) => (
            <RoleChip
              key={r}
              role={r}
              active={roleDraft.includes(r)}
              disabled={isSelf && r === "SYS_ADMIN"}
              onToggle={() => toggleRole(r)}
            />
          ))}
        </div>
        <div className="mt-10">
          <Button
            variant="primary"
            disabled={!rolesDirty || roleDraft.length === 0}
            onClick={() => onSaveRoles(roleDraft)}
          >
            Save roles
          </Button>
        </div>
      </div>

      {/* Node occupancy stays an admin-only act (F-014's own scoping note) — a head
          manages their staff's roles and standing, never who holds a post. */}
      {isAdmin && (
        <div>
          <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-8">Occupies node</div>
          <div className="mb-8 text-11 text-dim">
            {person.occupiesNodeName ? <span className="text-text">{person.occupiesNodeName}</span> : <span className="text-faint">headless — occupies nothing</span>}
          </div>
          <EntityPicker
            options={nodes.filter((n) => n.active).map((n) => ({ id: n.id, label: n.name, sublabel: n.kind }))}
            value={person.occupiesNodeId}
            onSelect={(nodeId) => onAssignNode(nodeId)}
            placeholder="Assign a node…"
            clearLabel="Vacate this person's node"
          />
        </div>
      )}

      {/* F-015 of the 2026-09-15 campaign — moving a person's home DEPARTMENT
          (membership), distinct from occupancy above. There was previously no way
          to do this at all short of a direct DB edit. Refused server-side while
          they hold custody, an open need or an open staged draft. */}
      {isAdmin && (
        <div>
          <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-8">Home department</div>
          <div className="mb-8 text-11 text-dim">
            {person.homeNodeName ? <span className="text-text">{person.homeNodeName}</span> : <span className="text-faint">none</span>}
          </div>
          <EntityPicker
            options={nodes.filter((n) => n.active).map((n) => ({ id: n.id, label: n.name, sublabel: n.kind }))}
            value={person.homeNodeId}
            onSelect={(nodeId) => onMoveHomeNode(nodeId)}
            placeholder="Move to a department…"
            clearLabel="Clear this person's home department"
          />
        </div>
      )}

      <div className="pt-4 border-t border-border">
        {person.status === "DISABLED" ? (
          <Button variant="primary" onClick={onReactivate}>
            Reactivate
          </Button>
        ) : (
          <Button
            variant="danger"
            onClick={() => {
              if (isSelf) {
                onError("You cannot deactivate your own account");
                return;
              }
              onDeactivate();
            }}
          >
            Deactivate
          </Button>
        )}
      </div>
    </Modal>
  );
}

function PersonForm({
  isAdmin,
  nodes,
  onDone,
  onError,
}: {
  isAdmin: boolean;
  nodes: OrgNodeDto[];
  onDone: (inviteUrl: string) => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roles, setRoles] = useState<RoleKind[]>(isAdmin ? [] : ["CUSTODIAN"]);
  const [homeNodeId, setHomeNodeId] = useState("");
  const [busy, setBusy] = useState(false);

  const selectableRoles = isAdmin ? ALL_ROLE_KINDS : MANAGER_INVITABLE;

  function toggleRole(r: RoleKind) {
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function submit() {
    if (!name.trim() || !email.trim() || roles.length === 0) {
      onError("Name, email and at least one role are required");
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ inviteUrl: string }>("/people", {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        roles,
        homeNodeId: homeNodeId || undefined,
      });
      onDone(result.inviteUrl);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not add this person");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-14 py-12 border-b border-border flex flex-col gap-10 bg-panel2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <label className="block">
          <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-4 w-full bg-panel border border-border2 rounded-2 h-26 px-8 text-11.5 outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-4 w-full bg-panel border border-border2 rounded-2 h-26 px-8 text-11.5 outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Phone (optional)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-4 w-full bg-panel border border-border2 rounded-2 h-26 px-8 text-11.5 outline-none focus:border-accent" />
        </label>
        {(isAdmin || nodes.length > 1) && (
          <label className="block">
            <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Home department{isAdmin ? " (optional)" : ""}</span>
            <select value={homeNodeId} onChange={(e) => setHomeNodeId(e.target.value)} className="mt-4 w-full bg-panel border border-border2 rounded-2 h-26 px-6 text-11.5 outline-none focus:border-accent">
              <option value="">—</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.kind})
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div>
        <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Roles</span>
        <div className="flex flex-wrap gap-8 mt-6">
          {selectableRoles.map((r) => (
            <RoleChip key={r} role={r} active={roles.includes(r)} onToggle={() => toggleRole(r)} />
          ))}
        </div>
      </div>
      <div>
        <Button variant="primary" disabled={busy} onClick={submit}>
          {busy ? "Sending invitation…" : "Send invitation"}
        </Button>
        <span className="ml-10 text-10 text-faint">An email with a registration link goes out immediately.</span>
      </div>
    </div>
  );
}

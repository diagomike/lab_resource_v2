"use client";

import { useEffect, useState } from "react";
import type { OrgNodeDto, PersonDto, RoleKind } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { DataTable, type DataTableColumn } from "@/components/data-table";
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
  const { user } = useAuth();
  const isAdmin = (user?.roles ?? []).includes("SYS_ADMIN");

  const [people, setPeople] = useState<PersonDto[] | null>(null);
  const [nodes, setNodes] = useState<OrgNodeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);

  function reload() {
    setError(null);
    api
      .get<PersonDto[]>("/people")
      .then(setPeople)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load personnel"));
  }
  useEffect(reload, []);
  useEffect(() => {
    if (isAdmin) api.get<OrgNodeDto[]>("/org/nodes").then(setNodes).catch(() => setNodes([]));
  }, [isAdmin]);

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
      await api.post(`/people/${p.id}/resend-invite`);
      alert(`A fresh invitation link was sent to ${p.email}.`);
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

  async function updateRoles(personId: string, roles: RoleKind[]) {
    try {
      await api.post(`/people/${personId}/roles`, { roles });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update this person's roles");
    }
  }

  const columns: DataTableColumn<PersonDto>[] = [
    { id: "name", header: "Name", value: (p) => p.name, cell: (p) => <span className="font-medium">{p.name}</span>, sortable: true, variant: "text" },
    { id: "email", header: "Email", value: (p) => p.email, cell: (p) => <span className="font-mono text-10.5">{p.email}</span>, sortable: true, variant: "text" },
    {
      id: "roles",
      header: "Roles",
      // A person holds several roles at once, so the raw value is the whole set — the
      // faceted filter matches a row holding ANY of the checked ones.
      value: (p) => p.roles,
      cell: (p) => (
        <div className="flex flex-wrap gap-3 justify-end">
          {p.roles.map((r) => (
            <Tag key={r}>{r.toLowerCase()}</Tag>
          ))}
        </div>
      ),
      variant: "multiSelect",
      options: ALL_ROLE_KINDS.map((r) => ({ value: r, label: r.toLowerCase().replace("_", " ") })),
    },
    {
      id: "status",
      header: "Status",
      value: (p) => p.status,
      cell: (p) => <Tag tone={p.status === "ACTIVE" ? "good" : p.status === "INVITED" ? "warn" : "bad"}>{p.status.toLowerCase()}</Tag>,
      variant: "multiSelect",
      options: [
        { value: "ACTIVE", label: "active" },
        { value: "INVITED", label: "invited" },
        { value: "DISABLED", label: "disabled" },
      ],
    },
    {
      id: "unit",
      header: "Department / occupies",
      value: (p) => p.occupiesNodeName ?? p.homeNodeName ?? "",
      cell: (p) => (
        <div className="text-10.5">
          {p.occupiesNodeName ? <span className="text-text">Heads {p.occupiesNodeName}</span> : p.homeNodeName ?? <span className="text-faint">—</span>}
        </div>
      ),
      variant: "multiSelect",
      sortable: true,
    },
    {
      id: "invitedBy",
      header: "Invited by",
      value: (p) => p.invitedByName ?? "",
      cell: (p) => p.invitedByName ?? <span className="text-faint">—</span>,
      variant: "multiSelect",
    },
    {
      id: "joined",
      header: "Added",
      value: (p) => p.createdAt,
      cell: (p) => <span className="text-10">{new Date(p.createdAt).toLocaleDateString("en-GB")}</span>,
      variant: "date",
      sortable: true,
      mono: true,
      width: "110px",
    },
    {
      id: "actions",
      header: "",
      hideable: false,
      cell: (p) => (
        <div className="flex items-center gap-6 justify-end">
          {p.status !== "DISABLED" && p.status === "INVITED" && <Button onClick={() => resendInvite(p)}>Resend invite</Button>}
          {isAdmin && (
            <Button variant="primary" onClick={() => setManageId(p.id)}>
              Manage
            </Button>
          )}
        </div>
      ),
    },
  ];

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
            nodes={nodes}
            onDone={() => {
              setShowForm(false);
              reload();
            }}
            onError={setError}
          />
        )}
        {people === null ? (
          <PanelLoading rows={5} />
        ) : (
          <DataTable tableId="people" columns={columns} rows={people} rowKey={(p) => p.id} />
        )}
      </Panel>

      {managing && (
        <PersonManageModal
          person={managing}
          nodes={nodes}
          isSelf={managing.id === user?.id}
          onClose={() => setManageId(null)}
          onSaveRoles={(roles) => updateRoles(managing.id, roles)}
          onAssignNode={(nodeId) => assignNode(managing.id, nodeId)}
          onDeactivate={() => deactivate(managing)}
          onReactivate={() => reactivate(managing)}
          onError={setError}
        />
      )}
    </Screen>
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
  isSelf,
  onClose,
  onSaveRoles,
  onAssignNode,
  onDeactivate,
  onReactivate,
  onError,
}: {
  person: PersonDto;
  nodes: OrgNodeDto[];
  isSelf: boolean;
  onClose: () => void;
  onSaveRoles: (roles: RoleKind[]) => void;
  onAssignNode: (nodeId: string | null) => void;
  onDeactivate: () => void;
  onReactivate: () => void;
  onError: (m: string) => void;
}) {
  const [roleDraft, setRoleDraft] = useState<RoleKind[]>(person.roles);
  const rolesDirty = JSON.stringify([...roleDraft].sort()) !== JSON.stringify([...person.roles].sort());

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
          {ALL_ROLE_KINDS.map((r) => (
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
  onDone: () => void;
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
      await api.post("/people", {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        roles,
        homeNodeId: isAdmin && homeNodeId ? homeNodeId : undefined,
      });
      onDone();
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
        {isAdmin && (
          <label className="block">
            <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Home department (optional)</span>
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

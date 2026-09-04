"use client";

import { useEffect, useState } from "react";
import type { ContainerOptionDto, ItemPropValue, ResourceCategoryDto } from "@/lib/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useEditOptions } from "@/lib/register/useEditOptions";
import { Modal, Button, ErrorNote } from "@/components/ui";
import { submitChange } from "@/lib/register/useItemChange";
import { PropInput } from "./Inspector";

/** How many rows one instantiation of this category actually produces, parts
 *  included — the wire-DTO-shaped twin of lib/domain/edit-impact.ts's
 *  `templateSize` (that one runs against the domain `Category` map the server
 *  builds; this runs against the plain `ResourceCategoryDto[]` the categories
 *  endpoint returns, which is all a create-preview needs). */
function templateSize(categories: ResourceCategoryDto[], id: string, depth = 0): number {
  const c = categories.find((x) => x.id === id);
  if (!c || depth > 10) return 1;
  return 1 + c.templateChildren.reduce((a, ch) => a + ch.qty * templateSize(categories, ch.childCategoryId, depth + 1), 0);
}

/**
 * Creating a resource — ported from temp_works/src/components/AddModal.tsx, adapted:
 * this form IS the confirmation step (matching that component's own design — no
 * second ConfirmDialog on top, since createItem is always consequential per
 * lib/domain/types.ts's CONFIRMED_CHANGES and a multi-field form already stops to ask
 * before anything commits).
 *
 * Category comes FIRST, ahead of "Into" — a category's own placement rules
 * (lib/domain/placement.ts) decide which containers are even legal destinations, so
 * "Into" cannot be populated until a category is chosen. Its options come from the
 * one container-picker endpoint (`GET /resources/items/containers`), which already
 * filters to destinations that are in scope, write-eligible, AND placement-legal — see
 * items.ts's `containers()` for why that is three separate checks, not one.
 *
 * "Top level" is offered only when the chosen category's own `canBeRoot` allows it AND
 * this person has some plausible path to `scope.ts`'s `assertCanCreateRoot` (widened
 * past SYS_ADMIN-only in 10a of ~/.claude/plans/wait-i-want-gentle-haven.md): SYS_ADMIN
 * anywhere, a MANAGER within their own visible subtree, a CUSTODIAN/STORE_KEEPER at
 * their own home unit with themselves as custodian. The server re-checks all of this
 * regardless — this is a UI hint to avoid offering a choice that would just 403, not
 * the authority.
 */
export function AddModal({
  open,
  onClose,
  onCreated,
  defaultParentId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultParentId?: string | null;
}) {
  const { user, me } = useAuth();
  const editOptions = useEditOptions();
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [parent, setParent] = useState("");
  const [containers, setContainers] = useState<ContainerOptionDto[]>([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [count, setCount] = useState(1);
  const [ownerOrgNodeId, setOwnerOrgNodeId] = useState("");
  const [currentOrgNodeId, setCurrentOrgNodeId] = useState("");
  const [custodianId, setCustodianId] = useState("");
  /** Optional — blank keeps the server's own auto-numbered default ("Lab 01", …).
   *  Reset whenever the category changes, same as `propDrafts` below: a name/value
   *  typed for one category has no meaning once a different one is chosen. */
  const [name, setName] = useState("");
  const [propDrafts, setPropDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = user?.roles ?? [];
  const isSysAdmin = roles.includes("SYS_ADMIN");
  const isManager = roles.includes("MANAGER");
  const isCustodianLike = roles.includes("CUSTODIAN") || roles.includes("STORE_KEEPER");
  const ownNodeId = me?.scope?.nodeId ?? null;
  const canAttemptRoot = isSysAdmin || isManager || (isCustodianLike && Boolean(ownNodeId));

  useEffect(() => {
    if (!open) return;
    setCategoryId("");
    setParent(defaultParentId ?? "");
    setContainers([]);
    setCount(1);
    setName("");
    setPropDrafts({});
    setError(null);
    setOwnerOrgNodeId(ownNodeId ?? "");
    setCurrentOrgNodeId(ownNodeId ?? "");
    setCustodianId(user?.id ?? "");
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then((rows) => setCategories(rows.filter((c) => c.active)))
      .catch(() => setCategories([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A property draft (and a typed name) only means something for the category it was
  // filled in against — never leave one sitting stale once a different category is
  // chosen, the same discipline the "Into" picker's own reset already follows.
  useEffect(() => {
    setName("");
    setPropDrafts({});
  }, [categoryId]);

  useEffect(() => {
    if (!open || !categoryId) {
      setContainers([]);
      return;
    }
    setContainersLoading(true);
    api
      .get<ContainerOptionDto[]>(`/resources/items/containers?categoryId=${encodeURIComponent(categoryId)}`)
      .then((rows) => {
        setContainers(rows);
        // A container that was valid for the previous category may not be for this
        // one — never leave a stale, now-illegal selection sitting in the field.
        setParent((p) => (p && !rows.some((r) => r.id === p) ? "" : p));
      })
      .catch(() => setContainers([]))
      .finally(() => setContainersLoading(false));
  }, [open, categoryId]);

  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
  const canOfferRoot = Boolean(selectedCategory?.canBeRoot) && canAttemptRoot;
  const isRootCreate = parent === "" && canOfferRoot;

  const preview = categoryId ? templateSize(categories, categoryId) : 0;

  const canSubmit =
    Boolean(categoryId) &&
    (parent !== "" || (canOfferRoot && (isCustodianLike && !isManager && !isSysAdmin ? true : Boolean(ownerOrgNodeId) && Boolean(custodianId))));

  /** Same raw-string → typed-value coercion Inspector's own `commitProp` uses for a
   *  follow-up edit — a blank draft means "leave it unset", never sent at all (an
   *  empty-object `props` would validate fine but is just noise on the wire). */
  function buildProps(): Record<string, ItemPropValue> | undefined {
    if (!selectedCategory) return undefined;
    const props: Record<string, ItemPropValue> = {};
    for (const field of selectedCategory.fields) {
      const raw = propDrafts[field.key];
      if (raw === undefined || raw === "") continue;
      let value: ItemPropValue = raw;
      if (field.type === "NUMBER") value = Number(raw);
      if (field.type === "BOOLEAN") value = raw === "true";
      props[field.key] = value;
    }
    return Object.keys(props).length ? props : undefined;
  }

  async function submit() {
    if (!categoryId || !canSubmit) return;
    setBusy(true);
    setError(null);
    const props = buildProps();
    const r = await submitChange({
      kind: "createItem",
      parentId: parent || null,
      categoryId,
      count,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(props ? { props } : {}),
      ...(isRootCreate
        ? {
            ownerOrgNodeId,
            currentOrgNodeId: currentOrgNodeId || ownerOrgNodeId,
            custodianId,
          }
        : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onCreated();
    onClose();
  }

  if (!open) return null;

  const ownerNodeName = editOptions.owner.find((o) => o.value === ownNodeId)?.label ?? "your unit";

  return (
    <Modal title="Add resources" onClose={onClose} width="480px">
      {error && <ErrorNote>{error}</ErrorNote>}
      <label className="block">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Category</div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
        >
          <option value="">Choose…</option>
          {categories
            .slice()
            .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.groupName} · {c.name}
              </option>
            ))}
        </select>
      </label>
      {categoryId && (
        <label className="block">
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Into</div>
          <select
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            disabled={containersLoading}
            className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
          >
            {canOfferRoot && <option value="">Top level (a new lab, store, building…)</option>}
            {/* Always a placeholder when root isn't offered — a native <select> with a
             *  controlled empty value and no matching <option> falls back to visually
             *  showing the first real option as selected while React's `parent` state
             *  stays "", leaving `canSubmit` false with no visible reason why. Keeping
             *  this option present (even when containers.length === 1) forces an
             *  explicit choice and keeps the DOM in sync with state. */}
            {!canOfferRoot && <option value="">Choose…</option>}
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {[...c.path, c.name].join(" / ")}
              </option>
            ))}
          </select>
          {!containersLoading && !canOfferRoot && containers.length === 0 && (
            <div className="text-10.5 text-warn mt-4">You have no container in your custody that this category may be placed into.</div>
          )}
        </label>
      )}
      {isRootCreate && (
        <div className="flex flex-col gap-8 rounded-2 border border-border2 p-10">
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold">A new top-level resource needs</div>
          {isCustodianLike && !isManager && !isSysAdmin ? (
            <p className="text-10.5 text-dim">
              Owning unit: <strong className="text-text">{ownerNodeName}</strong> · Custodian: <strong className="text-text">you</strong>
            </p>
          ) : (
            <>
              <label className="block">
                <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Owning unit</div>
                <select
                  value={ownerOrgNodeId}
                  onChange={(e) => setOwnerOrgNodeId(e.target.value)}
                  className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                >
                  <option value="">Choose…</option>
                  {editOptions.owner.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Custodian</div>
                <select
                  value={custodianId}
                  onChange={(e) => setCustodianId(e.target.value)}
                  className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                >
                  <option value="">Choose…</option>
                  {editOptions.custodian.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      )}
      {categoryId && (
        <label className="block">
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={count > 1 ? `${selectedCategory?.name} 01, 02, …` : selectedCategory?.name}
            className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
          />
        </label>
      )}
      {selectedCategory && selectedCategory.fields.length > 0 && (
        <div>
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-6">Properties</div>
          <div className="grid grid-cols-2 gap-x-14 gap-y-10 text-11">
            {selectedCategory.fields.map((f) => (
              <label key={f.key} className="block">
                <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">{f.unit ? `${f.label} (${f.unit})` : f.label}</div>
                <PropInput field={f} value={propDrafts[f.key] ?? ""} onChange={(v) => setPropDrafts((d) => ({ ...d, [f.key]: v }))} onCommit={() => {}} />
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">How many</div>
        <input
          type="number"
          min={1}
          max={200}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 font-mono outline-none focus:border-accent"
        />
      </label>
      {categoryId && (
        <p className="text-10.5 text-dim">
          Creates {count} × {categories.find((c) => c.id === categoryId)?.name}
          {preview > 1 && (
            <>
              , each with its full default subtree — <strong className="text-text font-mono">{count * preview}</strong> rows in total.
            </>
          )}
        </p>
      )}
      <div className="flex items-center gap-8">
        <Button variant="primary" disabled={!canSubmit || busy} onClick={submit}>
          {busy ? "Creating…" : "Confirm & create"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

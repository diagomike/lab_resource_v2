"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CategoryFieldDto, ContainerOptionDto, CustomPropType, ItemChangeDto, ItemDetailDto, ItemPropValue, ResourceCategoryDto } from "@/lib/shared";
import { CUSTOM_PROP_KEY_PATTERN, customPropTypes, itemStatuses } from "@/lib/shared";
import { CHANGE_LABEL } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { Modal, ErrorNote, ConfirmDialog, Button } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { useEditOptions } from "@/lib/register/useEditOptions";
import { usePendingChange } from "@/lib/register/usePendingChange";
import { StatusChip } from "./StatusChip";
import { ItemImageGallery } from "./ItemImages";

/**
 * The single-item edit surface — corrections (name, status-as-typed-fact... no,
 * status is confirmed, see below; quantity; each property) commit the instant a
 * field is left, no dialog, per lib/domain/types.ts's `needsConfirm` (Phase 7 of
 * ~/.claude/plans/wait-i-want-gentle-haven.md). Consequential single-value changes
 * (status, custodian, owning/current unit, position, delete) go through the same
 * ConfirmDialog/PendingAction machinery OrgStudioPage.tsx already established —
 * `usePendingChange` is that pattern factored out for reuse here and in the
 * register's bulk-selection toolbar, not a second dialog invented for this screen.
 */
export function Inspector({
  itemId,
  onClose,
  onChanged,
  readOnly = false,
}: {
  itemId: string | null;
  onClose: () => void;
  onChanged: () => void;
  /** The university-wide browse's drill-through (10b of
   *  ~/.claude/plans/three-product-changes-dynamic-thompson.md) — same data, same
   *  fetch (with `?scope=UNIVERSITY` so an out-of-department item resolves instead of
   *  404ing), but no editable field, no Position/custodian/owner transfer, no delete.
   *  Seeing further grants nothing; the write door stays custody-based regardless of
   *  what this prop does — this is a UI convenience, not the enforcement. */
  readOnly?: boolean;
}) {
  const [item, setItem] = useState<ItemDetailDto | null>(null);
  const [changes, setChanges] = useState<ItemChangeDto[] | null>(null);
  const [category, setCategory] = useState<ResourceCategoryDto | null>(null);
  const [moveTargets, setMoveTargets] = useState<ContainerOptionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [qtyDraft, setQtyDraft] = useState("");
  const [propDrafts, setPropDrafts] = useState<Record<string, string>>({});
  const [customPropDrafts, setCustomPropDrafts] = useState<Record<string, string>>({});
  const [addingCustom, setAddingCustom] = useState(false);
  const [newCustomName, setNewCustomName] = useState("");
  const [newCustomType, setNewCustomType] = useState<CustomPropType>("TEXT");
  const [newCustomValue, setNewCustomValue] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const options = useEditOptions();

  function load() {
    if (!itemId) return;
    setItem(null);
    setChanges(null);
    setCategory(null);
    setError(null);
    const scopeParam = readOnly ? "?scope=UNIVERSITY" : "";
    Promise.all([
      api.get<ItemDetailDto>(`/resources/items/${itemId}${scopeParam}`),
      api.get<ItemChangeDto[]>(`/resources/items/${itemId}/changes${scopeParam}`),
    ])
      .then(([i, c]) => {
        setItem(i);
        setChanges(c);
        setNameDraft(i.name);
        setQtyDraft(String(i.qty));
        setPropDrafts(Object.fromEntries(Object.entries(i.props).map(([k, v]) => [k, v === null ? "" : String(v)])));
        setCustomPropDrafts(Object.fromEntries(Object.entries(i.customProps).map(([k, c]) => [k, c.value === null ? "" : String(c.value)])));
        setAddingCustom(false);
        setNewCustomName("");
        setNewCustomType("TEXT");
        setNewCustomValue("");
        setInlineError(null);
        api
          .get<ResourceCategoryDto[]>("/resources/categories")
          .then((cats) => setCategory(cats.find((c) => c.id === i.categoryId) ?? null))
          .catch(() => setCategory(null));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this resource"));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [itemId]);

  // "Position"'s own options — the same container-picker endpoint AddModal's "Into"
  // and the register toolbar's "Move to…" use, so this picker never offers a
  // destination the write path would then refuse. Excludes the item's own subtree —
  // mutate.ts's own isWithinSubtree check still enforces that regardless, this only
  // keeps it from appearing choosable.
  useEffect(() => {
    if (!item || readOnly) {
      setMoveTargets([]);
      return;
    }
    let cancelled = false;
    api
      .get<ContainerOptionDto[]>(`/resources/items/containers?categoryId=${encodeURIComponent(item.categoryId)}&exclude=${encodeURIComponent(item.id)}`)
      .then((rows) => !cancelled && setMoveTargets(rows))
      .catch(() => !cancelled && setMoveTargets([]));
    return () => {
      cancelled = true;
    };
  }, [item?.categoryId, item?.id]);

  const { pending, busy, error: pendingError, request, confirm, cancel } = usePendingChange((_result, input) => {
    onChanged();
    // A delete leaves nothing here to reload — closing is the only sensible outcome;
    // reloading would just 404 against the row this same action just removed.
    if (input.kind === "deleteItem") {
      onClose();
      return;
    }
    load();
  });

  const fieldsByKey = useMemo(() => new Map((category?.fields ?? []).map((f) => [f.key, f])), [category]);
  const expectedVersions = item ? { [item.id]: item.version } : {};

  if (!itemId) return null;

  async function commitName() {
    if (!item || nameDraft.trim() === item.name) return;
    if (!nameDraft.trim()) {
      setNameDraft(item.name);
      return;
    }
    setInlineError(null);
    const r = await request({
      input: { kind: "setName", itemIds: [item.id], value: nameDraft.trim(), expectedVersions },
      title: "Rename",
      message: `Rename "${item.name}" to "${nameDraft.trim()}"?`,
    });
    if (!r.ok) {
      setNameDraft(item.name);
      setInlineError(r.message);
    }
  }

  async function commitQty() {
    if (!item) return;
    const n = Number(qtyDraft);
    if (!Number.isFinite(n) || n < 0 || n === item.qty) {
      setQtyDraft(String(item.qty));
      return;
    }
    setInlineError(null);
    const r = await request({
      input: { kind: "setQuantity", itemIds: [item.id], value: n, expectedVersions },
      title: "Set quantity",
      message: `Set quantity to ${n}?`,
    });
    if (!r.ok) {
      setQtyDraft(String(item.qty));
      setInlineError(r.message);
    }
  }

  async function commitProp(field: CategoryFieldDto) {
    if (!item) return;
    const raw = propDrafts[field.key] ?? "";
    const before = item.props[field.key] ?? null;
    let value: ItemPropValue = raw === "" ? null : raw;
    if (raw !== "" && field.type === "NUMBER") value = Number(raw);
    if (raw !== "" && field.type === "BOOLEAN") value = raw === "true";
    if (value === before) return;
    setInlineError(null);
    const r = await request({
      input: { kind: "setProperty", itemIds: [item.id], propKey: field.key, value, expectedVersions },
      title: "Property correction",
      message: `Set ${field.label} to ${raw || "blank"}?`,
    });
    if (!r.ok) {
      setPropDrafts((d) => ({ ...d, [field.key]: before === null ? "" : String(before) }));
      setInlineError(r.message);
    }
  }

  function coerceCustomValue(type: CustomPropType, raw: string): ItemPropValue {
    if (raw === "") return null;
    if (type === "NUMBER") return Number(raw);
    if (type === "BOOLEAN") return raw === "true";
    return raw;
  }

  async function commitCustomProp(key: string, type: CustomPropType) {
    if (!item) return;
    const raw = customPropDrafts[key] ?? "";
    const before = item.customProps[key]?.value ?? null;
    const value = coerceCustomValue(type, raw);
    if (value === before) return;
    setInlineError(null);
    const r = await request({
      input: { kind: "setCustomProperty", itemIds: [item.id], key, value, expectedVersions },
      title: "Optional property correction",
      message: `Set ${key} to ${raw || "blank"}?`,
    });
    if (!r.ok) {
      setCustomPropDrafts((d) => ({ ...d, [key]: before === null ? "" : String(before) }));
      setInlineError(r.message);
    }
  }

  function requestRemoveCustomProp(key: string) {
    if (!item) return;
    setInlineError(null);
    request({
      input: { kind: "removeCustomProperty", itemIds: [item.id], key, expectedVersions },
      title: "Remove optional property",
      message: (
        <>
          Remove the optional property <b className="text-text">{key}</b> from <b className="text-text">{item.name}</b>? This cannot be
          undone.
        </>
      ),
      tone: "danger",
      confirmLabel: "Remove",
    });
  }

  async function submitAddCustomProp() {
    if (!item) return;
    const key = newCustomName.trim();
    if (!key) {
      setInlineError("Give this property a name.");
      return;
    }
    if (!CUSTOM_PROP_KEY_PATTERN.test(key)) {
      setInlineError("Use letters, numbers, spaces, - or _, starting with a letter.");
      return;
    }
    setInlineError(null);
    const r = await request({
      input: { kind: "addCustomProperty", itemIds: [item.id], key, type: newCustomType, value: coerceCustomValue(newCustomType, newCustomValue), expectedVersions },
      title: "Add optional property",
      message: `Add "${key}" to ${item.name}?`,
    });
    if (r.ok) {
      setAddingCustom(false);
      setNewCustomName("");
      setNewCustomType("TEXT");
      setNewCustomValue("");
    } else {
      setInlineError(r.message);
    }
  }

  function requestStatus(value: string) {
    if (!item || value === item.status) return;
    request({
      input: { kind: "setStatus", itemIds: [item.id], value: value as ItemDetailDto["status"], expectedVersions },
      title: "Status change",
      message: (
        <>
          Set <b className="text-text">{item.name}</b>'s status to <b className="text-text">{STATUS_LABEL[value as ItemDetailDto["status"]]}</b>?
        </>
      ),
      tone: "warn",
    });
  }

  function requestCustodian(value: string) {
    if (!item || value === item.custodianId) return;
    const label = options.custodian.find((o) => o.value === value)?.label ?? value;
    request({
      input: { kind: "setCustodian", itemIds: [item.id], value, expectedVersions },
      title: "Custody transfer",
      message: (
        <>
          Hand custody of <b className="text-text">{item.name}</b> to <b className="text-text">{label}</b>?
        </>
      ),
      tone: "warn",
    });
  }

  function requestOwner(value: string) {
    if (!item || value === item.ownerOrgNodeId) return;
    const label = options.owner.find((o) => o.value === value)?.label ?? value;
    request({
      input: { kind: "setOwnerOrg", itemIds: [item.id], value, expectedVersions },
      title: "Ownership transfer",
      message: (
        <>
          Permanently transfer <b className="text-text">{item.name}</b> to <b className="text-text">{label}</b>? For a temporary loan,
          change the current unit instead.
        </>
      ),
      tone: "warn",
    });
  }

  function requestCurrentOrg(value: string) {
    if (!item || value === item.currentOrgNodeId) return;
    const label = options.currentOrg.find((o) => o.value === value)?.label ?? value;
    request({
      input: { kind: "setCurrentOrg", itemIds: [item.id], value, expectedVersions },
      title: "Current unit change",
      message: (
        <>
          Record <b className="text-text">{item.name}</b> as currently held by <b className="text-text">{label}</b>? Ownership stays as
          it is.
        </>
      ),
      tone: "warn",
    });
  }

  function requestMove(value: string) {
    if (!item) return;
    const target = value || null;
    request({
      input: { kind: "moveInTree", itemIds: [item.id], value: target, expectedVersions },
      title: "Relocation",
      message: (
        <>
          Move <b className="text-text">{item.name}</b> to{" "}
          <b className="text-text">{target ? (moveTargets.find((c) => c.id === target)?.name ?? target) : "the top level"}</b>? Owning
          unit and custodian stay as they are.
        </>
      ),
      tone: "warn",
    });
  }

  function requestDelete() {
    if (!item) return;
    request({
      input: { kind: "deleteItem", itemIds: [item.id], expectedVersions },
      title: "Delete resource",
      message: (
        <>
          Delete <b className="text-text">{item.name}</b> and everything physically nested inside it? This cannot be undone.
        </>
      ),
      tone: "danger",
      confirmLabel: "Delete",
    });
  }

  async function onAddImage(uploadSessionId: string, caption: string) {
    if (!item) return;
    setInlineError(null);
    const r = await request({
      input: { kind: "addImage", itemIds: [item.id], uploadSessionId, caption, expectedVersions },
      title: "Add photo",
      message: `Add this photo to ${item.name}?`,
    });
    if (!r.ok) setInlineError(r.message);
  }

  function onRemoveImage(imageId: string) {
    if (!item) return;
    setInlineError(null);
    request({
      input: { kind: "removeImage", itemIds: [item.id], imageId, expectedVersions },
      title: "Remove photo",
      message: (
        <>
          Remove this photo from <b className="text-text">{item.name}</b>? This cannot be undone.
        </>
      ),
      tone: "danger",
      confirmLabel: "Remove",
    });
  }

  return (
    <>
      <Modal title={item?.name ?? "Resource"} onClose={onClose} width="600px">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!item ? (
          <PanelLoading rows={4} />
        ) : readOnly ? (
          <ReadOnlyBody item={item} category={category} changes={changes} />
        ) : (
          <>
            <ItemImageGallery item={item} category={category} expectedVersions={expectedVersions} onAdd={onAddImage} onRemove={onRemoveImage} />

            <div className="flex items-start justify-between gap-10">
              <div className="flex-1">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="text-13 font-semibold bg-transparent outline-none border-b border-transparent focus:border-accent w-full"
                />
                <div className="text-10.5 text-dim mt-2">{item.categoryName}</div>
                {item.path.length > 0 && <div className="text-10 text-faint mt-2">{item.path.join(" › ")}</div>}
              </div>
              <select
                value={item.status}
                onChange={(e) => requestStatus(e.target.value)}
                className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent flex-none"
              >
                {itemStatuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              {item.effectiveStatus !== item.status && (
                <span className="flex-none self-center">
                  <StatusChip status={item.effectiveStatus} title="Derived from this resource's parts — not directly settable" />
                </span>
              )}
            </div>

            {item.readOnlyContext && (
              <div className="text-10.5 text-warn bg-warnbg border border-warn rounded-2 px-8 py-6">
                You are seeing this as the container of something you can act on — not something you hold yourself. Editing here will be
                refused.
              </div>
            )}
            {inlineError && <ErrorNote>{inlineError}</ErrorNote>}

            <div className="grid grid-cols-2 gap-x-14 gap-y-10 text-11">
              <EditField label="Quantity">
                {item.countingMode === "BULK" ? (
                  <input
                    type="number"
                    min={0}
                    value={qtyDraft}
                    onChange={(e) => setQtyDraft(e.target.value)}
                    onBlur={commitQty}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 font-mono outline-none focus:border-accent"
                  />
                ) : (
                  <span className="text-11 text-faint">1 unit</span>
                )}
              </EditField>
              <EditField label="Custodian">
                <select
                  value={item.custodianId}
                  onChange={(e) => requestCustodian(e.target.value)}
                  className="w-full h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                >
                  {!options.custodian.some((o) => o.value === item.custodianId) && <option value={item.custodianId}>{item.custodianName}</option>}
                  {options.custodian.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </EditField>
              <EditField label="Owning unit">
                <select
                  value={item.ownerOrgNodeId}
                  onChange={(e) => requestOwner(e.target.value)}
                  className="w-full h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                >
                  {!options.owner.some((o) => o.value === item.ownerOrgNodeId) && <option value={item.ownerOrgNodeId}>{item.ownerOrgNodeName}</option>}
                  {options.owner.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </EditField>
              <EditField label="Current unit">
                <select
                  value={item.currentOrgNodeId}
                  onChange={(e) => requestCurrentOrg(e.target.value)}
                  className="w-full h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                >
                  {!options.currentOrg.some((o) => o.value === item.currentOrgNodeId) && (
                    <option value={item.currentOrgNodeId}>{item.currentOrgNodeName}</option>
                  )}
                  {options.currentOrg.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </EditField>
              <EditField label="Position">
                <select
                  value={item.parentId ?? ""}
                  onChange={(e) => requestMove(e.target.value)}
                  className="w-full h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                >
                  <option value="">Top level</option>
                  {moveTargets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {[...c.path, c.name].join(" / ")}
                    </option>
                  ))}
                </select>
              </EditField>
              <EditField label="Version">
                <span className="text-11 font-mono text-faint">{item.version}</span>
              </EditField>
            </div>

            {category && category.fields.length > 0 && (
              <div>
                <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-6">Properties</div>
                <div className="grid grid-cols-2 gap-x-14 gap-y-10 text-11">
                  {category.fields.map((f) => (
                    <EditField key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
                      <PropInput field={f} value={propDrafts[f.key] ?? ""} onChange={(v) => setPropDrafts((d) => ({ ...d, [f.key]: v }))} onCommit={() => commitProp(f)} />
                    </EditField>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center gap-8 mb-6">
                <div className="text-9.5 uppercase tracking-label text-faint font-semibold">Custom properties</div>
                <span className="text-9.5 text-faint" title="Item-specific facts this resource carries beyond its category's own fields — visible only here, not shared with other items of this category.">
                  (this item only)
                </span>
              </div>
              {Object.keys(item.customProps).length === 0 && !addingCustom && (
                <div className="text-10.5 text-faint mb-6">No optional properties on this resource yet.</div>
              )}
              {Object.keys(item.customProps).length > 0 && (
                <div className="grid grid-cols-2 gap-x-14 gap-y-10 text-11 mb-8">
                  {Object.entries(item.customProps).map(([key, c]) => (
                    <EditField key={key} label={key}>
                      <div className="flex items-center gap-6">
                        <CustomPropInput type={c.type} value={customPropDrafts[key] ?? ""} onChange={(v) => setCustomPropDrafts((d) => ({ ...d, [key]: v }))} onCommit={() => commitCustomProp(key, c.type)} />
                        <button type="button" onClick={() => requestRemoveCustomProp(key)} className="text-10 text-bad flex-none" title="Remove this property">
                          ×
                        </button>
                      </div>
                    </EditField>
                  ))}
                </div>
              )}
              {addingCustom ? (
                <div className="flex flex-wrap items-end gap-6 border border-border2 rounded-2 p-8">
                  <label className="w-[160px]">
                    <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Name</div>
                    <input
                      autoFocus
                      value={newCustomName}
                      onChange={(e) => setNewCustomName(e.target.value)}
                      placeholder="e.g. Serial (spare)"
                      className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                    />
                  </label>
                  <label className="w-[100px]">
                    <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Type</div>
                    <select
                      value={newCustomType}
                      onChange={(e) => {
                        setNewCustomType(e.target.value as CustomPropType);
                        setNewCustomValue("");
                      }}
                      className="w-full h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                    >
                      {customPropTypes.map((t) => (
                        <option key={t} value={t}>
                          {t === "TEXT" ? "Text" : t === "NUMBER" ? "Number" : "Yes/No"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-[120px] flex-1">
                    <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Value</div>
                    <CustomPropInput type={newCustomType} value={newCustomValue} onChange={setNewCustomValue} onCommit={() => {}} />
                  </label>
                  <Button variant="primary" onClick={submitAddCustomProp}>
                    Add
                  </Button>
                  <Button
                    onClick={() => {
                      setAddingCustom(false);
                      setInlineError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAddingCustom(true);
                    setInlineError(null);
                  }}
                  className="text-10.5 text-accent"
                >
                  + Add optional property
                </button>
              )}
            </div>

            <div>
              <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-6">History</div>
              {changes === null ? (
                <PanelLoading rows={2} />
              ) : changes.length === 0 ? (
                <div className="text-10.5 text-faint">No changes recorded yet.</div>
              ) : (
                <div className="flex flex-col gap-6">
                  {changes.slice(0, 20).map((c) => (
                    <div key={c.id} className="text-10.5 border-b border-border pb-6">
                      <span className="text-dim">{CHANGE_LABEL[c.kind]}</span>
                      {c.field && <span className="text-faint"> · {c.field}</span>}
                      {(c.before !== null || c.after !== null) && (
                        <span className="text-faint">
                          {" "}
                          · {String(c.before ?? "—")} → {String(c.after ?? "—")}
                        </span>
                      )}
                      <div className="text-9.5 text-faint mt-1">
                        {c.actorName} · {new Date(c.at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-border">
              <Button variant="danger" onClick={requestDelete}>
                Delete resource
              </Button>
            </div>
          </>
        )}
      </Modal>

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
    </>
  );
}

/**
 * The university-wide browse's drill-through (10b of
 * ~/.claude/plans/three-product-changes-dynamic-thompson.md) — same fetched item,
 * same category, same history, none of the editable body's inputs/selects/buttons.
 * Deliberately a separate render tree rather than `readOnly &&`-gating individual
 * fields throughout the editable body above: that body's fields are tightly coupled
 * to draft state and commit handlers this view has no use for, and threading a
 * read-only branch through each one would obscure more than it would share. Shows
 * exactly what the plan asked an approver needs: location, owner, current holder,
 * custodian, condition, specs and photo — including "on loan"
 * (currentOrgNodeId ≠ ownerOrgNodeId), the owner/current split's whole point.
 */
function ReadOnlyBody({ item, category, changes }: { item: ItemDetailDto; category: ResourceCategoryDto | null; changes: ItemChangeDto[] | null }) {
  const onLoan = item.currentOrgNodeId !== item.ownerOrgNodeId;
  return (
    <>
      <ItemImageGallery item={item} category={category} expectedVersions={{}} onAdd={async () => {}} onRemove={() => {}} readOnly />

      <div>
        <div className="text-13 font-semibold">{item.name}</div>
        <div className="text-10.5 text-dim mt-2">{item.categoryName}</div>
        {item.path.length > 0 && <div className="text-10 text-faint mt-2">{item.path.join(" › ")}</div>}
      </div>

      <div className="flex items-center gap-8">
        <StatusChip status={item.effectiveStatus} />
        {item.effectiveStatus !== item.status && <span className="text-10.5 text-faint">Set directly: {STATUS_LABEL[item.status]}</span>}
      </div>

      <div className="grid grid-cols-2 gap-x-14 gap-y-10 text-11">
        <EditField label="Quantity">
          <span className="text-11">{item.countingMode === "BULK" ? item.qty : "1 unit"}</span>
        </EditField>
        <EditField label="Custodian">
          <span className="text-11">{item.custodianName}</span>
        </EditField>
        <EditField label="Owning unit">
          <span className="text-11">{item.ownerOrgNodeName}</span>
        </EditField>
        <EditField label="Current unit">
          <span className="text-11">
            {item.currentOrgNodeName}
            {onLoan && <span className="text-warn"> (on loan)</span>}
          </span>
        </EditField>
      </div>

      {category && category.fields.length > 0 && (
        <div>
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-6">Properties</div>
          <div className="grid grid-cols-2 gap-x-14 gap-y-10 text-11">
            {category.fields.map((f) => (
              <EditField key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
                <span className="text-11 text-dim">{formatPropValue(item.props[f.key] ?? null)}</span>
              </EditField>
            ))}
          </div>
        </div>
      )}

      {Object.keys(item.customProps).length > 0 && (
        <div>
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-6">Custom properties</div>
          <div className="grid grid-cols-2 gap-x-14 gap-y-10 text-11">
            {Object.entries(item.customProps).map(([key, c]) => (
              <EditField key={key} label={key}>
                <span className="text-11 text-dim">{formatPropValue(c.value)}</span>
              </EditField>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-6">History</div>
        {changes === null ? (
          <PanelLoading rows={2} />
        ) : changes.length === 0 ? (
          <div className="text-10.5 text-faint">No changes recorded yet.</div>
        ) : (
          <div className="flex flex-col gap-6">
            {changes.slice(0, 20).map((c) => (
              <div key={c.id} className="text-10.5 border-b border-border pb-6">
                <span className="text-dim">{CHANGE_LABEL[c.kind]}</span>
                {c.field && <span className="text-faint"> · {c.field}</span>}
                <div className="text-9.5 text-faint mt-1">
                  {c.actorName} · {new Date(c.at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function formatPropValue(v: ItemPropValue): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">{label}</div>
      {children}
    </div>
  );
}

/** Exported for AddModal's own use — same per-field-type input widget, filling a
 *  category's fields in at creation time rather than only via a follow-up edit. */
export function PropInput({
  field,
  value,
  onChange,
  onCommit,
}: {
  field: CategoryFieldDto;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const cls = "w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent";
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => e.key === "Enter" && (e.target as HTMLElement).blur();

  if (field.type === "ENUM") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} className={cls}>
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "BOOLEAN") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} className={cls}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return (
    <input
      type={field.type === "NUMBER" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={onKeyDown}
      className={cls}
    />
  );
}

/** Same shape as PropInput, parameterized by a bare CustomPropType rather than a full
 *  CategoryFieldDto — a custom property has no options/unit/required, only a type. */
export function CustomPropInput({
  type,
  value,
  onChange,
  onCommit,
}: {
  type: CustomPropType;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const cls = "w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent";
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => e.key === "Enter" && (e.target as HTMLElement).blur();

  if (type === "BOOLEAN") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} className={cls}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return (
    <input
      type={type === "NUMBER" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={onKeyDown}
      className={cls}
    />
  );
}

"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CategoryFieldDto, ItemChangeDto, ItemDetailDto, ItemPropValue, ItemRowDto, ResourceCategoryDto } from "@/lib/shared";
import { itemStatuses } from "@/lib/shared";
import { CHANGE_LABEL } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { Modal, ErrorNote, ConfirmDialog, Button } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { useEditOptions } from "@/lib/register/useEditOptions";
import { usePendingChange } from "@/lib/register/usePendingChange";
import { StatusChip } from "./StatusChip";

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
  containers,
  onClose,
  onChanged,
}: {
  itemId: string | null;
  /** Candidate destinations for "Move" — every currently-loaded row except the item
   *  itself and anything inside it (the server rejects a genuine cycle regardless;
   *  this list just keeps the picker from offering an obviously invalid one). */
  containers: ItemRowDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [item, setItem] = useState<ItemDetailDto | null>(null);
  const [changes, setChanges] = useState<ItemChangeDto[] | null>(null);
  const [category, setCategory] = useState<ResourceCategoryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [qtyDraft, setQtyDraft] = useState("");
  const [propDrafts, setPropDrafts] = useState<Record<string, string>>({});
  const [inlineError, setInlineError] = useState<string | null>(null);
  const options = useEditOptions();

  function load() {
    if (!itemId) return;
    setItem(null);
    setChanges(null);
    setCategory(null);
    setError(null);
    Promise.all([api.get<ItemDetailDto>(`/resources/items/${itemId}`), api.get<ItemChangeDto[]>(`/resources/items/${itemId}/changes`)])
      .then(([i, c]) => {
        setItem(i);
        setChanges(c);
        setNameDraft(i.name);
        setQtyDraft(String(i.qty));
        setPropDrafts(Object.fromEntries(Object.entries(i.props).map(([k, v]) => [k, v === null ? "" : String(v)])));
        api
          .get<ResourceCategoryDto[]>("/resources/categories")
          .then((cats) => setCategory(cats.find((c) => c.id === i.categoryId) ?? null))
          .catch(() => setCategory(null));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this resource"));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [itemId]);

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
          <b className="text-text">{target ? (containers.find((c) => c.id === target)?.name ?? target) : "the top level"}</b>? Owning
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

  return (
    <>
      <Modal title={item?.name ?? "Resource"} onClose={onClose} width="600px">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!item ? (
          <PanelLoading rows={4} />
        ) : (
          <>
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
                  {containers
                    .filter((c) => c.id !== item.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
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

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">{label}</div>
      {children}
    </div>
  );
}

function PropInput({
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

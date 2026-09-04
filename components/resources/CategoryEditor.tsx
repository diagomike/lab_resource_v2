"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CategoryFieldDto,
  CategoryFieldType,
  CategoryGroupDto,
  CategoryImpactDto,
  CategoryImpactNote,
  CountingMode,
  CreateCategoryInput,
  ImpairRule,
  ResourceCategoryDto,
} from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Button, ConfirmDialog, ErrorNote, Tag } from "@/components/ui";
import { CategoryIcon, IconPicker } from "./IconPicker";

const RULE_LABEL: Record<ImpairRule, string> = { ANY_CRITICAL: "Any critical", ALL_CRITICAL: "All critical", NEVER: "Never" };
const RULE_HELP: Record<ImpairRule, string> = {
  ANY_CRITICAL: "One critical child down impairs this item. Right for a computer: a dead motherboard or monitor stops the machine.",
  ALL_CRITICAL: "Only impaired when EVERY critical child is down. Right for redundancy: two switches in a rack, either one keeps the network alive.",
  NEVER: "Children never impair this item, unconditionally. Right for a place: a lab is not broken because one PC is.",
};
const SEVERITY_CLASS: Record<CategoryImpactNote["severity"], string> = {
  destructive: "bg-badbg text-bad border-bad",
  warning: "bg-warnbg text-warn border-warn",
  info: "bg-panel2 text-dim border-border2",
};

interface FieldDraft {
  key: string;
  label: string;
  type: CategoryFieldType;
  options: string[];
  unit: string;
  summary: boolean;
  longText: boolean;
  required: boolean;
}
interface ChildDraft {
  childCategoryId: string;
  qty: number;
  critical: boolean;
}
interface Draft {
  key: string;
  name: string;
  iconKey: string;
  groupId: string;
  countingMode: CountingMode;
  unit: string;
  impairRule: ImpairRule;
  active: boolean;
  fields: FieldDraft[];
  templateChildren: ChildDraft[];
}

function draftFrom(c: ResourceCategoryDto | null, defaultGroupId: string): Draft {
  if (!c) {
    return { key: "", name: "", iconKey: "Package", groupId: defaultGroupId, countingMode: "SERIALIZED", unit: "", impairRule: "ANY_CRITICAL", active: true, fields: [], templateChildren: [] };
  }
  return {
    key: c.key,
    name: c.name,
    iconKey: c.iconKey,
    groupId: c.groupId,
    countingMode: c.countingMode,
    unit: c.unit ?? "",
    impairRule: c.impairRule,
    active: c.active,
    fields: c.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, unit: f.unit ?? "", summary: f.summary, longText: f.longText, required: f.required })),
    templateChildren: c.templateChildren.map((t) => ({ childCategoryId: t.childCategoryId, qty: t.qty, critical: t.critical })),
  };
}

function toInput(draft: Draft): CreateCategoryInput {
  return {
    key: draft.key.trim(),
    name: draft.name.trim(),
    iconKey: draft.iconKey,
    groupId: draft.groupId,
    countingMode: draft.countingMode,
    unit: draft.countingMode === "BULK" ? draft.unit.trim() || undefined : undefined,
    impairRule: draft.impairRule,
    fields: draft.fields.map((f, i) => ({
      key: f.key.trim(),
      label: f.label.trim(),
      type: f.type,
      options: f.options,
      unit: f.unit.trim() || undefined,
      summary: f.summary,
      longText: f.longText,
      required: f.required,
      sortOrder: i,
    })),
    templateChildren: draft.templateChildren.filter((c) => c.childCategoryId).map((c) => ({ childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
  };
}

/**
 * The Category Studio's editor panel — the database-backed replacement for
 * temp_works/src/app/categories/page.tsx's main panel, with the impact-preview/review
 * step ported from ItemEditModal.tsx's "Category type" tab + ReviewPanel (that
 * component's Details/Children tabs are an ITEM editor's job — Inspector.tsx's own —
 * not this standalone category editor's; this brings over only the category-scope
 * behavior: staged draft, blast-radius preview before applying, the purge checkbox).
 * Read-only browsing stays available to every signed-in person; every control that
 * writes anything is gated behind `canManage`, mirroring (not re-deriving) the
 * server's own SYS_ADMIN/PROPERTY_ADMIN role gate — hiding controls is not the
 * security boundary, categories.ts's route handlers are.
 */
export function CategoryEditor({
  category,
  groups,
  categories,
  usageCount,
  canManage,
  onSaved,
  onDeleted,
}: {
  category: ResourceCategoryDto | null;
  groups: CategoryGroupDto[];
  categories: ResourceCategoryDto[];
  usageCount: number;
  canManage: boolean;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const isNew = category === null;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(category, groups[0]?.id ?? ""));
  const [fieldUsage, setFieldUsage] = useState<Record<string, number>>({});
  const [reviewing, setReviewing] = useState(false);
  const [impact, setImpact] = useState<CategoryImpactDto | null>(null);
  const [purge, setPurge] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBlock, setDeleteBlock] = useState<{ message: string; canConfirmTemplate: boolean } | null>(null);

  useEffect(() => {
    setDraft(draftFrom(category, groups[0]?.id ?? ""));
    setReviewing(false);
    setImpact(null);
    setPurge(false);
    setNote("");
    setError(null);
    setConflict(false);
    setConfirmingDelete(false);
    setDeleteBlock(null);
    if (category) {
      api
        .get<Record<string, number>>(`/resources/categories/${category.id}/field-usage`)
        .then(setFieldUsage)
        .catch(() => setFieldUsage({}));
    } else {
      setFieldUsage({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category?.id]);

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }
  function updateField(i: number, p: Partial<FieldDraft>) {
    patch({ fields: draft.fields.map((f, j) => (i === j ? { ...f, ...p } : f)) });
  }
  function addField() {
    patch({ fields: [...draft.fields, { key: "", label: "", type: "TEXT", options: [], unit: "", summary: false, longText: false, required: false }] });
  }
  function removeField(i: number) {
    patch({ fields: draft.fields.filter((_, j) => j !== i) });
  }
  function updateChild(i: number, p: Partial<ChildDraft>) {
    patch({ templateChildren: draft.templateChildren.map((c, j) => (i === j ? { ...c, ...p } : c)) });
  }
  function addChild() {
    patch({ templateChildren: [...draft.templateChildren, { childCategoryId: "", qty: 1, critical: false }] });
  }
  function removeChild(i: number) {
    patch({ templateChildren: draft.templateChildren.filter((_, j) => j !== i) });
  }

  const childOptions = useMemo(
    () => categories.filter((c) => c.id !== category?.id).sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name)),
    [categories, category?.id],
  );

  const dirty = useMemo(() => {
    if (isNew) return true;
    return JSON.stringify(draftFrom(category, groups[0]?.id ?? "")) !== JSON.stringify(draft);
  }, [draft, category, isNew, groups]);

  const duplicateFieldKey = useMemo(() => {
    const seen = new Set<string>();
    for (const f of draft.fields) {
      const k = f.key.trim();
      if (!k) continue;
      if (seen.has(k)) return k;
      seen.add(k);
    }
    return null;
  }, [draft.fields]);

  const canSubmit = draft.name.trim().length > 0 && draft.key.trim().length > 0 && !duplicateFieldKey && draft.fields.every((f) => f.type !== "ENUM" || f.options.length > 0);

  async function createNow() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/resources/categories", toInput(draft));
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create this category");
    } finally {
      setBusy(false);
    }
  }

  async function loadImpact() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<CategoryImpactDto>(`/resources/categories/${category.id}/impact`, toInput(draft));
      setImpact(result);
      setReviewing(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not preview this change");
    } finally {
      setBusy(false);
    }
  }

  const orphanKeys = useMemo(() => [...new Set((impact?.notes ?? []).flatMap((n) => n.orphanKeys))], [impact]);

  async function applyEdit() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/resources/categories/${category.id}`, {
        ...toInput(draft),
        expectedVersion: category.version,
        purgeKeys: purge ? orphanKeys : [],
        note: note.trim() || undefined,
      });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.code === "VERSION_CONFLICT") setConflict(true);
      else setError(e instanceof ApiError ? e.message : "Could not save this category");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(confirmTemplateRemoval: boolean) {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/resources/categories/${category.id}${confirmTemplateRemoval ? "?confirmTemplateRemoval=true" : ""}`);
      setConfirmingDelete(false);
      setDeleteBlock(null);
      onDeleted();
    } catch (e) {
      setConfirmingDelete(false);
      if (e instanceof ApiError && e.status === 409 && e.body?.code === "TEMPLATE_CHILD_IN_USE") {
        setDeleteBlock({ message: e.message, canConfirmTemplate: true });
      } else if (e instanceof ApiError) {
        setDeleteBlock({ message: e.message, canConfirmTemplate: false });
      } else {
        setError("Could not delete this category");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return <CategoryReadOnly category={category} usageCount={usageCount} />;

  if (conflict) {
    return (
      <div className="flex flex-col gap-10">
        <ErrorNote>This category changed since you loaded it. Reload the current definition — a stale draft cannot be merged in.</ErrorNote>
        <Button variant="primary" onClick={onSaved}>
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-14">
      {error && <ErrorNote>{error}</ErrorNote>}

      {reviewing && impact ? (
        <ReviewPanel impact={impact} orphanKeys={orphanKeys} purge={purge} onPurge={setPurge} note={note} onNote={setNote} />
      ) : (
        <>
          <div className="flex flex-wrap gap-10">
            <label className="w-[220px]">
              <FieldLabel>Icon</FieldLabel>
              <IconPicker value={draft.iconKey} onChange={(iconKey) => patch({ iconKey })} />
            </label>
            <label className="min-w-[200px] flex-1">
              <FieldLabel>Name</FieldLabel>
              <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Desk Config" className={inputCls} />
            </label>
            <label className="w-[160px]">
              <FieldLabel>Stable key</FieldLabel>
              <input value={draft.key} onChange={(e) => patch({ key: e.target.value })} placeholder="e.g. computer" className={`${inputCls} font-mono`} />
            </label>
            <label className="w-[180px]">
              <FieldLabel>Group</FieldLabel>
              <select value={draft.groupId} onChange={(e) => patch({ groupId: e.target.value })} className={inputCls}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-[160px]">
              <FieldLabel>Counted as</FieldLabel>
              <select value={draft.countingMode} onChange={(e) => patch({ countingMode: e.target.value as CountingMode })} className={inputCls}>
                <option value="SERIALIZED">Individual units</option>
                <option value="BULK">A quantity</option>
              </select>
            </label>
            {draft.countingMode === "BULK" && (
              <label className="w-[100px]">
                <FieldLabel>Unit</FieldLabel>
                <input value={draft.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder="ml" className={inputCls} />
              </label>
            )}
            {!isNew && (
              <label className="w-[110px]">
                <FieldLabel>State</FieldLabel>
                <select value={draft.active ? "active" : "disabled"} onChange={(e) => patch({ active: e.target.value === "active" })} className={inputCls}>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            )}
          </div>
          {!draft.active && !isNew && (
            <p className="text-10.5 text-dim">
              Disabled categories stay readable for historical items but are hidden from AddModal's "Choose a category" list — no new
              resource can be filed under this one until it is re-activated.
            </p>
          )}

          <section className="flex flex-col gap-6">
            <SectionTitle>When its parts break</SectionTitle>
            <div className="flex flex-wrap gap-8">
              {(["ANY_CRITICAL", "ALL_CRITICAL", "NEVER"] as ImpairRule[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => patch({ impairRule: r })}
                  className={`max-w-[260px] flex-1 text-left rounded-2 border px-10 py-8 text-11 ${draft.impairRule === r ? "border-accent bg-soft" : "border-border2 hover:bg-panel2"}`}
                >
                  <div className="font-semibold">{RULE_LABEL[r]}</div>
                  <div className="text-10 text-dim mt-2">{RULE_HELP[r]}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-6">
            <SectionTitle>Fields — the defined metrics</SectionTitle>
            {duplicateFieldKey && <ErrorNote>The field key "{duplicateFieldKey}" is used more than once.</ErrorNote>}
            <FieldsEditor fields={draft.fields} usage={fieldUsage} onUpdate={updateField} onAdd={addField} onRemove={removeField} />
          </section>

          <section className="flex flex-col gap-6">
            <SectionTitle>Made of — the default subtree</SectionTitle>
            <p className="text-10.5 text-dim">
              Creating one of these scaffolds all of this automatically. This only changes what gets built for NEW items — existing
              items keep whatever parts they already have.
            </p>
            <ChildrenEditor parts={draft.templateChildren} options={childOptions} onUpdate={updateChild} onAdd={addChild} onRemove={removeChild} />
          </section>

          <div className="flex items-center gap-10 pt-10 border-t border-border">
            {isNew ? (
              <Button variant="primary" disabled={!canSubmit || busy} onClick={createNow}>
                {busy ? "Creating…" : "Create category"}
              </Button>
            ) : (
              <Button variant="primary" disabled={!canSubmit || !dirty || busy} onClick={loadImpact}>
                {busy ? "Checking…" : "Review changes"}
              </Button>
            )}
            {!isNew && <span className="text-10.5 text-dim ml-auto">{usageCount} existing item{usageCount === 1 ? "" : "s"} use this category</span>}
          </div>

          {!isNew && (
            <div className="pt-10 border-t border-border">
              {deleteBlock ? (
                <div className="flex flex-col gap-8">
                  <ErrorNote>{deleteBlock.message}</ErrorNote>
                  <div className="flex items-center gap-8">
                    {deleteBlock.canConfirmTemplate && (
                      <Button variant="danger" disabled={busy} onClick={() => doDelete(true)}>
                        Delete anyway, and remove it from those subtrees
                      </Button>
                    )}
                    <Button disabled={busy} onClick={() => setDeleteBlock(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-8">
                  <Button variant="danger" disabled={busy || usageCount > 0} onClick={() => setConfirmingDelete(true)}>
                    Delete category
                  </Button>
                  {usageCount > 0 && <span className="text-10 text-faint">Blocked while items are filed under it.</span>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {reviewing && impact && (
        <div className="flex items-center gap-8 pt-10 border-t border-border">
          <Button onClick={() => setReviewing(false)} disabled={busy}>
            Back to editing
          </Button>
          <Button variant={impact.notes.some((n) => n.severity === "destructive") ? "danger" : "primary"} onClick={applyEdit} disabled={busy}>
            {busy ? "Applying…" : "Apply changes"}
          </Button>
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete category"
          message={
            <>
              Delete <b className="text-text">{category?.name}</b>? This cannot be undone.
            </>
          }
          tone="danger"
          confirmLabel="Delete"
          busy={busy}
          onConfirm={() => doDelete(false)}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────────────

const inputCls = "w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">{children}</div>;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-10 uppercase tracking-label text-faint font-semibold">{children}</div>;
}

function CategoryReadOnly({ category, usageCount }: { category: ResourceCategoryDto | null; usageCount: number }) {
  if (!category) return <p className="text-11 text-dim">Pick a category to inspect it.</p>;
  return (
    <div className="flex flex-col gap-14">
      <div className="flex items-center gap-10">
        <CategoryIcon iconKey={category.iconKey} className="size-20" />
        <div>
          <div className="text-13 font-semibold">{category.name}</div>
          <div className="text-10 text-faint font-mono">{category.key}</div>
        </div>
        {!category.active && <Tag>Disabled</Tag>}
      </div>
      <div className="flex flex-wrap gap-8">
        <Tag>{category.groupName}</Tag>
        <Tag>{category.countingMode === "SERIALIZED" ? "Individual units" : `Bulk${category.unit ? ` · ${category.unit}` : ""}`}</Tag>
        <Tag>{RULE_LABEL[category.impairRule]}</Tag>
        <Tag>{usageCount} item{usageCount === 1 ? "" : "s"}</Tag>
      </div>
      {category.fields.length > 0 && (
        <section className="flex flex-col gap-6">
          <SectionTitle>Fields</SectionTitle>
          <div className="flex flex-wrap gap-6">
            {category.fields.map((f) => (
              <Tag key={f.id}>
                {f.label} · {f.type.toLowerCase()}
                {f.unit ? ` (${f.unit})` : ""}
              </Tag>
            ))}
          </div>
        </section>
      )}
      {category.templateChildren.length > 0 && (
        <section className="flex flex-col gap-6">
          <SectionTitle>Made of</SectionTitle>
          <div className="flex flex-wrap gap-6">
            {category.templateChildren.map((c) => (
              <Tag key={c.id}>
                {c.qty} × {c.childCategoryName}
                {c.critical ? " (critical)" : ""}
              </Tag>
            ))}
          </div>
        </section>
      )}
      <p className="text-10 text-faint">Only SYS_ADMIN and PROPERTY_ADMIN may edit category definitions.</p>
    </div>
  );
}

function FieldsEditor({
  fields,
  usage,
  onUpdate,
  onAdd,
  onRemove,
}: {
  fields: FieldDraft[];
  usage: Record<string, number>;
  onUpdate: (i: number, p: Partial<FieldDraft>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {fields.map((f, i) => {
        const used = usage[f.key] ?? 0;
        return (
          <div key={i} className="flex flex-wrap items-end gap-6 border border-border2 rounded-2 p-8">
            <label className="w-[150px]">
              <FieldLabel>Label</FieldLabel>
              <input
                value={f.label}
                placeholder="Label"
                onChange={(e) => onUpdate(i, { label: e.target.value, key: f.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") })}
                className={inputCls}
              />
            </label>
            <label className="w-[120px]">
              <FieldLabel>Storage key</FieldLabel>
              <input
                value={f.key}
                placeholder="key"
                disabled={used > 0}
                title={used > 0 ? `${used} item${used === 1 ? "" : "s"} store a value under this key, so it cannot be renamed. Remove the field to drop it instead.` : "Storage key"}
                onChange={(e) => onUpdate(i, { key: e.target.value })}
                className={`${inputCls} font-mono disabled:opacity-50`}
              />
            </label>
            <label className="w-[110px]">
              <FieldLabel>Type</FieldLabel>
              <select value={f.type} onChange={(e) => onUpdate(i, { type: e.target.value as CategoryFieldType })} className={inputCls}>
                <option value="TEXT">Text</option>
                <option value="NUMBER">Number</option>
                <option value="ENUM">Choice</option>
                <option value="BOOLEAN">Yes/No</option>
              </select>
            </label>
            {f.type === "ENUM" && (
              <label className="min-w-[180px] flex-1">
                <FieldLabel>Options</FieldLabel>
                <input
                  value={f.options.join(", ")}
                  placeholder="Desktop, Laptop"
                  onChange={(e) => onUpdate(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  className={inputCls}
                />
              </label>
            )}
            {f.type === "NUMBER" && (
              <label className="w-[80px]">
                <FieldLabel>Unit</FieldLabel>
                <input value={f.unit} placeholder="GB" onChange={(e) => onUpdate(i, { unit: e.target.value })} className={inputCls} />
              </label>
            )}
            <label className="flex items-center gap-4 pb-6 text-10.5 text-dim">
              <input type="checkbox" checked={f.summary} onChange={(e) => onUpdate(i, { summary: e.target.checked })} />
              in summary
            </label>
            <label className="flex items-center gap-4 pb-6 text-10.5 text-dim">
              <input type="checkbox" checked={f.required} onChange={(e) => onUpdate(i, { required: e.target.checked })} />
              required
            </label>
            {used > 0 && <span className="text-9.5 text-dim font-mono pb-6">{used} in use</span>}
            <button type="button" onClick={() => onRemove(i)} className="text-10.5 text-bad ml-auto pb-6">
              Remove
            </button>
          </div>
        );
      })}
      <Button onClick={onAdd}>+ Add field</Button>
    </div>
  );
}

function ChildrenEditor({
  parts,
  options,
  onUpdate,
  onAdd,
  onRemove,
}: {
  parts: ChildDraft[];
  options: ResourceCategoryDto[];
  onUpdate: (i: number, p: Partial<ChildDraft>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {parts.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-6">
          <input type="number" min={1} value={c.qty} onChange={(e) => onUpdate(i, { qty: Math.max(1, Number(e.target.value) || 1) })} className={`${inputCls} w-[64px]`} />
          <span className="text-dim text-10.5">×</span>
          <select value={c.childCategoryId} onChange={(e) => onUpdate(i, { childCategoryId: e.target.value })} className={`${inputCls} w-[220px]`}>
            <option value="">Choose a category…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.groupName} · {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onUpdate(i, { critical: !c.critical })}
            title={c.critical ? "Breaking this part impairs the whole" : "Breaking this part does not impair the whole"}
            className={`text-9.5 font-semibold rounded-2 px-8 py-3 border ${c.critical ? "bg-warnbg text-warn border-warn" : "bg-panel2 text-dim border-border2"}`}
          >
            {c.critical ? "CRITICAL" : "optional"}
          </button>
          <button type="button" onClick={() => onRemove(i)} className="text-10.5 text-bad">
            Remove
          </button>
        </div>
      ))}
      <Button onClick={onAdd}>+ Add part</Button>
    </div>
  );
}

function ReviewPanel({
  impact,
  orphanKeys,
  purge,
  onPurge,
  note,
  onNote,
}: {
  impact: CategoryImpactDto;
  orphanKeys: string[];
  purge: boolean;
  onPurge: (v: boolean) => void;
  note: string;
  onNote: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-10">
      <div className="text-11 font-medium">
        Consequences ({impact.notes.length}) · reaches {impact.affectedItemCount} existing item{impact.affectedItemCount === 1 ? "" : "s"}
      </div>
      {impact.notes.length === 0 && <p className="text-10.5 text-dim">Nothing beyond the values you changed.</p>}
      <div className="flex flex-col gap-6">
        {impact.notes.map((n) => (
          <div key={n.id} className={`rounded-2 border px-10 py-8 text-10.5 ${SEVERITY_CLASS[n.severity]}`}>
            <span className="font-medium">{n.title}</span> — {n.detail}
          </div>
        ))}
      </div>

      {orphanKeys.length > 0 && (
        <label className="flex items-start gap-8 rounded-2 border border-bad bg-badbg p-10 cursor-pointer">
          <input type="checkbox" checked={purge} onChange={(e) => onPurge(e.target.checked)} className="mt-2" />
          <span className="text-10.5 text-bad">
            <strong>Also erase the stranded values</strong> stored under {orphanKeys.map((k) => (
              <code key={k} className="mx-2 rounded bg-bad/10 px-4 text-9.5">
                {k}
              </code>
            ))}
            . Leave this unticked to keep them dormant — they reappear if the field is added back with the same key.
          </span>
        </label>
      )}

      <label className="block">
        <FieldLabel>Reason (optional)</FieldLabel>
        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="Recorded against every entry this creates" className={inputCls} />
      </label>
    </div>
  );
}

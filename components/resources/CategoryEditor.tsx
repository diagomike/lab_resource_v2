"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  BookingMode,
  CategoryChangeDto,
  CategoryFieldType,
  CategoryGroupDto,
  CategoryImpactDto,
  CategoryImpactNote,
  CountingMode,
  CreateCategoryInput,
  ImpairRule,
  ItemPropValue,
  ResourceCategoryDto,
  SaveCategoryResultDto,
} from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button, ConfirmDialog, ErrorNote, Tag } from "@/components/ui";
import { CategoryIcon, IconPicker } from "./IconPicker";
import { CategoryChangeCard } from "./CategoryChangeCard";
import { couldNotLoad } from "@/components/toast";

// ── Words ───────────────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<CategoryFieldType, string> = { TEXT: "Text", NUMBER: "Number", ENUM: "Choice", BOOLEAN: "Yes / no", DATE: "Date" };
const RULE_LABEL: Record<ImpairRule, string> = {
  ANY_CRITICAL: "Out of order when any needed part fails",
  ALL_CRITICAL: "Out of order only when all needed parts fail",
  NEVER: "Never put out of order by its parts",
};
const RULE_HELP: Record<ImpairRule, string> = {
  ANY_CRITICAL: "A computer: a dead motherboard or monitor stops the machine.",
  ALL_CRITICAL: "Spares: two switches in a rack — either keeps the network up.",
  NEVER: "A bench or a cabinet: what sits in it doesn't break it.",
};
const BOOKING_LABEL: Record<BookingMode, string> = { NOT_BOOKABLE: "Not bookable", ROOM: "A bookable room", EQUIPMENT: "Bookable equipment" };
const BOOKING_HELP: Record<BookingMode, string> = {
  NOT_BOOKABLE: "Never on a calendar — parts, furniture, stock.",
  ROOM: "A space booked or timetabled; booking it claims what's inside.",
  EQUIPMENT: "A machine people book on its own.",
};
const SEVERITY_CLASS: Record<CategoryImpactNote["severity"], string> = {
  destructive: "bg-badbg text-bad border-bad",
  warning: "bg-warnbg text-warn border-warn",
  info: "bg-panel2 text-dim border-border2",
};

/** Details most equipment needs — one click each instead of retyping them every time. */
const COMMON_DETAILS: Array<Pick<FieldDraft, "label" | "type"> & Partial<FieldDraft>> = [
  { label: "Manufacturer", type: "TEXT" },
  { label: "Model", type: "TEXT", summary: true },
  { label: "Serial no.", type: "TEXT" },
  { label: "Asset tag", type: "TEXT", hint: "e.g. ASTU-00123" },
  { label: "Year acquired", type: "NUMBER" },
  { label: "Calibration due", type: "DATE" },
  { label: "Expiry", type: "DATE" },
  { label: "CAS no.", type: "TEXT", hint: "e.g. 64-17-5" },
  { label: "Notes", type: "TEXT", longText: true },
];

// ── The draft ───────────────────────────────────────────────────────────────────────

interface FieldDraft {
  /** React's key only. */
  uid: string;
  /** The detail's identity — set for details that exist; new ones get one on save. */
  key?: string;
  /** Its name as loaded — a change to it, on a detail with values, is asked about. */
  originalLabel?: string;
  /** The person said the new name is the same detail. */
  renameConfirmed?: boolean;
  /** Its kind of value as loaded. */
  originalType?: CategoryFieldType;
  label: string;
  type: CategoryFieldType;
  optionsText: string;
  unit: string;
  hint: string;
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
  name: string;
  description: string;
  iconKey: string;
  groupId: string;
  countingMode: CountingMode;
  unit: string;
  impairRule: ImpairRule;
  active: boolean;
  isPlace: boolean;
  bookingMode: BookingMode;
  publicListed: boolean;
  fields: FieldDraft[];
  templateChildren: ChildDraft[];
}

let uidSeq = 0;
const uid = () => `f${++uidSeq}`;
const optionsOf = (text: string) => [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];

function draftFrom(c: ResourceCategoryDto | null, defaultGroupId: string): Draft {
  if (!c) {
    return {
      name: "",
      description: "",
      iconKey: "Package",
      groupId: defaultGroupId,
      countingMode: "SERIALIZED",
      unit: "",
      impairRule: "ANY_CRITICAL",
      active: true,
      isPlace: false,
      bookingMode: "NOT_BOOKABLE",
      publicListed: false,
      fields: [],
      templateChildren: [],
    };
  }
  return {
    name: c.name,
    description: c.description ?? "",
    iconKey: c.iconKey,
    groupId: c.groupId,
    countingMode: c.countingMode,
    unit: c.unit ?? "",
    impairRule: c.impairRule,
    active: c.active,
    isPlace: c.isPlace,
    bookingMode: c.bookingMode,
    publicListed: c.publicListed,
    fields: c.fields.map((f) => ({
      uid: uid(),
      key: f.key,
      originalLabel: f.label,
      originalType: f.type,
      label: f.label,
      type: f.type,
      optionsText: f.options.join(", "),
      unit: f.unit ?? "",
      hint: f.hint ?? "",
      summary: f.summary,
      longText: f.longText,
      required: f.required,
    })),
    templateChildren: c.templateChildren.map((t) => ({ childCategoryId: t.childCategoryId, qty: t.qty, critical: t.critical })),
  };
}

function toInput(draft: Draft): CreateCategoryInput {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    iconKey: draft.iconKey,
    groupId: draft.groupId,
    countingMode: draft.countingMode,
    unit: draft.countingMode === "BULK" ? draft.unit.trim() || undefined : undefined,
    impairRule: draft.impairRule,
    isPlace: draft.isPlace,
    bookingMode: draft.countingMode === "SERIALIZED" ? draft.bookingMode : "NOT_BOOKABLE",
    publicListed: draft.publicListed,
    fields: draft.fields.map((f, i) => ({
      ...(f.key ? { key: f.key } : {}),
      label: f.label.trim(),
      type: f.type,
      options: f.type === "ENUM" ? optionsOf(f.optionsText) : [],
      unit: f.type === "NUMBER" ? f.unit.trim() || undefined : undefined,
      summary: f.summary,
      longText: f.type === "TEXT" && f.longText,
      required: f.required,
      sortOrder: i,
      hint: f.hint.trim() || null,
    })),
    templateChildren: draft.templateChildren.filter((c) => c.childCategoryId).map((c) => ({ childCategoryId: c.childCategoryId, qty: c.qty, critical: c.critical })),
  };
}

/** What the person chose in the review: where removed choices go, what fills a newly
 *  required detail, and whether leftovers are erased instead of kept. */
interface ReviewChoices {
  erase: boolean;
  fills: Record<string, string>;
  moves: Record<string, Record<string, string>>;
}
const NO_CHOICES: ReviewChoices = { erase: false, fills: {}, moves: {} };
const KEEP = "__keep__";

function typedFill(type: CategoryFieldType, raw: string): ItemPropValue {
  if (!raw.trim()) return null;
  if (type === "NUMBER") return Number(raw);
  if (type === "BOOLEAN") return raw === "true";
  return raw.trim();
}

interface FieldUsage {
  counts: Record<string, number>;
  values: Record<string, string[]>;
}

/**
 * The category editor. Custodians and heads add and change categories for their
 * department, the admin and Property Administration for the whole university; the
 * server decides (category-governance.ts) whether an edit applies at once — it only
 * adds — or waits for approval because it changes what items hold. The review step
 * shows which, before anything is saved.
 *
 * Nobody types a storage key; a renamed detail that holds values is asked about; a
 * retyped one converts its values (what can't be converted stays on each item as an
 * extra detail); a removed choice's values go where the person says; a detail made
 * required can be filled in on the items that lack it.
 */
export function CategoryEditor({
  category,
  groups,
  categories,
  usageCount,
  canEdit,
  isTop,
  focusChangeId,
  onSaved,
  onDeleted,
  onDirty,
  onOpen,
}: {
  category: ResourceCategoryDto | null;
  groups: CategoryGroupDto[];
  categories: ResourceCategoryDto[];
  usageCount: number;
  canEdit: boolean;
  /** The admin or Property Administration. */
  isTop: boolean;
  focusChangeId: string | null;
  onSaved: (categoryId: string) => void;
  onDeleted: () => void;
  onDirty: (dirty: boolean) => void;
  onOpen: (categoryId: string) => void;
}) {
  const { user, me } = useAuth();
  const isNew = category === null;
  const defaultGroup = groups[0]?.id ?? "";
  const [draft, setDraft] = useState<Draft>(() => draftFrom(category, defaultGroup));
  const [baseVersion, setBaseVersion] = useState(category?.version ?? 0);
  const [usage, setUsage] = useState<FieldUsage>({ counts: {}, values: {} });
  const [changes, setChanges] = useState<CategoryChangeDto[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [impact, setImpact] = useState<CategoryImpactDto | null>(null);
  const [choices, setChoices] = useState<ReviewChoices>(NO_CHOICES);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "warn"; text: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteBlock, setDeleteBlock] = useState<{ message: string; canConfirmTemplate: boolean } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const readOnly = !canEdit || (Boolean(category?.isPlace) && !isTop);

  function loadSide(id: string) {
    api.get<FieldUsage>(`/resources/categories/${id}/field-usage`).then(setUsage).catch(() => setUsage({ counts: {}, values: {} }));
    api
      .get<{ waiting: CategoryChangeDto[]; mine: CategoryChangeDto[] }>(`/resources/category-changes?category=${id}`)
      .then((r) => setChanges([...r.waiting, ...r.mine.filter((c) => c.status === "PENDING" || c.status === "STALE" || c.id === focusChangeId)]))
      .catch(couldNotLoad("this category's waiting changes", () => setChanges([])));
  }

  // Another category opened: start over.
  useEffect(() => {
    setNotice(null);
    setError(null);
    setConfirmingDelete(false);
    setDeleteBlock(null);
    if (category) loadSide(category.id);
    else {
      setUsage({ counts: {}, values: {} });
      setChanges([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category?.id]);

  // The category as saved changed (a save, a reload): the draft follows it.
  useEffect(() => {
    setDraft(draftFrom(category, defaultGroup));
    setBaseVersion(category?.version ?? 0);
    setReviewing(false);
    setImpact(null);
    setChoices(NO_CHOICES);
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category?.id, category?.version]);

  const dirty = useMemo(() => {
    if (isNew) return Boolean(draft.name.trim() || draft.fields.length);
    return JSON.stringify(toInput(draftFrom(category, defaultGroup))) !== JSON.stringify(toInput(draft));
  }, [draft, category, isNew, defaultGroup]);
  useEffect(() => onDirty(dirty && !readOnly), [dirty, readOnly, onDirty]);

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }
  function updateField(id: string, p: Partial<FieldDraft>) {
    setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.uid === id ? { ...f, ...p } : f)) }));
  }
  function addField(preset?: Partial<FieldDraft>) {
    setDraft((d) => ({
      ...d,
      fields: [...d.fields, { uid: uid(), label: "", type: "TEXT", optionsText: "", unit: "", hint: "", summary: false, longText: false, required: false, ...preset }],
    }));
  }
  function moveField(id: string, by: -1 | 1) {
    setDraft((d) => {
      const i = d.fields.findIndex((f) => f.uid === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= d.fields.length) return d;
      const fields = [...d.fields];
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...d, fields };
    });
  }
  /** "No — it's a new detail": the existing one keeps its name and values; the new
   *  name becomes a detail of its own. */
  function splitRename(id: string) {
    setDraft((d) => {
      const f = d.fields.find((x) => x.uid === id);
      if (!f) return d;
      const i = d.fields.indexOf(f);
      const fresh: FieldDraft = { ...f, uid: uid(), key: undefined, originalLabel: undefined, originalType: undefined, renameConfirmed: false };
      const kept: FieldDraft = { ...f, label: f.originalLabel ?? f.label, renameConfirmed: false };
      return { ...d, fields: [...d.fields.slice(0, i), kept, fresh, ...d.fields.slice(i + 1)] };
    });
  }
  function changeType(f: FieldDraft, type: CategoryFieldType) {
    const p: Partial<FieldDraft> = { type };
    // Text with values becoming a choice: start the options from the values in use.
    if (type === "ENUM" && !f.optionsText.trim() && f.key && usage.values[f.key]?.length) p.optionsText = usage.values[f.key].join(", ");
    updateField(f.uid, p);
  }

  const childOptions = useMemo(
    () => categories.filter((c) => c.id !== category?.id && !c.isPlace).sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name)),
    [categories, category?.id],
  );

  const openQuestions = draft.fields.filter((f) => f.key && (usage.counts[f.key] ?? 0) > 0 && f.originalLabel !== undefined && f.label.trim() !== f.originalLabel && !f.renameConfirmed);
  const sameLabels = useMemo(() => {
    const seen = new Set<string>();
    for (const f of draft.fields) {
      const k = f.label.trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) return f.label.trim();
      seen.add(k);
    }
    return null;
  }, [draft.fields]);
  const problems = [
    !draft.name.trim() && "Give the category a name.",
    draft.fields.some((f) => !f.label.trim()) && "Every detail needs a name.",
    sameLabels && `Two details are called “${sameLabels}”.`,
    draft.fields.some((f) => f.type === "ENUM" && optionsOf(f.optionsText).length === 0) && "A choice needs at least one option.",
    openQuestions.length > 0 && "Answer the question about the renamed detail first.",
  ].filter((x): x is string => Boolean(x));

  function scrollTop() {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function createNow() {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<ResourceCategoryDto>("/resources/categories", toInput(draft));
      onDirty(false);
      onSaved(created.id);
      onOpen(created.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create this category");
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<CategoryImpactDto>(`/resources/categories/${category.id}/impact`, toInput(draft));
      setImpact(result);
      setChoices(NO_CHOICES);
      setReviewing(true);
      scrollTop();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not check this change");
    } finally {
      setBusy(false);
    }
  }

  const orphanKeys = useMemo(() => [...new Set((impact?.notes ?? []).flatMap((n) => n.orphanKeys))], [impact]);

  async function save() {
    if (!category || !impact) return;
    setBusy(true);
    setError(null);
    const fills: Record<string, ItemPropValue> = {};
    for (const n of impact.notes) if (n.fill && choices.fills[n.fill.key]?.trim()) fills[n.fill.key] = typedFill(n.fill.type, choices.fills[n.fill.key]);
    const optionMoves: Record<string, Record<string, string | null>> = {};
    for (const n of impact.notes) {
      if (!n.optionMove) continue;
      const to = choices.moves[n.optionMove.key]?.[n.optionMove.option];
      (optionMoves[n.optionMove.key] ??= {})[n.optionMove.option] = to && to !== KEEP ? to : null;
    }
    try {
      const result = await api.patch<SaveCategoryResultDto>(`/resources/categories/${category.id}`, {
        ...toInput(draft),
        expectedVersion: baseVersion,
        purgeKeys: choices.erase ? orphanKeys : [],
        fills,
        optionMoves,
        note: note.trim() || undefined,
      });
      setNotice({ tone: result.status === "APPLIED" ? "good" : "warn", text: result.notice });
      onDirty(false);
      if (result.status === "PENDING") {
        setDraft(draftFrom(category, defaultGroup));
        setReviewing(false);
      }
      loadSide(category.id);
      onSaved(category.id);
      scrollTop();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.code === "VERSION_CONFLICT") {
        // Someone saved first: keep this person's draft and lay it over the category as it
        // is now, then review it again.
        const fresh = await api.get<ResourceCategoryDto>(`/resources/categories/${category.id}`).catch(() => null);
        if (fresh) setBaseVersion(fresh.version);
        setReviewing(false);
        setNotice({ tone: "warn", text: "Someone else changed this category while you were editing. Your changes are kept — review them again against the category as it is now." });
        scrollTop();
      } else setError(e instanceof ApiError ? e.message : "Could not save this category");
    } finally {
      setBusy(false);
    }
  }

  async function copyForMe() {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      const copy = await api.post<ResourceCategoryDto>(`/resources/categories/${category.id}/copy`, {});
      onDirty(false);
      onSaved(copy.id);
      onOpen(copy.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not make a copy");
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
      onDirty(false);
      onDeleted();
    } catch (e) {
      setConfirmingDelete(false);
      if (e instanceof ApiError && e.status === 409 && e.body?.code === "TEMPLATE_CHILD_IN_USE") setDeleteBlock({ message: e.message, canConfirmTemplate: true });
      else setDeleteBlock({ message: e instanceof ApiError ? e.message : "Could not remove this category", canConfirmTemplate: false });
    } finally {
      setBusy(false);
    }
  }

  const caps = me?.caps;
  const mayRemove = Boolean(category) && (isTop || category?.createdById === user?.id || Boolean(category?.stewardNodeId && caps?.headOf.includes(category.stewardNodeId)));

  const changeList = changes.length > 0 && (
    <section className="flex flex-col gap-8">
      <SectionTitle>Changes waiting for approval</SectionTitle>
      {changes.map((c) => (
        <CategoryChangeCard
          key={c.id}
          change={c}
          showCategoryLink={false}
          highlight={c.id === focusChangeId}
          onChanged={(next) => {
            setChanges((list) => list.map((x) => (x.id === next.id ? next : x)));
            if (next.status === "APPROVED") onSaved(next.categoryId);
          }}
        />
      ))}
    </section>
  );

  if (readOnly) {
    return (
      <div className="flex flex-col gap-14">
        {changeList}
        <CategoryReadOnly category={category} usageCount={usageCount} canEdit={canEdit} />
      </div>
    );
  }

  return (
    <div ref={topRef} className="flex flex-col gap-16 scroll-mt-16">
      {notice && (
        <div role="status" className={`rounded-2 border px-12 py-8 text-11.5 flex items-start gap-8 ${notice.tone === "good" ? "bg-goodbg border-good text-good" : "bg-warnbg border-warn text-warn"}`}>
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {changeList}

      {reviewing && impact ? (
        <ReviewPanel impact={impact} orphanKeys={orphanKeys} choices={choices} onChoices={setChoices} note={note} onNote={setNote} stewardName={category?.stewardName ?? ""} onCopy={copyForMe} busy={busy} />
      ) : (
        <>
          {category && (
            <div className="text-11 text-dim flex flex-wrap gap-x-12 gap-y-2">
              <span>
                Looked after by <strong className="text-text font-medium">{category.stewardName}</strong>
              </span>
              {category.createdByName && <span>made by {category.createdByName}</span>}
              <span>
                {usageCount} item{usageCount === 1 ? "" : "s"} filed under it
              </span>
            </div>
          )}
          {isNew && (
            <p className="text-11 text-dim">
              {isTop
                ? "A university-wide category, looked after by Property Administration."
                : "Your department looks after it: you and your head can change it, and your head is told it was added. It can be used straight away — inside labs and stores, and inside any thing that lists it under “Comes with”."}
            </p>
          )}

          <section className="flex flex-col gap-10">
            <div className="flex flex-wrap gap-10">
              <label className="w-[200px]">
                <FieldLabel>Icon</FieldLabel>
                <IconPicker value={draft.iconKey} onChange={(iconKey) => patch({ iconKey })} />
              </label>
              <label className="min-w-[220px] flex-1">
                <FieldLabel>Name</FieldLabel>
                <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Oscilloscope" className={inputCls} autoFocus={isNew} />
              </label>
              <label className="w-[190px]">
                <FieldLabel>Group</FieldLabel>
                <select value={draft.groupId} onChange={(e) => patch({ groupId: e.target.value })} className={inputCls}>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <FieldLabel>What it is for (optional)</FieldLabel>
              <input value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="e.g. Bench oscilloscopes for the electronics labs" className={inputCls} />
            </label>
            <div className="flex flex-wrap items-end gap-10">
              <fieldset className="flex flex-col gap-4">
                <legend className="sr-only">Counted as</legend>
                <FieldLabel>Counted as</FieldLabel>
                <div className="flex gap-6">
                  {(["SERIALIZED", "BULK"] as CountingMode[]).map((m) => (
                    <Choice key={m} on={draft.countingMode === m} onClick={() => patch({ countingMode: m })}>
                      {m === "SERIALIZED" ? "One by one (each has its own record)" : "A quantity (litres, boxes, pieces…)"}
                    </Choice>
                  ))}
                </div>
              </fieldset>
              {draft.countingMode === "BULK" && (
                <label className="w-[110px]">
                  <FieldLabel>Unit</FieldLabel>
                  <input value={draft.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder="ml, g, pcs" className={inputCls} />
                </label>
              )}
            </div>
            {isTop && (
              <fieldset className="flex flex-col gap-4">
                <FieldLabel>What it is</FieldLabel>
                <div className="flex flex-wrap gap-6">
                  <Choice on={!draft.isPlace} onClick={() => patch({ isPlace: false })}>
                    A thing — goes into labs and stores
                  </Choice>
                  <Choice on={draft.isPlace} onClick={() => patch({ isPlace: true, impairRule: "NEVER" })}>
                    A place — a lab, workshop, studio or store
                  </Choice>
                </div>
              </fieldset>
            )}
          </section>

          <section className="flex flex-col gap-8">
            <SectionTitle>Details to record</SectionTitle>
            <p className="text-11 text-dim -mt-4">What people fill in for each one — model, serial number, capacity. Details marked “in summary” show in the resources table.</p>
            <FieldsEditor
              fields={draft.fields}
              usage={usage.counts}
              onUpdate={updateField}
              onType={changeType}
              onRemove={(id) => patch({ fields: draft.fields.filter((f) => f.uid !== id) })}
              onMove={moveField}
              onConfirmRename={(id) => updateField(id, { renameConfirmed: true })}
              onSplitRename={splitRename}
            />
            <div className="flex flex-wrap items-center gap-8">
              <Button onClick={() => addField()}>+ Add a detail</Button>
              <select
                value=""
                aria-label="Add a common detail"
                onChange={(e) => {
                  const p = COMMON_DETAILS.find((c) => c.label === e.target.value);
                  if (p) addField({ ...p, optionsText: "", unit: p.unit ?? "", hint: p.hint ?? "" });
                }}
                className={`${inputCls} w-[200px]`}
              >
                <option value="">+ A common detail…</option>
                {COMMON_DETAILS.filter((c) => !draft.fields.some((f) => f.label.trim().toLowerCase() === c.label.toLowerCase())).map((c) => (
                  <option key={c.label} value={c.label}>
                    {c.label} ({TYPE_LABEL[c.type].toLowerCase()})
                  </option>
                ))}
              </select>
            </div>
          </section>

          {!draft.isPlace && (
            <section className="flex flex-col gap-8">
              <SectionTitle>Comes with</SectionTitle>
              <p className="text-11 text-dim -mt-4">
                Parts built in when one is added — a computer comes with a monitor, keyboard and mouse. Only these can go inside it later (RAM inside a motherboard). Items already recorded keep the parts they have.
              </p>
              <ChildrenEditor
                parts={draft.templateChildren}
                options={childOptions}
                onUpdate={(i, p) => patch({ templateChildren: draft.templateChildren.map((c, j) => (i === j ? { ...c, ...p } : c)) })}
                onAdd={() => patch({ templateChildren: [...draft.templateChildren, { childCategoryId: "", qty: 1, critical: false }] })}
                onRemove={(i) => patch({ templateChildren: draft.templateChildren.filter((_, j) => j !== i) })}
              />
            </section>
          )}

          <details className="flex flex-col gap-10 rounded-2 border border-border px-12 py-8">
            <summary className="cursor-pointer text-11 font-medium">More options — when it's out of order, booking, the public portal{isNew ? "" : ", in use or not"}</summary>
            <div className="flex flex-col gap-12 pt-10">
              {!draft.isPlace && draft.templateChildren.some((c) => c.critical) && (
                <fieldset className="flex flex-col gap-4">
                  <FieldLabel>If a needed part fails</FieldLabel>
                  <div className="flex flex-wrap gap-6">
                    {(["ANY_CRITICAL", "ALL_CRITICAL", "NEVER"] as ImpairRule[]).map((r) => (
                      <Choice key={r} on={draft.impairRule === r} onClick={() => patch({ impairRule: r })} help={RULE_HELP[r]}>
                        {RULE_LABEL[r]}
                      </Choice>
                    ))}
                  </div>
                </fieldset>
              )}
              <fieldset className="flex flex-col gap-4">
                <FieldLabel>Booking</FieldLabel>
                <div className="flex flex-wrap gap-6">
                  {(["NOT_BOOKABLE", "EQUIPMENT", ...(isTop || draft.bookingMode === "ROOM" ? (["ROOM"] as BookingMode[]) : [])] as BookingMode[]).map((mode) => (
                    <Choice key={mode} on={draft.bookingMode === mode} disabled={mode !== "NOT_BOOKABLE" && draft.countingMode !== "SERIALIZED"} onClick={() => patch({ bookingMode: mode })} help={BOOKING_HELP[mode]}>
                      {BOOKING_LABEL[mode]}
                    </Choice>
                  ))}
                </div>
                {draft.countingMode !== "SERIALIZED" && <p className="text-11 text-dim">Something counted as a quantity is never booked by time.</p>}
              </fieldset>
              <label className="flex items-center gap-6 text-11">
                <input type="checkbox" checked={draft.publicListed} onChange={(e) => patch({ publicListed: e.target.checked })} />
                Show how many working ones the university has on the public portal (a count only — never where they are)
              </label>
              {!isNew && (
                <label className="flex items-center gap-6 text-11">
                  <input type="checkbox" checked={!draft.active} onChange={(e) => patch({ active: !e.target.checked })} />
                  Not in use — hidden when adding resources; what is already recorded stays
                </label>
              )}
            </div>
          </details>

          {problems.length > 0 && dirty && <p className="text-11 text-warn">{problems[0]}</p>}
          <div className="flex flex-wrap items-center gap-10 pt-10 border-t border-border">
            {isNew ? (
              <Button variant="primary" disabled={problems.length > 0 || busy} onClick={createNow}>
                {busy ? "Adding…" : "Add category"}
              </Button>
            ) : (
              <Button variant="primary" disabled={problems.length > 0 || !dirty || busy} onClick={review}>
                {busy ? "Checking…" : "Review changes"}
              </Button>
            )}
            {!isNew && dirty && (
              <Button disabled={busy} onClick={() => setDraft(draftFrom(category, defaultGroup))}>
                Undo my edits
              </Button>
            )}
            {!isNew && !category?.isPlace && (
              <span className="ml-auto">
                <Button disabled={busy} onClick={copyForMe}>
                  Make a copy for my department
                </Button>
              </span>
            )}
          </div>

          {!isNew && mayRemove && (
            <div className="pt-10 border-t border-border">
              {deleteBlock ? (
                <div className="flex flex-col gap-8">
                  <ErrorNote>{deleteBlock.message}</ErrorNote>
                  <div className="flex items-center gap-8">
                    {deleteBlock.canConfirmTemplate && (
                      <Button variant="danger" disabled={busy} onClick={() => doDelete(true)}>
                        Remove it, and take it out of those
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
                    Remove category
                  </Button>
                  {usageCount > 0 && <span className="text-11 text-dim">It can be removed once nothing is filed under it — or mark it “Not in use” under More options.</span>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {reviewing && impact && (
        <div className="flex flex-wrap items-center gap-8 pt-10 border-t border-border">
          <Button onClick={() => setReviewing(false)} disabled={busy}>
            Back to editing
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || impact.notes.some((n) => n.severity === "destructive")}>
            {busy ? "Saving…" : impact.decision.applies ? "Save changes" : "Send for approval"}
          </Button>
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Remove category"
          message={
            <>
              Remove <b className="text-text">{category?.name}</b>? Nothing is filed under it; its history stays.
            </>
          }
          tone="danger"
          confirmLabel="Remove"
          busy={busy}
          onConfirm={() => doDelete(false)}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────────────

const inputCls = "w-full h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent";

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-11 uppercase tracking-label text-dim font-semibold mb-3">{children}</div>;
}
function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-11 uppercase tracking-label text-dim font-semibold">{children}</h3>;
}
function Choice({ on, onClick, children, help, disabled }: { on: boolean; onClick: () => void; children: ReactNode; help?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`max-w-[300px] text-left rounded-2 border px-10 py-6 text-11 disabled:opacity-40 ${on ? "border-accent bg-soft text-text" : "border-border2 hover:bg-panel2 text-dim"}`}
    >
      <span className="font-medium">{children}</span>
      {help && <span className="block text-11 text-dim mt-2">{help}</span>}
    </button>
  );
}

function CategoryReadOnly({ category, usageCount, canEdit }: { category: ResourceCategoryDto | null; usageCount: number; canEdit: boolean }) {
  if (!category) return <p className="text-11 text-dim">Pick a category to see it.</p>;
  return (
    <div className="flex flex-col gap-14">
      <div className="flex items-center gap-10">
        <CategoryIcon iconKey={category.iconKey} className="size-20" />
        <div>
          <div className="text-13 font-semibold">{category.name}</div>
          {category.description && <div className="text-11 text-dim">{category.description}</div>}
        </div>
        {!category.active && <Tag>Not in use</Tag>}
      </div>
      <div className="flex flex-wrap gap-8">
        <Tag>{category.groupName}</Tag>
        <Tag>{category.countingMode === "SERIALIZED" ? "One by one" : `A quantity${category.unit ? ` · ${category.unit}` : ""}`}</Tag>
        {category.isPlace && <Tag>A place</Tag>}
        {category.bookingMode !== "NOT_BOOKABLE" && <Tag>{BOOKING_LABEL[category.bookingMode]}</Tag>}
        {category.publicListed && <Tag>On the public portal</Tag>}
        <Tag>
          {usageCount} item{usageCount === 1 ? "" : "s"}
        </Tag>
      </div>
      {category.fields.length > 0 && (
        <section className="flex flex-col gap-6">
          <SectionTitle>Details to record</SectionTitle>
          <div className="flex flex-wrap gap-6">
            {category.fields.map((f) => (
              <Tag key={f.id}>
                {f.label} · {TYPE_LABEL[f.type].toLowerCase()}
                {f.unit ? ` (${f.unit})` : ""}
                {f.required ? " · required" : ""}
              </Tag>
            ))}
          </div>
        </section>
      )}
      {category.templateChildren.length > 0 && (
        <section className="flex flex-col gap-6">
          <SectionTitle>Comes with</SectionTitle>
          <div className="flex flex-wrap gap-6">
            {category.templateChildren.map((c) => (
              <Tag key={c.id}>
                {c.qty} × {c.childCategoryName}
                {c.critical ? " (needed)" : ""}
              </Tag>
            ))}
          </div>
        </section>
      )}
      <p className="text-11 text-dim">
        Looked after by {category.stewardName}.{" "}
        {category.isPlace && canEdit
          ? "Labs, workshops, studios and stores are kept by Property Administration — ask them for a change."
          : "Custodians and department heads add and change categories; ask the custodian of your lab."}
      </p>
    </div>
  );
}

function FieldsEditor({
  fields,
  usage,
  onUpdate,
  onType,
  onRemove,
  onMove,
  onConfirmRename,
  onSplitRename,
}: {
  fields: FieldDraft[];
  usage: Record<string, number>;
  onUpdate: (uid: string, p: Partial<FieldDraft>) => void;
  onType: (f: FieldDraft, type: CategoryFieldType) => void;
  onRemove: (uid: string) => void;
  onMove: (uid: string, by: -1 | 1) => void;
  onConfirmRename: (uid: string) => void;
  onSplitRename: (uid: string) => void;
}) {
  if (!fields.length) return <p className="text-11 text-dim">No details yet — add the ones people should fill in.</p>;
  return (
    <ol className="flex flex-col gap-6">
      {fields.map((f, i) => {
        const used = f.key ? (usage[f.key] ?? 0) : 0;
        const renamed = used > 0 && f.originalLabel !== undefined && f.label.trim() !== f.originalLabel && f.label.trim() !== "";
        return (
          <li key={f.uid} className="flex flex-col gap-6 border border-border2 rounded-2 p-8">
            <div className="flex flex-wrap items-end gap-8">
              <label className="min-w-[160px] flex-1">
                <FieldLabel>Name</FieldLabel>
                <input value={f.label} placeholder="e.g. Serial no." onChange={(e) => onUpdate(f.uid, { label: e.target.value, renameConfirmed: false })} className={inputCls} />
              </label>
              <label className="w-[120px]">
                <FieldLabel>Kind of value</FieldLabel>
                <select value={f.type} onChange={(e) => onType(f, e.target.value as CategoryFieldType)} className={inputCls}>
                  {(Object.keys(TYPE_LABEL) as CategoryFieldType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              {f.type === "ENUM" && (
                <label className="min-w-[200px] flex-1">
                  <FieldLabel>Options, separated by commas</FieldLabel>
                  <input value={f.optionsText} placeholder="Desktop, Laptop" onChange={(e) => onUpdate(f.uid, { optionsText: e.target.value })} className={inputCls} />
                </label>
              )}
              {f.type === "NUMBER" && (
                <label className="w-[90px]">
                  <FieldLabel>Unit</FieldLabel>
                  <input value={f.unit} placeholder="GB" onChange={(e) => onUpdate(f.uid, { unit: e.target.value })} className={inputCls} />
                </label>
              )}
              {(f.type === "TEXT" || f.type === "NUMBER") && (
                <label className="w-[150px]">
                  <FieldLabel>Example (optional)</FieldLabel>
                  <input value={f.hint} placeholder="e.g. 64-17-5" onChange={(e) => onUpdate(f.uid, { hint: e.target.value })} className={inputCls} />
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-12 text-11 text-dim">
              <label className="flex items-center gap-4">
                <input type="checkbox" checked={f.required} onChange={(e) => onUpdate(f.uid, { required: e.target.checked })} />
                Required
              </label>
              <label className="flex items-center gap-4">
                <input type="checkbox" checked={f.summary} onChange={(e) => onUpdate(f.uid, { summary: e.target.checked })} />
                In summary
              </label>
              {f.type === "TEXT" && (
                <label className="flex items-center gap-4">
                  <input type="checkbox" checked={f.longText} onChange={(e) => onUpdate(f.uid, { longText: e.target.checked })} />
                  Long text
                </label>
              )}
              {used > 0 && (
                <span>
                  {used} item{used === 1 ? " has" : "s have"} a value
                </span>
              )}
              {!f.key && <Tag tone="accent">New</Tag>}
              <span className="ml-auto flex items-center gap-8">
                <button type="button" disabled={i === 0} onClick={() => onMove(f.uid, -1)} aria-label={`Move ${f.label || "detail"} up`} className="disabled:opacity-30">
                  ↑
                </button>
                <button type="button" disabled={i === fields.length - 1} onClick={() => onMove(f.uid, 1)} aria-label={`Move ${f.label || "detail"} down`} className="disabled:opacity-30">
                  ↓
                </button>
                <button type="button" onClick={() => onRemove(f.uid)} className="text-bad">
                  Remove
                </button>
              </span>
            </div>
            {renamed && !f.renameConfirmed && (
              <div className="rounded-2 border border-warn bg-warnbg px-10 py-8 text-11 text-warn flex flex-col gap-6">
                <span>
                  {used} item{used === 1 ? " has" : "s have"} a value for “{f.originalLabel}”. Is “{f.label.trim()}” the same detail with a new name?
                </span>
                <span className="flex flex-wrap gap-6">
                  <Button onClick={() => onConfirmRename(f.uid)}>Yes — rename it, the values stay</Button>
                  <Button onClick={() => onSplitRename(f.uid)}>No — add “{f.label.trim()}” as a new detail</Button>
                </span>
              </div>
            )}
            {used > 0 && f.originalType && f.type !== f.originalType && (
              <p className="text-11 text-dim">
                The {used} value{used === 1 ? "" : "s"} recorded {used === 1 ? "is" : "are"} converted to {TYPE_LABEL[f.type].toLowerCase()} where {used === 1 ? "it reads as one" : "they read as one"} (“16 GB” → 16). Anything that doesn&apos;t stays on its item as an extra detail — the review lists them.
              </p>
            )}
          </li>
        );
      })}
    </ol>
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
          <input type="number" min={1} value={c.qty} aria-label="How many" onChange={(e) => onUpdate(i, { qty: Math.max(1, Number(e.target.value) || 1) })} className={`${inputCls} w-[64px]`} />
          <span className="text-dim text-11">×</span>
          <select value={c.childCategoryId} aria-label="Part" onChange={(e) => onUpdate(i, { childCategoryId: e.target.value })} className={`${inputCls} w-[240px]`}>
            <option value="">Choose a category…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.groupName} · {o.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-4 text-11 text-dim" title="When a needed part fails, this is out of order too">
            <input type="checkbox" checked={c.critical} onChange={(e) => onUpdate(i, { critical: e.target.checked })} />
            Needed for it to work
          </label>
          <button type="button" onClick={() => onRemove(i)} className="text-11 text-bad">
            Remove
          </button>
        </div>
      ))}
      <span>
        <Button onClick={onAdd}>+ Add a part</Button>
      </span>
    </div>
  );
}

function ReviewPanel({
  impact,
  orphanKeys,
  choices,
  onChoices,
  note,
  onNote,
  stewardName,
  onCopy,
  busy,
}: {
  impact: CategoryImpactDto;
  orphanKeys: string[];
  choices: ReviewChoices;
  onChoices: (c: ReviewChoices) => void;
  note: string;
  onNote: (v: string) => void;
  stewardName: string;
  onCopy: () => void;
  busy: boolean;
}) {
  const { decision } = impact;
  return (
    <div className="flex flex-col gap-12">
      <h3 className="text-13 font-semibold">Before you save</h3>
      <div className={`rounded-2 border px-12 py-10 text-11.5 flex flex-col gap-6 ${decision.applies ? "border-good bg-goodbg" : "border-warn bg-warnbg"}`}>
        {decision.applies ? (
          <strong className="text-good">{decision.reasons.length ? "You can make this change yourself." : "This only adds to the category — it applies as soon as you save."}</strong>
        ) : (
          <strong className="text-warn">This changes what items already hold, so it waits for approval: {decision.approvers.join(" → ")}.</strong>
        )}
        {decision.reasons.length > 0 && (
          <ul className="list-disc pl-16 text-text">
            {decision.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {decision.applies && !decision.reasons.length && <span className="text-dim">{stewardName} hears about it and can adjust it.</span>}
      </div>

      {decision.reaches.length > 0 && (
        <div className="rounded-2 border border-border2 bg-panel2 px-12 py-10 text-11.5 flex flex-col gap-8">
          <span>
            It changes items that <strong>{decision.reaches.join(", ")}</strong> also use. If only your department needs this, a separate category is usually better — copy this one and change the copy, and nobody else&apos;s records move.
          </span>
          <span>
            <Button onClick={onCopy} disabled={busy}>
              Make a copy for my department instead
            </Button>
          </span>
        </div>
      )}

      <div className="text-11 font-medium">
        What happens · reaches {impact.affectedItemCount} item{impact.affectedItemCount === 1 ? "" : "s"}
      </div>
      {impact.notes.length === 0 && <p className="text-11 text-dim">Nothing beyond what you changed.</p>}
      <div className="flex flex-col gap-6">
        {impact.notes.map((n) => (
          <div key={n.id} className={`rounded-2 border px-10 py-8 text-11 flex flex-col gap-4 ${SEVERITY_CLASS[n.severity]}`}>
            <span>
              <span className="font-semibold">{n.title}</span> — {n.detail}
            </span>
            {n.examples.length > 0 && <span className="text-11 opacity-90">For example: {n.examples.join("; ")}</span>}
            {n.optionMove && (
              <label className="flex flex-wrap items-center gap-6 text-text">
                Move them to
                <select
                  value={choices.moves[n.optionMove.key]?.[n.optionMove.option] ?? KEEP}
                  onChange={(e) =>
                    onChoices({ ...choices, moves: { ...choices.moves, [n.optionMove!.key]: { ...(choices.moves[n.optionMove!.key] ?? {}), [n.optionMove!.option]: e.target.value } } })
                  }
                  className={`${inputCls} w-[220px]`}
                >
                  <option value={KEEP}>Keep “{n.optionMove.option}” as an extra detail</option>
                  {n.optionMove.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {n.fill && (
              <label className="flex flex-wrap items-center gap-6 text-text">
                Fill the {n.fill.count} with
                <FillInput type={n.fill.type} options={n.fill.options} value={choices.fills[n.fill.key] ?? ""} onChange={(v) => onChoices({ ...choices, fills: { ...choices.fills, [n.fill!.key]: v } })} />
                <span className="text-11 text-dim">or leave it empty to keep them blank</span>
              </label>
            )}
          </div>
        ))}
      </div>

      {orphanKeys.length > 0 && (
        <label className="flex items-start gap-8 rounded-2 border border-border2 p-10 cursor-pointer text-11">
          <input type="checkbox" checked={choices.erase} onChange={(e) => onChoices({ ...choices, erase: e.target.checked })} className="mt-2" />
          <span>
            <strong className="text-bad">Erase those values instead</strong> of keeping them on each item as an extra detail. This can&apos;t be undone.
          </span>
        </label>
      )}

      <label className="block">
        <FieldLabel>Why (optional — shown in the history{decision.applies ? "" : " and to the approver"})</FieldLabel>
        <input value={note} onChange={(e) => onNote(e.target.value)} placeholder="e.g. Rooms are written like G16, so Room is text" className={inputCls} />
      </label>
    </div>
  );
}

function FillInput({ type, options, value, onChange }: { type: CategoryFieldType; options: string[]; value: string; onChange: (v: string) => void }) {
  if (type === "ENUM" || type === "BOOLEAN") {
    const opts = type === "BOOLEAN" ? [{ v: "true", l: "Yes" }, { v: "false", l: "No" }] : options.map((o) => ({ v: o, l: o }));
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} w-[200px]`}>
        <option value="">—</option>
        {opts.map((o) => (
          <option key={o.v} value={o.v}>
            {o.l}
          </option>
        ))}
      </select>
    );
  }
  return <input value={value} type={type === "NUMBER" ? "number" : type === "DATE" ? "date" : "text"} onChange={(e) => onChange(e.target.value)} className={`${inputCls} w-[200px]`} />;
}

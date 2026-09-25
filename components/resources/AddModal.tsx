"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import type { ContainerOptionDto, CustomProps, CustomPropType, ItemChangeInput, ItemChildDto, ItemDetailDto, ItemPropValue, ResourceCategoryDto } from "@/lib/shared";
import { CUSTOM_PROP_KEY_PATTERN, customPropTypes } from "@/lib/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useEditOptions } from "@/lib/register/useEditOptions";
import { Modal, Button, ErrorNote } from "@/components/ui";
import { previewItemChange, submitChange } from "@/lib/register/useItemChange";
import { CustomPropInput, PropInput } from "./Inspector";
import { CategoryIcon } from "./IconPicker";
import { TreePicker, containerTreeOptions } from "@/components/TreePicker";

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

function categoryLabel(category: ResourceCategoryDto): string {
  return `${category.groupName} · ${category.name}`;
}

/** Shadcn-style searchable combobox, expressed with this project's own tokens so it
 * fits the existing modal rather than introducing a second visual system. The input
 * is both the trigger and the search field: opening it shows every category, typing
 * narrows by category or group, and keyboard users can arrow/enter through results. */
export function CategoryCombobox({
  categories,
  value,
  loading,
  onChange,
  onAddCategory,
}: {
  categories: ResourceCategoryDto[];
  value: string;
  loading: boolean;
  onChange: (id: string) => void;
  onAddCategory: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [panelPosition, setPanelPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);

  const sorted = useMemo(
    () => categories.slice().sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name)),
    [categories],
  );
  const selected = sorted.find((category) => category.id === value) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return sorted;
    return sorted.filter((category) => categoryLabel(category).toLocaleLowerCase().includes(needle));
  }, [query, sorted]);

  useEffect(() => {
    if (!open) setQuery(selected ? categoryLabel(selected) : "");
  }, [open, selected]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  // The modal scrolls independently and therefore clips ordinary absolute children.
  // Position this like shadcn's portalled Popover: fixed against the trigger and
  // outside the modal's overflow boundary, recalculating on any scroll or resize.
  useEffect(() => {
    if (!open) {
      setPanelPosition(null);
      return;
    }
    function positionPanel() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 3;
      const edge = 12;
      const desiredHeight = 230;
      const below = window.innerHeight - rect.bottom - edge;
      const above = rect.top - edge;
      if (below >= 120 || below >= above) {
        setPanelPosition({ top: rect.bottom + gap, left: rect.left, width: rect.width, maxHeight: Math.max(96, Math.min(desiredHeight, below)) });
      } else {
        setPanelPosition({ bottom: window.innerHeight - rect.top + gap, left: rect.left, width: rect.width, maxHeight: Math.max(96, Math.min(desiredHeight, above)) });
      }
    }
    positionPanel();
    window.addEventListener("resize", positionPanel);
    document.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      document.removeEventListener("scroll", positionPanel, true);
    };
  }, [open]);

  function openList() {
    if (!open) {
      setQuery("");
      setOpen(true);
    }
  }

  function choose(category: ResourceCategoryDto) {
    onChange(category.id);
    setQuery(categoryLabel(category));
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      // An open list closes first; the dialog's own Escape then waits for the next press.
      if (open) event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openList();
        setActiveIndex(0);
        return;
      }
      openList();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openList();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className={`flex items-center rounded-2 border bg-panel ${open ? "border-accent" : "border-border2"}`}>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls="add-resource-category-options"
          aria-autocomplete="list"
          value={query}
          onFocus={openList}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
          onKeyDown={onKeyDown}
          placeholder={loading ? "Loading categories…" : "Search categories…"}
          className="h-24 min-w-0 flex-1 bg-transparent px-8 text-11 outline-none"
        />
        <button
          type="button"
          aria-label={open ? "Close category options" : "Open category options"}
          onClick={() => {
            if (open) setOpen(false);
            else {
              openList();
              inputRef.current?.focus();
            }
          }}
          className="grid h-24 w-28 place-items-center text-faint hover:text-text"
        >
          <ChevronsUpDown className="size-13" />
        </button>
      </div>

      {open && panelPosition &&
        createPortal(
          <div
            ref={panelRef}
            id="add-resource-category-options"
            role="listbox"
            className="fixed z-[70] overflow-y-auto rounded-2 border border-border2 bg-panel p-3"
            style={panelPosition}
          >
            {loading ? (
              <div className="px-8 py-8 text-10.5 text-faint">Loading categories…</div>
            ) : filtered.length > 0 ? (
              filtered.map((category, index) => (
                <button
                  key={category.id}
                  id={`add-resource-category-${category.id}`}
                  type="button"
                  role="option"
                  aria-selected={category.id === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(category)}
                  className={`flex w-full items-center gap-7 rounded-2 px-7 py-6 text-left text-11 ${index === activeIndex ? "bg-panel2" : "hover:bg-panel2"}`}
                >
                  <Check className={`size-12 flex-none ${category.id === value ? "text-accent" : "opacity-0"}`} />
                  <CategoryIcon iconKey={category.iconKey} className="size-13 flex-none text-dim" />
                  <span className="min-w-0 flex-1 truncate">{category.name}</span>
                  <span className="max-w-[45%] truncate text-10 text-faint">{category.groupName}</span>
                </button>
              ))
            ) : (
              <div className="p-5">
                <div className="px-3 pb-6 text-10.5 text-faint">No category found.</div>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onAddCategory}
                  className="flex w-full items-center gap-6 rounded-2 border border-border2 bg-panel2 px-8 py-6 text-left text-11 font-medium hover:border-accent hover:text-accent"
                >
                  <Plus className="size-13" />
                  Add category
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
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
 * anywhere, a CUSTODIAN/STORE_KEEPER at their own home unit with themselves as
 * custodian. A department head doesn't create resources (2026-09-22). The server re-checks all of this
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
  const router = useRouter();
  const { user, me } = useAuth();
  const editOptions = useEditOptions();
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [parent, setParent] = useState("");
  const [containers, setContainers] = useState<ContainerOptionDto[]>([]);
  const [containersLoading, setContainersLoading] = useState(false);
  const [count, setCount] = useState(1);
  const [ownerOrgNodeId, setOwnerOrgNodeId] = useState("");
  const [currentOrgNodeId, setCurrentOrgNodeId] = useState("");
  const [custodianId, setCustodianId] = useState("");
  /** Defaults to the category's own name, editable. The server numbers it against
   *  what is already in the destination ("Workstation 21…" after 01–20, gaps first —
   *  lib/domain/naming.ts). Reset whenever the category changes, same as `propDrafts`
   *  below: a name typed for one category has no meaning once another is chosen. */
  const [name, setName] = useState("");
  /** The "see it before it's created" step: the names the server would give, shown
   *  among what's already there. Null while editing the form. */
  const [preview, setPreview] = useState<{ names: string[]; rows: number; existing: ItemChildDto[]; input: ItemChangeInput } | null>(null);
  const [propDrafts, setPropDrafts] = useState<Record<string, string>>({});
  const [customPropDrafts, setCustomPropDrafts] = useState<Array<{ id: string; key: string; type: CustomPropType; value: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = user?.roles ?? [];
  const isSysAdmin = roles.includes("SYS_ADMIN");
  const isCustodianLike = roles.includes("CUSTODIAN") || roles.includes("STORE_KEEPER");
  const ownNodeId = me?.scope?.nodeId ?? null;
  const canAttemptRoot = isSysAdmin || (isCustodianLike && Boolean(ownNodeId));

  useEffect(() => {
    if (!open) return;
    setCategoryId("");
    setParent(defaultParentId ?? "");
    setContainers([]);
    setCount(1);
    setName("");
    setPreview(null);
    setPropDrafts({});
    setCustomPropDrafts([]);
    setError(null);
    setCategoriesLoading(true);
    setOwnerOrgNodeId(ownNodeId ?? "");
    setCurrentOrgNodeId(ownNodeId ?? "");
    setCustodianId(user?.id ?? "");
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then((rows) => setCategories(rows.filter((c) => c.active)))
      .catch(() => setCategories([]))
      .finally(() => setCategoriesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A property draft (and a typed name) only means something for the category it was
  // filled in against — never leave one sitting stale once a different category is
  // chosen, the same discipline the "Into" picker's own reset already follows.
  useEffect(() => {
    setName(categories.find((c) => c.id === categoryId)?.name ?? "");
    setPropDrafts({});
    setCustomPropDrafts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const containerOptions = useMemo(() => containerTreeOptions(containers), [containers]);
  const canOfferRoot = Boolean(selectedCategory?.canBeRoot) && canAttemptRoot;
  const isRootCreate = parent === "" && canOfferRoot;

  const templateRows = categoryId ? templateSize(categories, categoryId) : 0;

  const canSubmit =
    Boolean(categoryId) &&
    (parent !== "" || (canOfferRoot && (isCustodianLike && !isSysAdmin ? true : Boolean(ownerOrgNodeId) && Boolean(custodianId))));

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

  function buildCustomProps(): { data?: CustomProps; message?: string } {
    if (!selectedCategory || customPropDrafts.length === 0) return {};
    const data: CustomProps = {};
    const normalizedKeys = new Map<string, string>();
    for (const field of selectedCategory.fields) {
      normalizedKeys.set(field.key.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ""), field.key);
    }

    for (const draft of customPropDrafts) {
      const key = draft.key.trim();
      if (!key) return { message: "Give every optional property a name." };
      if (!CUSTOM_PROP_KEY_PATTERN.test(key)) {
        return { message: `“${key}” must use letters, numbers, spaces, - or _, starting with a letter.` };
      }
      const normalized = key.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
      const collision = normalizedKeys.get(normalized);
      if (collision) return { message: `“${key}” duplicates or conflicts with “${collision}”.` };

      let value: ItemPropValue = draft.value === "" ? null : draft.value;
      if (draft.type === "NUMBER" && draft.value !== "") {
        const number = Number(draft.value);
        if (!Number.isFinite(number)) return { message: `Give “${key}” a valid number.` };
        value = number;
      }
      if (draft.type === "BOOLEAN" && draft.value !== "") value = draft.value === "true";
      data[key] = { type: draft.type, value };
      normalizedKeys.set(normalized, key);
    }
    return { data };
  }

  function buildInput(): { input?: ItemChangeInput; message?: string } {
    const props = buildProps();
    const customProps = buildCustomProps();
    if (customProps.message) return { message: customProps.message };
    return {
      input: {
        kind: "createItem",
        parentId: parent || null,
        categoryId,
        count,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(props ? { props } : {}),
        ...(customProps.data ? { customProps: customProps.data } : {}),
        ...(isRootCreate
          ? {
              ownerOrgNodeId,
              currentOrgNodeId: currentOrgNodeId || ownerOrgNodeId,
              custodianId,
            }
          : {}),
      },
    };
  }

  /** Step 1 — a dry run: the server validates everything and reports the names it
   *  would give; nothing is created. */
  async function showPreview() {
    if (!categoryId || !canSubmit) return;
    const built = buildInput();
    if (!built.input) return setError(built.message ?? "Check the form.");
    setBusy(true);
    setError(null);
    const r = await previewItemChange(built.input);
    let existing: ItemChildDto[] = [];
    if (r.ok && parent) {
      existing = await api
        .get<ItemDetailDto>(`/resources/items/${parent}`)
        .then((d) => d.children)
        .catch(() => []);
    }
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setPreview({ names: r.result.plannedNames ?? [], rows: r.result.rows ?? 0, existing, input: built.input });
  }

  /** Step 2 — apply exactly what was previewed. */
  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const r = await submitChange(preview.input);
    setBusy(false);
    if (!r.ok) {
      setPreview(null);
      setError(r.message);
      return;
    }
    onCreated();
    onClose();
  }

  if (!open) return null;

  if (preview) {
    const destinationName = parent ? (containers.find((c) => c.id === parent)?.name ?? "the chosen place") : "the top level";
    return (
      <Modal title="Preview — Add resources" onClose={onClose} width="480px">
        {error && <ErrorNote>{error}</ErrorNote>}
        <p className="text-10.5 text-dim">
          Adds <strong className="text-text">{preview.names.length}</strong> × {selectedCategory?.name} to <strong className="text-text">{destinationName}</strong>
          {preview.rows > preview.names.length ? ` — ${preview.rows} rows in total, parts included` : ""}. New rows are highlighted among what&apos;s already there.
        </p>
        <PreviewList existing={preview.existing} added={preview.names} iconKey={selectedCategory?.iconKey} />
        <div className="flex items-center gap-8">
          <Button variant="primary" disabled={busy} onClick={apply}>
            {busy ? "Creating…" : `Apply — create ${preview.names.length}`}
          </Button>
          <Button onClick={() => setPreview(null)} disabled={busy}>
            Back
          </Button>
        </div>
      </Modal>
    );
  }

  const ownerNodeName = editOptions.owner.find((o) => o.value === ownNodeId)?.label ?? "your unit";

  return (
    <Modal title="Add resources" onClose={onClose} width="480px">
      {error && <ErrorNote>{error}</ErrorNote>}
      <label className="block">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Category</div>
        <CategoryCombobox
          categories={categories}
          value={categoryId}
          loading={categoriesLoading}
          onChange={setCategoryId}
          onAddCategory={() => {
            onClose();
            router.push("/categories");
          }}
        />
      </label>
      {categoryId && (
        <label className="block">
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Into</div>
          <TreePicker
            options={containerOptions}
            value={parent}
            onChange={setParent}
            loading={containersLoading}
            noneLabel={canOfferRoot ? "Top level (a new lab, store, building…)" : undefined}
            placeholder="Choose where it goes…"
          />
          {!containersLoading && !canOfferRoot && containers.length === 0 && (
            <div className="text-10.5 text-warn mt-4">You have no container in your custody that this category may be placed into.</div>
          )}
        </label>
      )}
      {isRootCreate && (
        <div className="flex flex-col gap-8 rounded-2 border border-border2 p-10">
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold">A new top-level resource needs</div>
          {isCustodianLike && !isSysAdmin ? (
            <p className="text-10.5 text-dim">
              Owning unit: <strong className="text-text">{ownerNodeName}</strong> · Custodian: <strong className="text-text">you</strong>
            </p>
          ) : (
            <>
              <label className="block">
                <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Owning unit</div>
                <TreePicker options={editOptions.unitTree(editOptions.owner)} value={ownerOrgNodeId} onChange={setOwnerOrgNodeId} placeholder="Choose a unit…" />
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
                <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">{f.unit ? `${f.label} (${f.unit})` : f.label}{f.required ? " *" : ""}</div>
                <PropInput field={f} value={propDrafts[f.key] ?? ""} onChange={(v) => setPropDrafts((d) => ({ ...d, [f.key]: v }))} onCommit={() => {}} />
              </label>
            ))}
          </div>
        </div>
      )}
      {selectedCategory && (
        <div>
          <div className="flex items-center justify-between gap-8 mb-6">
            <div>
              <div className="text-9.5 uppercase tracking-label text-faint font-semibold">Optional properties</div>
              <div className="text-10 text-faint mt-2">Item-specific fields applied to every resource in this batch.</div>
            </div>
            <button
              type="button"
              onClick={() =>
                setCustomPropDrafts((drafts) => [
                  ...drafts,
                  { id: `${Date.now()}-${Math.random()}`, key: "", type: "TEXT", value: "" },
                ])
              }
              className="flex items-center gap-5 text-10.5 text-accent hover:text-accent2"
            >
              <Plus className="size-12" />
              Add field
            </button>
          </div>
          {customPropDrafts.length > 0 && (
            <div className="flex flex-col gap-6">
              {customPropDrafts.map((draft) => (
                <div key={draft.id} className="grid grid-cols-[minmax(0,1fr)_100px_minmax(0,1fr)_24px] items-end gap-6 rounded-2 border border-border2 p-8">
                  <label className="min-w-0">
                    <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Key</div>
                    <input
                      value={draft.key}
                      onChange={(event) =>
                        setCustomPropDrafts((drafts) => drafts.map((row) => (row.id === draft.id ? { ...row, key: event.target.value } : row)))
                      }
                      placeholder="e.g. Local code"
                      className="w-full h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                    />
                  </label>
                  <label>
                    <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Type</div>
                    <select
                      value={draft.type}
                      onChange={(event) =>
                        setCustomPropDrafts((drafts) =>
                          drafts.map((row) =>
                            row.id === draft.id ? { ...row, type: event.target.value as CustomPropType, value: "" } : row,
                          ),
                        )
                      }
                      className="w-full h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                    >
                      {customPropTypes.map((type) => (
                        <option key={type} value={type}>
                          {type === "TEXT" ? "Text" : type === "NUMBER" ? "Number" : "Yes/No"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-0">
                    <div className="text-9.5 uppercase tracking-label text-faint font-semibold mb-3">Value</div>
                    <CustomPropInput
                      type={draft.type}
                      value={draft.value}
                      onChange={(value) =>
                        setCustomPropDrafts((drafts) => drafts.map((row) => (row.id === draft.id ? { ...row, value } : row)))
                      }
                      onCommit={() => {}}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${draft.key || "optional property"}`}
                    title="Remove optional property"
                    onClick={() => setCustomPropDrafts((drafts) => drafts.filter((row) => row.id !== draft.id))}
                    className="grid size-24 place-items-center rounded-2 text-faint hover:bg-badbg hover:text-bad"
                  >
                    <Trash2 className="size-12" />
                  </button>
                </div>
              ))}
            </div>
          )}
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
          {templateRows > 1 && (
            <>
              , each with its full default subtree — <strong className="text-text font-mono">{count * templateRows}</strong> rows in total.
            </>
          )}
        </p>
      )}
      <div className="flex items-center gap-8">
        <Button variant="primary" disabled={!canSubmit || busy} onClick={showPreview}>
          {busy ? "Checking…" : "Preview…"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

/** The destination's contents after the change: existing children as they are, the new
 *  names highlighted, all in natural order ("Workstation 2" before "Workstation 10"). */
function PreviewList({ existing, added, iconKey }: { existing: ItemChildDto[]; added: string[]; iconKey?: string }) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const rows = [
    ...existing.map((c) => ({ key: c.id, name: c.name, iconKey: c.categoryIconKey, isNew: false })),
    ...added.map((n, i) => ({ key: `new-${i}`, name: n, iconKey, isNew: true })),
  ].sort((a, b) => collator.compare(a.name, b.name));
  return (
    <div className="max-h-[320px] overflow-y-auto rounded-2 border border-border2">
      {rows.map((r) => (
        <div
          key={r.key}
          className={`flex items-center gap-7 border-b border-border px-9 py-5 text-11 last:border-0 ${r.isNew ? "bg-goodbg text-text" : "text-dim"}`}
        >
          <CategoryIcon iconKey={r.iconKey} className="size-12 flex-none" />
          <span className="min-w-0 flex-1 truncate">{r.name}</span>
          {r.isNew && <span className="text-9.5 font-semibold uppercase tracking-label text-good">new</span>}
        </div>
      ))}
    </div>
  );
}

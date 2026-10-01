"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryFieldDto, PlaceCustodianDto, PlaceDto, PlaceOptionsDto, ResourceCategoryDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Modal } from "@/components/ui";
import { CategoryIcon } from "@/components/resources/IconPicker";

const inputCls = "h-28 w-full px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent";
const labelCls = "text-10 uppercase tracking-label text-dim font-semibold";

/** A place's details, as text the form edits; typed again by `typedProps`. */
export type DetailDraft = Record<string, string>;

export function draftFromProps(fields: CategoryFieldDto[], props: Record<string, string | number | boolean | null>): DetailDraft {
  return Object.fromEntries(fields.map((f) => [f.key, props[f.key] === null || props[f.key] === undefined ? "" : String(props[f.key])]));
}

export function typedProps(fields: CategoryFieldDto[], draft: DetailDraft): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const f of fields) {
    const raw = (draft[f.key] ?? "").trim();
    if (!raw) out[f.key] = null;
    else if (f.type === "NUMBER") out[f.key] = Number(raw);
    else if (f.type === "BOOLEAN") out[f.key] = raw === "true";
    else out[f.key] = raw;
  }
  return out;
}

/** The missing required details, by label — said before saving rather than after. */
export function missingRequired(fields: CategoryFieldDto[], draft: DetailDraft): string[] {
  return fields.filter((f) => f.required && !(draft[f.key] ?? "").trim()).map((f) => f.label);
}

/** One input per detail the kind of place defines (block, room, seats, purpose…). */
export function DetailFields({ fields, draft, onChange }: { fields: CategoryFieldDto[]; draft: DetailDraft; onChange: (d: DetailDraft) => void }) {
  if (!fields.length) return null;
  const set = (key: string, value: string) => onChange({ ...draft, [key]: value });
  return (
    <div className="grid gap-10 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.key} className={`flex flex-col gap-4 ${f.longText ? "sm:col-span-2" : ""}`}>
          <span className={labelCls}>
            {f.label}
            {f.unit ? ` (${f.unit})` : ""}
            {f.required ? "" : " — optional"}
          </span>
          {f.type === "ENUM" ? (
            <select value={draft[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} className={inputCls}>
              <option value="">—</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : f.type === "BOOLEAN" ? (
            <select value={draft[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} className={inputCls}>
              <option value="">—</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : f.longText ? (
            <textarea value={draft[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} rows={2} className={`${inputCls} h-auto py-6`} />
          ) : (
            <input value={draft[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} type={f.type === "NUMBER" ? "number" : f.type === "DATE" ? "date" : "text"} placeholder={f.hint ?? undefined} className={inputCls} />
          )}
        </label>
      ))}
    </div>
  );
}

/** Who runs a place of this unit: its custodians, with how many places each runs now. */
export function CustodianPicker({ unitId, value, onChange }: { unitId: string; value: string; onChange: (id: string) => void }) {
  const [people, setPeople] = useState<PlaceCustodianDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!unitId) return;
    let live = true;
    setPeople(null);
    setError(null);
    api
      .get<PlaceCustodianDto[]>(`/places/custodians?unit=${encodeURIComponent(unitId)}`)
      .then((rows) => live && setPeople(rows))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Could not load this unit's custodians"));
    return () => {
      live = false;
    };
  }, [unitId]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (people === null) return <div className="text-11 text-faint">Loading the unit&apos;s custodians…</div>;
  if (!people.length)
    return <div className="text-11 text-warn">Nobody in this unit is a custodian yet. Add one under People &amp; roles first.</div>;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      <option value="">Choose who runs it…</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.title ? ` — ${p.title}` : ""}
          {p.runs ? ` · runs ${p.runs} already` : ""}
        </option>
      ))}
    </select>
  );
}

/** "Add a lab or store": the kind, the unit (when the person manages several), its name
 *  and details, and who runs it. The new place opens once created. */
export function AddPlaceModal({ options, categories, onClose }: { options: PlaceOptionsDto; categories: ResourceCategoryDto[]; onClose: () => void }) {
  const router = useRouter();
  const [kindId, setKindId] = useState(options.kinds.find((k) => k.key === "lab")?.id ?? options.kinds[0]?.id ?? "");
  const [unitId, setUnitId] = useState(options.units[0]?.id ?? "");
  const [name, setName] = useState("");
  const [details, setDetails] = useState<DetailDraft>({});
  const [custodianId, setCustodianId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(() => categories.find((c) => c.id === kindId)?.fields ?? [], [categories, kindId]);
  const missing = missingRequired(fields, details);
  const ready = kindId && unitId && name.trim() && custodianId && !missing.length;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const place = await api.post<PlaceDto>("/places", { categoryId: kindId, name: name.trim(), ownerOrgNodeId: unitId, custodianId, props: typedProps(fields, details) });
      router.push(`/places/${place.id}?created=1`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create this place");
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a lab or store" onClose={onClose} width="560px">
      <form
        className="flex flex-col gap-14"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void create();
        }}
      >
        <fieldset className="flex flex-col gap-6">
          <legend className={`${labelCls} mb-4`}>What kind of place</legend>
          <div className="flex flex-wrap gap-8">
            {options.kinds.map((k) => (
              <label key={k.id} className={`flex items-center gap-6 cursor-pointer rounded-2 border px-10 py-7 text-11.5 ${kindId === k.id ? "border-accent bg-soft" : "border-border2 hover:bg-panel2"}`}>
                <input type="radio" name="kind" value={k.id} checked={kindId === k.id} onChange={() => (setKindId(k.id), setDetails({}))} className="sr-only" />
                <CategoryIcon iconKey={k.iconKey} className="size-14" />
                {k.name}
              </label>
            ))}
          </div>
        </fieldset>
        {options.units.length > 1 && (
          <label className="flex flex-col gap-4">
            <span className={labelCls}>Belongs to</span>
            <select value={unitId} onChange={(e) => (setUnitId(e.target.value), setCustodianId(""))} className={inputCls}>
              {options.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-4">
          <span className={labelCls}>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Software Laboratory — B510-R8" className={inputCls} />
        </label>
        <DetailFields fields={fields} draft={details} onChange={setDetails} />
        <label className="flex flex-col gap-4">
          <span className={labelCls}>Who runs it (its custodian)</span>
          <CustodianPicker unitId={unitId} value={custodianId} onChange={setCustodianId} />
          <span className="text-10.5 text-dim">They are told, and they add and change what it holds; you approve their changes.</span>
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        {missing.length > 0 && name.trim() && <div className="text-10.5 text-warn">Still needed: {missing.join(", ")}.</div>}
        <div className="flex items-center gap-8">
          <Button type="submit" variant="primary" disabled={!ready || busy}>
            {busy ? "Creating…" : "Create"}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

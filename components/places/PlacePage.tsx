"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { LabStatesDto, PlaceDto, ResourceCategoryDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Button, ConfirmDialog, ErrorNote, Modal, Screen, Tag } from "@/components/ui";
import { InlineError, PanelLoading } from "@/components/states";
import { CategoryIcon } from "@/components/resources/IconPicker";
import { useShellHeader } from "@/app/(workspace)/layout";
import { CustodianPicker, DetailFields, draftFromProps, missingRequired, typedProps, type DetailDraft } from "./PlaceForms";
import { DraftTag } from "./PlacesPage";
import { LAB_TABS, LabView, type LabTab } from "./LabView";
import { couldNotLoad, toast } from "@/components/toast";

const inputCls = "h-28 w-full px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent";
const labelCls = "text-11 uppercase tracking-label text-dim font-semibold";

/**
 * One lab or store: its details and who runs it (changed here by whoever manages the
 * unit's places), then what it holds and its changes (the custodian's work).
 */
function PlaceInner({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (LAB_TABS.find((t) => t.key === params.get("tab"))?.key ?? "current") as LabTab;
  const focusItem = params.get("item");
  const [place, setPlace] = useState<PlaceDto | null>(null);
  const [states, setStates] = useState<LabStatesDto | null>(null);
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<"details" | "custodian" | "remove" | null>(null);
  const [notice, setNotice] = useState<string | null>(params.get("created") ? "Created. Its custodian has been told." : null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.get<PlaceDto>(`/places/${id}`), api.get<LabStatesDto>(`/resources/labs/${id}/states`)])
      .then(([p, s]) => {
        setPlace(p);
        setStates(s);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this lab"));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    api.get<ResourceCategoryDto[]>("/resources/categories").then(setCategories).catch(couldNotLoad("the categories", () => setCategories([])));
  }, []);
  useShellHeader({ crumb: "Labs & stores ›", title: place?.name ?? "", subtitle: place ? `${place.categoryName} · ${place.ownerOrgNodeName}` : "" }, [place?.name, place?.categoryName, place?.ownerOrgNodeName]);

  const fields = useMemo(() => categories.find((c) => c.id === place?.categoryId)?.fields ?? [], [categories, place?.categoryId]);

  function go(patch: Record<string, string | null>) {
    const qp = new URLSearchParams(params.toString());
    qp.delete("created");
    for (const [k, v] of Object.entries(patch)) (v === null ? qp.delete(k) : qp.set(k, v));
    router.replace(`${pathname}?${qp.toString()}`, { scroll: false });
  }

  if (error) {
    return (
      <Screen>
        <InlineError message={error} onRetry={load} />
        <Link href="/places" className="text-11.5 text-accent">
          ← All labs & stores
        </Link>
      </Screen>
    );
  }
  if (!place || !states) {
    return (
      <Screen>
        <PanelLoading rows={6} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Link href="/places" className="text-11 text-accent self-start">
        ← All labs & stores
      </Link>
      {notice && (
        <div role="status" className="bg-goodbg border border-good text-good rounded-2 px-12 py-8 text-11.5 flex items-center gap-8">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-good">
            ×
          </button>
        </div>
      )}

      <section className="bg-panel border border-border rounded-3 px-14 py-12 flex flex-col gap-10">
        <div className="flex flex-wrap items-start gap-10">
          <CategoryIcon iconKey={place.categoryIconKey} className="size-20 text-dim mt-2" />
          <div className="flex-1 min-w-[220px]">
            <h2 className="text-15 font-semibold">{place.name}</h2>
            <div className="text-11 text-dim mt-2">
              {place.categoryName} · {place.ownerOrgNodeName} · run by <strong className="text-text font-medium">{place.isMine ? "you" : place.custodianName}</strong> · changes approved by{" "}
              {states.lab.approverLabel === "the head" ? "the head, " : "Property Administration, "}
              {states.lab.headName ?? <span className="text-warn">vacant</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            {place.needsAttention > 0 && <Tag tone="bad">{place.needsAttention} need attention</Tag>}
            <DraftTag status={place.draftStatus} />
            {place.bookable && (
              <Link href={`/schedule?lab=${place.id}`} className="text-11 text-accent hover:underline">
                Its calendar →
              </Link>
            )}
          </div>
        </div>
        {fields.length > 0 && (
          <dl className="grid gap-x-16 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
            {fields.map((f) => (
              <div key={f.key} className="flex flex-col">
                <dt className="text-11 uppercase tracking-label text-dim">{f.label}</dt>
                <dd className="text-12">
                  {place.props[f.key] === null || place.props[f.key] === undefined || place.props[f.key] === "" ? <span className="text-faint">–</span> : String(place.props[f.key])}
                  {f.unit && place.props[f.key] ? ` ${f.unit}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {(place.canManage || place.canAssign) && (
          <div className="flex flex-wrap items-center gap-8 pt-8 border-t border-border">
            {place.canManage && <Button onClick={() => setEditing("details")}>Edit name and details</Button>}
            <Button onClick={() => setEditing("custodian")}>{place.isStore ? "Change its store keeper" : "Change who runs it"}</Button>
            {place.canManage && (
              <Button variant="danger" disabled={place.itemCount > 0} onClick={() => setEditing("remove")}>
                Remove
              </Button>
            )}
            {place.canManage && place.itemCount > 0 && <span className="text-11 text-dim">A place can be removed once it is empty.</span>}
          </div>
        )}
      </section>

      <LabView states={states} tab={tab} onTab={(t) => go({ tab: t, item: null })} focusItem={focusItem} onChanged={load} />

      {editing === "details" && (
        <EditDetailsModal
          place={place}
          fields={fields}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice("Saved.");
            load();
          }}
        />
      )}
      {editing === "custodian" && (
        <ChangeCustodianModal
          place={place}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setNotice(`${name} now runs ${place.name}. Both of you have been told.`);
            load();
          }}
        />
      )}
      {editing === "remove" && <RemovePlaceDialog place={place} onClose={() => setEditing(null)} onRemoved={() => router.push("/places")} />}
    </Screen>
  );
}

function EditDetailsModal({ place, fields, onClose, onSaved }: { place: PlaceDto; fields: ResourceCategoryDto["fields"]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(place.name);
  const [details, setDetails] = useState<DetailDraft>(() => draftFromProps(fields, place.props));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = missingRequired(fields, details);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/places/${place.id}`, { name: name.trim(), props: typedProps(fields, details) });
      toast.success(`Saved ${name.trim()}`);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit ${place.name}`} onClose={onClose} width="520px" dirty={name !== place.name || JSON.stringify(details) !== JSON.stringify(draftFromProps(fields, place.props))}>
      <form
        className="flex flex-col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !missing.length) void save();
        }}
      >
        <label className="flex flex-col gap-4">
          <span className={labelCls}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <DetailFields fields={fields} draft={details} onChange={setDetails} />
        {missing.length > 0 && <div className="text-11 text-warn">Still needed: {missing.join(", ")}.</div>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center gap-8">
          <Button type="submit" variant="primary" disabled={busy || !name.trim() || missing.length > 0}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ChangeCustodianModal({ place, onClose, onSaved }: { place: PlaceDto; onClose: () => void; onSaved: (name: string) => void }) {
  const [custodianId, setCustodianId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<PlaceDto>(`/places/${place.id}`, { custodianId, note: note.trim() || undefined });
      toast.success(`${updated.custodianName} now runs ${place.name}. Both of you were told.`);
      onSaved(updated.custodianName);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the custodian");
      setBusy(false);
    }
  }

  return (
    <Modal title={`Who runs ${place.name}`} onClose={onClose} width="480px">
      <form
        className="flex flex-col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          if (custodianId && custodianId !== place.custodianId) void save();
        }}
      >
        <p className="text-11.5 text-dim">
          Now run by <strong className="text-text">{place.custodianName}</strong>. The new custodian takes over the place and everything in it that {place.custodianName} answered for on
          the unit&apos;s behalf; anything borrowed stays with whoever holds it.
        </p>
        <CustodianPicker unitId={place.ownerOrgNodeId} value={custodianId} onChange={setCustodianId} store={place.isStore} />
        <label className="flex flex-col gap-4">
          <span className={labelCls}>Why (optional; both people see it)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Covering during study leave" className={inputCls} />
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center gap-8">
          <Button type="submit" variant="primary" disabled={busy || !custodianId || custodianId === place.custodianId}>
            {busy ? "Saving…" : "Hand it over"}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RemovePlaceDialog({ place, onClose, onRemoved }: { place: PlaceDto; onClose: () => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title={`Remove ${place.name}`}
      message="It is empty. Removing it takes it off the register; its history stays."
      confirmLabel="Remove"
      tone="danger"
      busy={busy}
      error={error}
      onConfirm={async () => {
        setBusy(true);
        setError(null);
        try {
          await api.delete(`/places/${place.id}`);
          toast.success(`Removed ${place.name}`);
          onRemoved();
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Could not remove it");
          setBusy(false);
        }
      }}
      onCancel={onClose}
    />
  );
}

/** useSearchParams needs a Suspense boundary. */
export default function PlacePage({ id }: { id: string }) {
  return (
    <Suspense>
      <PlaceInner id={id} />
    </Suspense>
  );
}

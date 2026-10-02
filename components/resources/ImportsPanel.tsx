"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContainerOptionDto, CreateImportInput, ImportRecordDto, PurchaseRequestDto, ResourceCategoryDto } from "@/lib/shared";
import { PURCHASE_UNITS } from "@/lib/shared";
import { TreePicker, containerTreeOptions } from "@/components/TreePicker";
import { api, ApiError } from "@/lib/api";
import { Panel, ErrorNote, Button, Tag } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { couldNotLoad } from "@/components/toast";
import { FOCUS_ROW, useScrollToFocus } from "@/lib/use-focus-row";

const inputCls = "h-24 px-6 rounded-2 border border-border2 bg-panel text-11";
const labelCls = "text-10.5 uppercase tracking-label text-faint";

const STATUS_TONE: Record<ImportRecordDto["status"], "warn" | "good" | "neutral"> = { OPEN: "warn", LOADED: "good", CANCELLED: "neutral" };
const STATUS_LABEL: Record<ImportRecordDto["status"], string> = { OPEN: "To load", LOADED: "Loaded", CANCELLED: "Cancelled" };

type DraftLine = { key: string; name: string; categoryId: string; qty: string; unit: string; spec: string; purchaseLineId?: string };

let keySeq = 0;
const newKey = () => `l${++keySeq}`;
const blankLine = (): DraftLine => ({ key: newKey(), name: "", categoryId: "", qty: "", unit: "pcs", spec: "" });

/**
 * Import records — how bought goods reach the Main Store (lib/server/resources/
 * imports.ts). Property Administration records what actually arrived, from a purchase
 * request at "Arrived at the main store" or standalone for an EGP purchase; the store
 * keeper loads the store from each record, line by line. Procurement follows along.
 */
export function ImportsPanel({
  categories,
  canRecord,
  canLoad,
  focusImportId = null,
  focusRequestId = null,
}: {
  categories: ResourceCategoryDto[];
  canRecord: boolean;
  canLoad: boolean;
  /** The import record a link named — highlighted and scrolled to. */
  focusImportId?: string | null;
  /** An arrived purchase request a link named — chosen in "record what arrived". */
  focusRequestId?: string | null;
}) {
  const [records, setRecords] = useState<ImportRecordDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .get<ImportRecordDto[]>("/resources/imports")
      .then(setRecords)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load import records"));
  }
  useEffect(load, []);
  useScrollToFocus(focusImportId ? `import-${focusImportId}` : null, !!records);

  return (
    <>
      {canRecord && <RecordImport categories={categories} records={records ?? []} onCreated={load} focusRequestId={focusRequestId} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel title="Import records" actions={<span className="text-11 text-faint">{canLoad ? "Load what arrived into the store" : "What arrived, and whether it is in the store yet"}</span>}>
        {records === null ? (
          <PanelLoading rows={3} />
        ) : records.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">No import records yet.</div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {records.map((r) => (
              <div key={r.id} id={`import-${r.id}`} aria-current={r.id === focusImportId ? "true" : undefined} className={r.id === focusImportId ? `${FOCUS_ROW} rounded-3 p-4 flex flex-col gap-4` : undefined}>
                {r.id === focusImportId && <div className="text-11 text-accent px-2">The one you followed</div>}
                <ImportCard record={r} canLoad={canLoad} canRecord={canRecord} onChanged={load} />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Recording what arrived (Property Administration) ─────────────────────────────

function RecordImport({ categories, records, onCreated, focusRequestId }: { categories: ResourceCategoryDto[]; records: ImportRecordDto[]; onCreated: () => void; focusRequestId: string | null }) {
  const [source, setSource] = useState<"PURCHASE_REQUEST" | "EGP">("PURCHASE_REQUEST");
  const [arrived, setArrived] = useState<PurchaseRequestDto[] | null>(null);
  const [requestId, setRequestId] = useState("");
  const [egpReference, setEgpReference] = useState("");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PurchaseRequestDto[]>("/resources/purchase-requests?box=receiving")
      .then(setArrived)
      .catch(couldNotLoad("what has arrived", () => setArrived([])));
  }, [records.length]);

  /** Already recorded per purchase line, on records that aren't cancelled. */
  const recorded = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of records) {
      if (r.status === "CANCELLED") continue;
      for (const l of r.lines) if (l.purchaseLineId) out.set(l.purchaseLineId, (out.get(l.purchaseLineId) ?? 0) + l.qty);
    }
    return out;
  }, [records]);

  function choose(id: string) {
    setRequestId(id);
    const request = arrived?.find((r) => r.id === id);
    if (!request) {
      setLines([blankLine()]);
      return;
    }
    const left = request.lines
      .map((l) => ({ l, left: l.qty - (recorded.get(l.id) ?? 0) }))
      .filter((x) => x.left > 0)
      .map(({ l, left }) => ({ key: newKey(), name: l.name, categoryId: l.categoryId ?? "", qty: String(left), unit: l.unit ?? "pcs", spec: "", purchaseLineId: l.id }));
    setLines(left.length ? left : [blankLine()]);
  }

  // A notice ("PR-… has arrived") names the request: it starts chosen, with its lines.
  const preselected = useRef(false);
  const focused = !!focusRequestId && arrived?.some((r) => r.id === focusRequestId) === true;
  useEffect(() => {
    if (!focused || preselected.current) return;
    preselected.current = true;
    choose(focusRequestId!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  useScrollToFocus(focused ? "record-import" : null, focused);

  const update = (key: string, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const ready = lines.length > 0 && lines.every((l) => l.name.trim() && l.categoryId && Number(l.qty) > 0) && (source === "EGP" ? egpReference.trim() : requestId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const input: CreateImportInput = {
        source,
        ...(source === "PURCHASE_REQUEST" ? { purchaseRequestId: requestId } : {}),
        egpReference: egpReference.trim() || undefined,
        supplier: supplier.trim() || undefined,
        note: note.trim() || undefined,
        lines: lines.map((l) => ({
          name: l.name.trim(),
          categoryId: l.categoryId,
          qty: Number(l.qty),
          unit: l.unit || undefined,
          spec: l.spec.trim() || undefined,
          ...(source === "PURCHASE_REQUEST" && l.purchaseLineId ? { purchaseLineId: l.purchaseLineId } : {}),
        })),
      };
      await api.post("/resources/imports", input);
      setRequestId("");
      setEgpReference("");
      setSupplier("");
      setNote("");
      setLines([blankLine()]);
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record this import");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="record-import" aria-current={focused ? "true" : undefined} className={focused && requestId === focusRequestId ? `${FOCUS_ROW} rounded-3 p-4` : undefined}>
      <Panel title="Record an import" actions={<span className="text-11 text-faint">What a purchase actually delivered — the store loads from this</span>}>
      <div className="p-12 flex flex-col gap-10">
        <div className="flex items-center gap-4">
          {(["PURCHASE_REQUEST", "EGP"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSource(s);
                setRequestId("");
                setLines([blankLine()]);
              }}
              style={{ background: source === s ? "var(--accent)" : "var(--panel2)", color: source === s ? "#fff" : "var(--dim)" }}
              className="border-0 text-11 font-medium px-9 py-4 rounded-2"
            >
              {s === "PURCHASE_REQUEST" ? "From a purchase request" : "Standalone EGP purchase"}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-8">
          {source === "PURCHASE_REQUEST" ? (
            <label className="flex flex-col gap-3">
              <span className={labelCls}>Arrived purchase request</span>
              <select value={requestId} onChange={(e) => choose(e.target.value)} className={`${inputCls} min-w-[280px]`}>
                <option value="">{arrived === null ? "Loading…" : arrived.length ? "Choose…" : "Nothing has arrived at the store"}</option>
                {(arrived ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.reference} · {r.title} · {r.orgNodeName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-3">
            <span className={labelCls}>EGP number{source === "EGP" ? "" : " (optional)"}</span>
            <input value={egpReference} onChange={(e) => setEgpReference(e.target.value)} className={`${inputCls} w-[160px]`} placeholder="e.g. EGP-77/2026" />
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Supplier (optional)</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`${inputCls} w-[200px]`} />
          </label>
        </div>

        {(source === "EGP" || requestId) && (
          <div className="flex flex-col gap-6">
            {lines.map((l) => (
              <div key={l.key} className="flex flex-wrap items-end gap-8">
                <label className="flex flex-col gap-3">
                  <span className={labelCls}>What</span>
                  <input value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} className={`${inputCls} w-[170px]`} />
                </label>
                <label className="flex flex-col gap-3">
                  <span className={labelCls}>Category</span>
                  <select value={l.categoryId} onChange={(e) => update(l.key, { categoryId: e.target.value })} className={`${inputCls} w-[150px]`}>
                    <option value="">Choose…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-3">
                  <span className={labelCls}>Qty</span>
                  <input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} type="number" min="0.0001" className={`${inputCls} w-[70px]`} />
                </label>
                <label className="flex flex-col gap-3">
                  <span className={labelCls}>Unit</span>
                  <select value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} className={`${inputCls} w-[80px]`}>
                    {PURCHASE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-3">
                  <span className={labelCls}>Model / serials (optional)</span>
                  <input value={l.spec} onChange={(e) => update(l.key, { spec: e.target.value })} className={`${inputCls} w-[220px]`} />
                </label>
                {l.purchaseLineId && <span className="text-10.5 text-faint pb-4">on the request</span>}
                <button type="button" className="text-11 text-faint pb-4" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length === 1}>
                  Remove
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="text-11 text-accent" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                + Add a line
              </button>
            </div>
            <label className="flex flex-col gap-3">
              <span className={labelCls}>Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} max-w-[520px]`} placeholder="e.g. delivered in two batches; invoice 1142" />
            </label>
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
        <div>
          <Button variant="primary" onClick={submit} disabled={!ready || busy}>
            {busy ? "Recording…" : "Record import"}
          </Button>
        </div>
      </div>
      </Panel>
    </div>
  );
}

// ── One record, and loading it (the store keeper) ────────────────────────────────

function ImportCard({ record, canLoad, canRecord, onChanged }: { record: ImportRecordDto; canLoad: boolean; canRecord: boolean; onChanged: () => void }) {
  const [fields, setFields] = useState<Record<string, { qty: string; storeParentId: string }>>({});
  const [containers, setContainers] = useState<Record<string, ContainerOptionDto[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelNote, setCancelNote] = useState("");

  const open = record.status === "OPEN";
  const pending = record.lines.filter((l) => l.loadedQty < l.qty);
  const nothingLoaded = record.lines.every((l) => l.loadedQty === 0);

  // Where each category may go in the store — loaded up front for the lines left to load.
  useEffect(() => {
    if (!canLoad || !open) return;
    for (const categoryId of new Set(pending.map((l) => l.categoryId))) {
      if (containers[categoryId]) continue;
      api
        .get<ContainerOptionDto[]>(`/resources/items/containers?categoryId=${encodeURIComponent(categoryId)}`)
        .then((rows) => setContainers((c) => ({ ...c, [categoryId]: rows })))
        .catch(() => setContainers((c) => ({ ...c, [categoryId]: [] })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, open, record.id]);

  const fieldsFor = (lineId: string, left: number) => fields[lineId] ?? { qty: String(left), storeParentId: "" };

  async function loadLine(lineId: string, left: number) {
    const f = fieldsFor(lineId, left);
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/imports/${record.id}/load`, { lineId, qty: Number(f.qty), storeParentId: f.storeParentId });
      setFields((s) => ({ ...s, [lineId]: { qty: "", storeParentId: f.storeParentId } }));
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this line");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/imports/${record.id}/cancel`, { note: cancelNote.trim() });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not cancel this record");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-3 p-12 flex flex-col gap-8">
      <div className="flex items-center justify-between gap-8">
        <div>
          <div className="text-11.5 font-medium">
            {record.reference} ·{" "}
            {record.source === "PURCHASE_REQUEST" ? `for ${record.purchaseReference ?? "a purchase request"}${record.purchaseOrgNodeName ? ` (${record.purchaseOrgNodeName})` : ""}` : `EGP ${record.egpReference}`}
            {record.supplier ? ` · ${record.supplier}` : ""}
          </div>
          <div className="text-11 text-dim">
            recorded by {record.createdByName} · {new Date(record.createdAt).toLocaleString()}
          </div>
        </div>
        <Tag tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status]}</Tag>
      </div>
      {record.note && <div className="text-11 text-dim italic whitespace-pre-line">"{record.note}"</div>}

      <div className="flex flex-col gap-6">
        {record.lines.map((l) => {
          const left = l.qty - l.loadedQty;
          const f = fieldsFor(l.id, left);
          return (
            <div key={l.id} className="flex flex-wrap items-end gap-8 text-11">
              <div className="min-w-[200px]">
                <div className="font-medium">{l.name}</div>
                <div className="text-faint">
                  {l.categoryName} · {l.loadedQty} of {l.qty} {l.unit ?? ""} loaded
                  {l.spec ? ` · ${l.spec}` : ""}
                </div>
              </div>
              {canLoad && open && left > 0 && (
                <>
                  <label className="flex flex-col gap-3">
                    <span className={labelCls}>Qty</span>
                    <input
                      value={f.qty}
                      onChange={(e) => setFields((s) => ({ ...s, [l.id]: { ...f, qty: e.target.value } }))}
                      type="number"
                      min="0.0001"
                      max={left}
                      className={`${inputCls} w-[70px]`}
                    />
                  </label>
                  <label className="flex flex-col gap-3">
                    <span className={labelCls}>Into</span>
                    <div className="min-w-[220px]">
                      <TreePicker
                        options={containerTreeOptions(containers[l.categoryId] ?? [])}
                        value={f.storeParentId}
                        onChange={(id) => setFields((s) => ({ ...s, [l.id]: { ...f, storeParentId: id } }))}
                        placeholder="Choose where in the store…"
                      />
                    </div>
                  </label>
                  <Button variant="primary" onClick={() => loadLine(l.id, left)} disabled={busy || !(Number(f.qty) > 0) || !f.storeParentId}>
                    Load into store
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {canRecord && open && nothingLoaded && (
        <div className="pt-4 border-t border-border flex flex-wrap items-end gap-8">
          {cancelling ? (
            <>
              <input value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="Why (required)" className={`${inputCls} min-w-[260px]`} />
              <Button variant="danger" onClick={cancel} disabled={busy || !cancelNote.trim()}>
                Cancel this record
              </Button>
              <Button onClick={() => setCancelling(false)} disabled={busy}>
                Never mind
              </Button>
            </>
          ) : (
            <button type="button" className="text-11 text-bad" onClick={() => setCancelling(true)}>
              Cancel this record…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

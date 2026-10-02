"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProcurementDto, ProcurementLineInput, ResourceCategoryDto, WaitingRequestDto } from "@/lib/shared";
import { PURCHASE_UNITS } from "@/lib/shared";
import { PROCUREMENT_HELP, PROCUREMENT_LABEL, PROCUREMENT_LINE, movableTo, type ProcurementStage } from "@/lib/domain/procurement";
import { api, ApiError } from "@/lib/api";
import { useHomeCounts } from "@/lib/home-counts";
import { Panel, Button, Tag, ErrorNote, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { couldNotLoad, toast } from "@/components/toast";
import { FOCUS_ROW, useScrollToFocus } from "@/lib/use-focus-row";

const inputCls = "h-24 px-6 rounded-2 border border-border2 bg-panel text-11";
const labelCls = "text-10.5 uppercase tracking-label text-faint";

const STAGE_TONE: Record<ProcurementStage, "accent" | "good" | "neutral" | "warn"> = {
  PREPARING: "warn",
  PLACED_ON_EGP: "accent",
  BUYER_FOUND: "accent",
  ON_DELIVERY: "accent",
  ARRIVED: "accent",
  CLOSED: "good",
  CANCELLED: "neutral",
};

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Purchasing → Procurement (lib/server/resources/procurements.ts): approved requests
 * waiting to be bought, and every procurement as a timeline. The procurement office
 * starts one from any number of requests (or a standalone EGP purchase), edits what
 * is really being bought, and moves it forward; at "Arrived" it records what came.
 * Property Administration and the store follow along here.
 */
export function ProcurementPanel({ categories, canRun, focusId }: { categories: ResourceCategoryDto[]; canRun: boolean; focusId: string | null }) {
  const { refresh: refreshCounts } = useHomeCounts();
  const [waiting, setWaiting] = useState<WaitingRequestDto[] | null>(null);
  const [list, setList] = useState<ProcurementDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [standalone, setStandalone] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api
      .get<ProcurementDto[]>("/resources/procurements")
      .then(setList)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the procurements"));
    if (canRun) api.get<WaitingRequestDto[]>("/resources/procurements/waiting").then(setWaiting).catch(couldNotLoad("the approved requests", () => setWaiting([])));
  }, [canRun]);
  useEffect(load, [load]);
  const changed = useCallback(() => {
    load();
    refreshCounts();
  }, [load, refreshCounts]);
  useScrollToFocus(focusId ? `procurement-${focusId}` : null, !!list);

  const preparing = (list ?? []).filter((p) => p.stage === "PREPARING");

  return (
    <>
      {canRun && <WaitingPanel waiting={waiting} preparing={preparing} onChanged={changed} onStandalone={() => setStandalone(true)} />}
      {standalone && <StandaloneForm categories={categories} onClose={() => setStandalone(false)} onStarted={changed} />}
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel title="Procurements" actions={<span className="text-11 text-faint">What is being bought, and where each one is</span>}>
        {list === null ? (
          <PanelLoading rows={3} />
        ) : list.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">No procurement yet.{canRun ? " Start one from the approved requests above." : ""}</div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {list.map((p) => (
              <div key={p.id} id={`procurement-${p.id}`} className={p.id === focusId ? `${FOCUS_ROW} rounded-3 p-4` : undefined}>
                <ProcurementCard procurement={p} categories={categories} defaultOpen={p.id === focusId || list.length === 1} onChanged={changed} />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Approved requests waiting to be bought ───────────────────────────────────────

function WaitingPanel({ waiting, preparing, onChanged, onStandalone }: { waiting: WaitingRequestDto[] | null; preparing: ProcurementDto[]; onChanged: () => void; onStandalone: () => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [into, setInto] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const ids = [...chosen];
      const p = into ? await api.post<ProcurementDto>(`/resources/procurements/${into}/requests`, { requestIds: ids }) : await api.post<ProcurementDto>("/resources/procurements", { requestIds: ids });
      toast.success(`${into ? "Added to" : "Started"} ${p.reference}. The heads who asked were told.`, { href: `/purchasing?tab=procurement&procurement=${p.id}`, linkLabel: "Open it" });
      setChosen(new Set());
      setInto("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the procurement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={`Approved, waiting to be bought${waiting ? ` (${waiting.length})` : ""}`}
      actions={<Button onClick={onStandalone}>+ Standalone EGP purchase</Button>}
    >
      {waiting === null ? (
        <PanelLoading rows={2} />
      ) : waiting.length === 0 ? (
        <div className="px-14 py-12 text-11.5 text-dim">Nothing approved is waiting. Requests appear here once you approve them in Approvals.</div>
      ) : (
        <div className="p-12 flex flex-col gap-8">
          <div className="text-11 text-dim">Choose the requests one EGP purchase will cover. Their lines are the starting point; you edit what is really bought on the procurement.</div>
          {waiting.map((r) => (
            <label key={r.id} className="flex items-center gap-8 text-11.5 border border-border rounded-2 px-10 py-6 cursor-pointer hover:bg-panel2">
              <input
                type="checkbox"
                checked={chosen.has(r.id)}
                onChange={(e) => setChosen((s) => (e.target.checked ? new Set(s).add(r.id) : new Set([...s].filter((x) => x !== r.id))))}
              />
              <span className="font-mono">{r.reference}</span>
              <span className="flex-1 truncate">{r.title}</span>
              <span className="text-11 text-dim">
                {r.orgNodeName} · {r.lineCount} line{r.lineCount === 1 ? "" : "s"} · approved {new Date(r.approvedAt).toLocaleDateString()}
              </span>
            </label>
          ))}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-8">
            {preparing.length > 0 && (
              <select value={into} onChange={(e) => setInto(e.target.value)} className={`${inputCls} min-w-[220px]`} aria-label="Into which procurement">
                <option value="">A new procurement</option>
                {preparing.map((p) => (
                  <option key={p.id} value={p.id}>
                    Add to {p.reference} · {p.title}
                  </option>
                ))}
              </select>
            )}
            <Button variant="primary" disabled={!chosen.size || busy} onClick={start}>
              {busy ? "Working…" : into ? `Add ${chosen.size || ""} to it` : `Start buying ${chosen.size ? `${chosen.size} request${chosen.size === 1 ? "" : "s"}` : ""}`.trim()}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Lines, edited ───────────────────────────────────────────────────────────────

type DraftLine = { key: string; id?: string; name: string; categoryId: string; qty: string; unit: string; unitCost: string; purchaseLineId: string | null; from: string | null };
let seq = 0;
const k = () => `d${++seq}`;
const blank = (): DraftLine => ({ key: k(), name: "", categoryId: "", qty: "1", unit: "pcs", unitCost: "", purchaseLineId: null, from: null });

function toInput(lines: DraftLine[]): ProcurementLineInput[] {
  return lines.map((l) => ({
    ...(l.id ? { id: l.id } : {}),
    name: l.name.trim(),
    categoryId: l.categoryId || null,
    qty: Number(l.qty),
    unit: l.unit || null,
    unitCost: l.unitCost.trim() === "" ? null : Number(l.unitCost),
    purchaseLineId: l.purchaseLineId,
  }));
}

function LinesEditor({ lines, onChange, categories }: { lines: DraftLine[]; onChange: (lines: DraftLine[]) => void; categories: ResourceCategoryDto[] }) {
  const update = (key: string, patch: Partial<DraftLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-6">
      {lines.map((l) => (
        <div key={l.key} className="flex flex-wrap items-end gap-8">
          <label className="flex flex-col gap-3">
            <span className={labelCls}>What</span>
            <input value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} className={`${inputCls} w-[180px]`} />
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Category</span>
            <select value={l.categoryId} onChange={(e) => update(l.key, { categoryId: e.target.value })} className={`${inputCls} w-[150px]`}>
              <option value="">Not chosen yet</option>
              {categories.filter((c) => !c.isPlace).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Qty</span>
            <input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} type="number" min="0" className={`${inputCls} w-[70px]`} />
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
            <span className={labelCls}>Unit cost (ETB)</span>
            <input value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} type="number" min="0" className={`${inputCls} w-[100px]`} />
          </label>
          {l.from && <span className="text-10.5 text-faint pb-4">from {l.from}</span>}
          <button type="button" className="text-11 text-faint pb-4" onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="text-11 text-accent self-start" onClick={() => onChange([...lines, blank()])}>
        + Another line
      </button>
    </div>
  );
}

const linesValid = (lines: DraftLine[]) => lines.length > 0 && lines.every((l) => l.name.trim() && Number(l.qty) > 0 && (l.unitCost.trim() === "" || Number(l.unitCost) >= 0));

// ── A standalone EGP purchase ───────────────────────────────────────────────────

function StandaloneForm({ categories, onClose, onStarted }: { categories: ResourceCategoryDto[]; onClose: () => void; onStarted: () => void }) {
  const [title, setTitle] = useState("");
  const [egp, setEgp] = useState("");
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const p = await api.post<ProcurementDto>("/resources/procurements", {
        requestIds: [],
        title: title.trim() || undefined,
        egpReference: egp.trim(),
        supplier: supplier.trim() || undefined,
        lines: toInput(lines),
      });
      toast.success(`Started ${p.reference}`, { href: `/purchasing?tab=procurement&procurement=${p.id}`, linkLabel: "Open it" });
      onStarted();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start this purchase");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="A standalone EGP purchase" actions={<span className="text-11 text-faint">Bought through EGP without an LRMS request</span>}>
      <div className="p-12 flex flex-col gap-10">
        <div className="flex flex-wrap items-end gap-8">
          <label className="flex flex-col gap-3">
            <span className={labelCls}>EGP number</span>
            <input value={egp} onChange={(e) => setEgp(e.target.value)} placeholder="e.g. EGP-77/2026" className={`${inputCls} w-[160px]`} />
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Title (optional)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} w-[240px]`} />
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Supplier (optional)</span>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`${inputCls} w-[200px]`} />
          </label>
        </div>
        <LinesEditor lines={lines} onChange={setLines} categories={categories} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center gap-8">
          <Button variant="primary" disabled={busy || !egp.trim() || !linesValid(lines)} onClick={submit}>
            {busy ? "Starting…" : "Start this purchase"}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ── One procurement: its timeline, what it buys, its history ─────────────────────

function ProcurementCard({ procurement: p, categories, defaultOpen, onChanged }: { procurement: ProcurementDto; categories: ResourceCategoryDto[]; defaultOpen: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<null | "edit" | "cancel">(null);
  const [target, setTarget] = useState<ProcurementStage | "">("");
  const [egp, setEgp] = useState(p.egpReference ?? "");
  const [supplier, setSupplier] = useState(p.supplier ?? "");
  const [note, setNote] = useState("");
  const [arrived, setArrived] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = movableTo(p.stage);
  // When each stage was reached, from the history.
  const reachedAt = useMemo(() => {
    const m = new Map<ProcurementStage, string>();
    for (const e of p.events) if (!m.has(e.stage)) m.set(e.stage, e.at);
    return m;
  }, [p.events]);

  async function run(path: string, body: unknown, done: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/procurements/${p.id}/${path}`, body);
      toast.success(done);
      setMode(null);
      setTarget("");
      setNote("");
      setReason("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setDraft(
      p.lines.map((l) => ({
        key: k(),
        id: l.id,
        name: l.name,
        categoryId: l.categoryId ?? "",
        qty: String(l.qty),
        unit: l.unit ?? "pcs",
        unitCost: l.unitCost === null ? "" : String(l.unitCost),
        purchaseLineId: l.purchaseLineId,
        from: l.purchaseReference,
      })),
    );
    setMode("edit");
  }

  function move() {
    if (!target) return;
    const arrivedCounts = target === "ARRIVED" ? p.lines.map((l) => ({ lineId: l.id, qty: arrived[l.id] === undefined || arrived[l.id] === "" ? l.qty : Number(arrived[l.id]) })) : undefined;
    void run(
      "move",
      { stage: target, note: note.trim() || undefined, egpReference: egp.trim() || undefined, supplier: supplier.trim() || undefined, arrived: arrivedCounts },
      `${p.reference}: ${PROCUREMENT_LABEL[target]}. Everyone following it was told.`,
    );
  }

  const needsEgp = !p.egpReference && !egp.trim();

  return (
    <div className="border border-border rounded-3 p-12 flex flex-col gap-8">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex flex-wrap items-center gap-8 text-left">
        <span className="font-mono text-11.5 font-semibold">{p.reference}</span>
        <span className="flex-1 min-w-[160px] text-11.5 font-medium truncate">{p.title}</span>
        <Tag tone={STAGE_TONE[p.stage]}>{PROCUREMENT_LABEL[p.stage]}</Tag>
        <span className="text-11 text-dim">
          {p.egpReference ? `EGP ${p.egpReference}` : "no EGP number yet"}
          {p.requests.length ? ` · ${p.requests.map((r) => r.reference).join(", ")}` : " · standalone"}
        </span>
        <span className="text-faint" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <>
          {/* The timeline: where it has been, where it is, what comes next. */}
          <ol className="flex flex-wrap items-center gap-4" aria-label="Stages">
            {PROCUREMENT_LINE.map((s, i) => {
              const at = PROCUREMENT_LINE.indexOf(p.stage === "CANCELLED" ? "PREPARING" : p.stage);
              const state = p.stage === "CANCELLED" ? (reachedAt.has(s) ? "done" : "skip") : i < at ? "done" : i === at ? "now" : "next";
              return (
                <li key={s} className="flex items-center gap-4">
                  {i > 0 && <span className="text-faint">→</span>}
                  <span
                    title={PROCUREMENT_HELP[s]}
                    className={`text-11 rounded-full px-8 py-2 border ${state === "now" ? "border-accent bg-soft text-accent font-semibold" : state === "done" ? "border-good text-good" : "border-border2 text-faint"}`}
                  >
                    {PROCUREMENT_LABEL[s]}
                    {reachedAt.get(s) ? ` · ${new Date(reachedAt.get(s)!).toLocaleDateString()}` : ""}
                  </span>
                </li>
              );
            })}
            {p.stage === "CANCELLED" && <Tag tone="neutral">Cancelled</Tag>}
          </ol>
          <div className="text-11 text-dim">{PROCUREMENT_HELP[p.stage]}</div>

          {p.requests.length > 0 && (
            <div className="text-11 text-dim">
              Buying:{" "}
              {p.requests.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && "; "}
                  <a href={`/approvals?box=mine&focus=purchase:${r.id}`} className="text-accent hover:underline">
                    {r.reference}
                  </a>{" "}
                  {r.title} ({r.orgNodeName})
                </span>
              ))}
            </div>
          )}

          {/* What it buys. */}
          {mode === "edit" ? (
            <div className="flex flex-col gap-8 border border-border2 rounded-2 p-10">
              <div className="text-11 font-medium">Edit what is being bought</div>
              <LinesEditor lines={draft} onChange={setDraft} categories={categories} />
              <label className="flex flex-col gap-3">
                <span className={labelCls}>Why (everyone following it reads this; whoever gets less is told)</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. only 380 chairs in the tender" className={inputCls} />
              </label>
              <div className="flex items-center gap-8">
                <Button variant="primary" disabled={busy || !linesValid(draft) || reason.trim().length < 3} onClick={() => run("lines", { lines: toInput(draft), reason: reason.trim() }, `${p.reference}: what is bought was changed`)}>
                  {busy ? "Saving…" : "Save the changes"}
                </Button>
                <Button onClick={() => setMode(null)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-11">
                <thead>
                  <tr className="text-left text-faint">
                    <th className="py-4 pr-8 font-medium">What</th>
                    <th className="py-4 pr-8 font-medium">Category</th>
                    <th className="py-4 pr-8 font-medium text-right">Bought</th>
                    {p.lines.some((l) => l.arrivedQty !== null) && <th className="py-4 pr-8 font-medium text-right">Came</th>}
                    <th className="py-4 pr-8 font-medium text-right">Unit cost</th>
                    <th className="py-4 font-medium">Asked for in</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lines.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="py-4 pr-8">{l.name}</td>
                      <td className="py-4 pr-8 text-dim">{l.categoryName ?? <span className="text-warn">not chosen</span>}</td>
                      <td className="py-4 pr-8 text-right font-mono">
                        {l.qty} {l.unit ?? ""}
                        {l.requestedQty !== null && l.requestedQty !== l.qty && <span className="text-warn"> (asked {l.requestedQty})</span>}
                      </td>
                      {p.lines.some((x) => x.arrivedQty !== null) && (
                        <td className={`py-4 pr-8 text-right font-mono ${l.arrivedQty !== null && l.arrivedQty < l.qty ? "text-warn" : ""}`}>{l.arrivedQty ?? "–"}</td>
                      )}
                      <td className="py-4 pr-8 text-right font-mono">{l.unitCost === null ? "–" : money(l.unitCost)}</td>
                      <td className="py-4 text-dim">{l.purchaseReference ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {p.total !== null && <div className="text-11 text-dim pt-4 text-right">Estimated total: {money(p.total)} ETB</div>}
            </div>
          )}

          {p.importRecord && (
            <div className="text-11 text-dim">
              Recorded by Property Administration as{" "}
              <a href={`/purchasing?tab=arrivals&import=${p.importRecord.id}`} className="text-accent hover:underline">
                {p.importRecord.reference}
              </a>{" "}
              ({p.importRecord.status === "LOADED" ? "loaded into the store" : p.importRecord.status === "OPEN" ? "being loaded" : "cancelled"}).
            </div>
          )}
          {p.stage === "ARRIVED" && !p.importRecord && <div className="text-11 text-dim">Waiting for Property Administration to check the counts and record the import.</div>}

          {/* Moving it on. */}
          {p.can.move && next.length > 0 && mode !== "edit" && (
            <div className="flex flex-col gap-8 border-t border-border pt-8">
              <div className="flex flex-wrap items-end gap-8">
                <label className="flex flex-col gap-3">
                  <span className={labelCls}>Move to</span>
                  <select value={target} onChange={(e) => setTarget(e.target.value as ProcurementStage)} className={`${inputCls} min-w-[200px]`}>
                    <option value="">Choose the stage…</option>
                    {next.map((s, i) => (
                      <option key={s} value={s}>
                        {PROCUREMENT_LABEL[s]}
                        {i === 0 ? " (next)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {(target || !p.egpReference) && (
                  <label className="flex flex-col gap-3">
                    <span className={labelCls}>EGP number</span>
                    <input value={egp} onChange={(e) => setEgp(e.target.value)} placeholder="e.g. EGP-77/2026" className={`${inputCls} w-[160px]`} />
                  </label>
                )}
                {target && (
                  <label className="flex flex-col gap-3">
                    <span className={labelCls}>Supplier</span>
                    <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={`${inputCls} w-[180px]`} />
                  </label>
                )}
                {target && (
                  <label className="flex flex-col gap-3 flex-1 min-w-[180px]">
                    <span className={labelCls}>Note (optional)</span>
                    <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
                  </label>
                )}
              </div>
              {target === "ARRIVED" && (
                <div className="flex flex-col gap-4">
                  <div className="text-11 text-dim">How many of each came? Leave a count as it is if everything bought arrived.</div>
                  {p.lines.map((l) => (
                    <label key={l.id} className="flex items-center gap-8 text-11">
                      <span className="w-[200px] truncate">{l.name}</span>
                      <input
                        type="number"
                        min="0"
                        value={arrived[l.id] ?? String(l.qty)}
                        onChange={(e) => setArrived((a) => ({ ...a, [l.id]: e.target.value }))}
                        className={`${inputCls} w-[80px]`}
                      />
                      <span className="text-faint">of {l.qty} bought</span>
                    </label>
                  ))}
                </div>
              )}
              {error && mode === null && <ErrorNote>{error}</ErrorNote>}
              <div className="flex flex-wrap items-center gap-8">
                <Button variant="primary" disabled={busy || !target || (target !== "PREPARING" && needsEgp)} onClick={move} title={needsEgp ? "Give the EGP number first" : undefined}>
                  {busy ? "Working…" : target ? `Move to ${PROCUREMENT_LABEL[target]}` : "Move"}
                </Button>
                {p.can.editLines && <Button onClick={startEdit}>Edit what is being bought…</Button>}
                {p.can.cancel && (
                  <Button variant="danger" onClick={() => setMode("cancel")}>
                    Cancel…
                  </Button>
                )}
              </div>
            </div>
          )}
          {error && mode === "edit" && <ErrorNote>{error}</ErrorNote>}

          {/* Its story. */}
          <details className="text-11">
            <summary className="cursor-pointer text-dim">History ({p.events.length})</summary>
            <ol className="flex flex-col gap-4 pt-6">
              {p.events.map((e, i) => (
                <li key={i} className="border-l-2 border-border2 pl-8">
                  <div>
                    <strong className="font-medium">{PROCUREMENT_LABEL[e.stage]}</strong> · {e.byName} · {new Date(e.at).toLocaleString()}
                  </div>
                  {e.note && <div className="text-dim">{e.note}</div>}
                  {e.lineChanges.length > 0 && (
                    <ul className="text-dim list-disc pl-14">
                      {e.lineChanges.map((c, j) => (
                        <li key={j}>{c}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}

      {mode === "cancel" && (
        <ConfirmDialog
          title={`Cancel ${p.reference}`}
          tone="danger"
          confirmLabel="Cancel the procurement"
          busy={busy}
          error={error}
          confirmDisabled={note.trim().length < 3}
          message={
            <div className="flex flex-col gap-8">
              <span>Nothing more is bought through it. {p.requests.length ? "The requests it covered go back to waiting for procurement, and the heads who asked are told." : ""}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (required)" className={inputCls} />
            </div>
          }
          onConfirm={() => run("cancel", { note: note.trim() }, `${p.reference} was cancelled`)}
          onCancel={() => setMode(null)}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ChainStepDto,
  CompilePurchaseInput,
  ContainerOptionDto,
  NeedLineDto,
  PurchaseRequestDto,
  ResourceCategoryDto,
} from "@/lib/shared";
import { PURCHASE_UNITS } from "@/lib/shared";
import { STAGE_HELP, STAGE_LABEL, isEditable, isFinished } from "@/lib/domain/purchasing";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Panel, Screen, ErrorNote, Button, Tag } from "@/components/ui";
import { PanelLoading } from "@/components/states";

const inputCls = "h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5";
const labelCls = "text-9.5 uppercase tracking-label text-faint";

const NEED_TONE: Record<NeedLineDto["status"], "warn" | "good" | "bad" | "neutral"> = {
  OPEN: "warn",
  CARRIED: "good",
  DECLINED: "bad",
};

const STAGE_TONE: Record<PurchaseRequestDto["stage"], "warn" | "good" | "bad" | "neutral" | "accent"> = {
  DRAFT: "neutral",
  APPROVING: "warn",
  REVISING: "warn",
  ORDER_PLACED: "accent",
  BUYER_FOUND: "accent",
  ON_DELIVERY: "accent",
  IN_STORE: "accent",
  CLOSED: "good",
  REJECTED: "bad",
  CANCELLED: "neutral",
};

const STEP_TONE: Record<ChainStepDto["status"], "warn" | "good" | "bad" | "neutral"> = {
  PENDING: "warn",
  WAITING: "neutral",
  APPROVED: "good",
  REJECTED: "bad",
  SKIPPED: "neutral",
};

function ChainTrail({ steps }: { steps: ChainStepDto[] }) {
  if (!steps.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-6">
      {steps.map((s, i) => (
        <span key={s.id} className="flex items-center gap-6">
          {i > 0 && <span className="text-faint">→</span>}
          <Tag tone={STEP_TONE[s.status]}>
            {s.label}
            {s.status === "PENDING" && !s.approverId ? " (vacant)" : s.approverName ? ` · ${s.approverName}` : ""}
          </Tag>
        </span>
      ))}
    </div>
  );
}

// ── Raise a need ─────────────────────────────────────────────────────────────────

function RaiseNeedPanel({ categories }: { categories: ResourceCategoryDto[] }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<NeedLineDto[] | null>(null);

  function load() {
    api
      .get<NeedLineDto[]>("/resources/needs")
      .then(setMine)
      .catch(() => setMine([]));
  }
  useEffect(load, []);

  async function submit() {
    if (!name.trim() || !reason.trim() || !qty) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<NeedLineDto>("/resources/needs", {
        name: name.trim(),
        qty: Number(qty),
        unit: unit || undefined,
        categoryId: categoryId || undefined,
        reason: reason.trim(),
      });
      setName("");
      setQty("1");
      setUnit("");
      setCategoryId("");
      setReason("");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not raise this need");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Raise a need">
        <div className="p-12 flex flex-col gap-8">
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-end gap-8">
            <label className="flex flex-col gap-3">
              <span className={labelCls}>What</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Digital balance" className={`${inputCls} min-w-[180px]`} />
            </label>
            <label className="flex flex-col gap-3">
              <span className={labelCls}>Qty</span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="0.0001" className={`${inputCls} w-[80px]`} />
            </label>
            <label className="flex flex-col gap-3">
              <span className={labelCls}>Unit</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {PURCHASE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-3">
              <span className={labelCls}>Category</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputCls} min-w-[150px]`}>
                <option value="">Not sure</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Why</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ours is broken" className={inputCls} />
          </label>
          <div>
            <Button variant="primary" onClick={submit} disabled={busy || !name.trim() || !reason.trim()}>
              Raise this need
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Your needs">
        {mine === null ? (
          <PanelLoading rows={2} />
        ) : mine.length === 0 ? (
          <div className="px-14 py-12 text-11 text-dim">You haven't raised any needs yet.</div>
        ) : (
          <div className="flex flex-col">
            {mine.map((n) => (
              <div key={n.id} className="flex items-center justify-between px-14 py-8 border-b border-border last:border-0 text-11">
                <div>
                  <div>
                    {n.name} · {n.qty}
                    {n.unit ? ` ${n.unit}` : ""}
                  </div>
                  <div className="text-9.5 text-faint">{n.reason}</div>
                  {n.note && <div className="text-9.5 text-faint italic">"{n.note}"</div>}
                </div>
                <Tag tone={NEED_TONE[n.status]}>{n.status}</Tag>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Lines editor — shared by "compile" and "revise and resubmit" ─────────────────

interface EditableLine {
  key: string;
  name: string;
  qty: string;
  unit: string;
  categoryId: string;
  estimatedUnitCost: string;
  justification: string;
  fromNeedId: string;
}

let lineKeyCounter = 0;
function emptyLine(): EditableLine {
  return { key: `l${lineKeyCounter++}`, name: "", qty: "1", unit: "", categoryId: "", estimatedUnitCost: "", justification: "", fromNeedId: "" };
}

function LinesEditor({
  lines,
  onChange,
  categories,
  openNeeds,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  categories: ResourceCategoryDto[];
  openNeeds: NeedLineDto[];
}) {
  function update(key: string, patch: Partial<EditableLine>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function pickNeed(key: string, needId: string) {
    const need = openNeeds.find((n) => n.id === needId);
    if (!need) {
      update(key, { fromNeedId: "" });
      return;
    }
    update(key, { fromNeedId: needId, name: need.name, qty: String(need.qty), unit: need.unit ?? "", categoryId: need.categoryId ?? "" });
  }

  return (
    <div className="flex flex-col gap-8">
      {lines.map((l) => (
        <div key={l.key} className="flex flex-wrap items-end gap-8 pb-8 border-b border-border last:border-0">
          {openNeeds.length > 0 && (
            <label className="flex flex-col gap-3">
              <span className={labelCls}>From need</span>
              <select value={l.fromNeedId} onChange={(e) => pickNeed(l.key, e.target.value)} className={`${inputCls} min-w-[140px]`}>
                <option value="">—</option>
                {openNeeds.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.qty})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Name</span>
            <input value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} className={`${inputCls} min-w-[160px]`} />
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Qty</span>
            <input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} type="number" min="0.0001" className={`${inputCls} w-[70px]`} />
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Unit</span>
            <select value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} className={inputCls}>
              <option value="">—</option>
              {PURCHASE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Category</span>
            <select value={l.categoryId} onChange={(e) => update(l.key, { categoryId: e.target.value })} className={`${inputCls} min-w-[140px]`}>
              <option value="">Not sure</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Est. unit cost</span>
            <input value={l.estimatedUnitCost} onChange={(e) => update(l.key, { estimatedUnitCost: e.target.value })} type="number" min="0" className={`${inputCls} w-[90px]`} />
          </label>
          <label className="flex flex-col gap-3 flex-1">
            <span className={labelCls}>Justification</span>
            <input value={l.justification} onChange={(e) => update(l.key, { justification: e.target.value })} className={`${inputCls} w-full`} />
          </label>
          <button className="text-10.5 text-bad h-24" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} disabled={lines.length === 1}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <Button onClick={() => onChange([...lines, emptyLine()])}>+ Add line</Button>
      </div>
    </div>
  );
}

function toInputLines(lines: EditableLine[]): CompilePurchaseInput["lines"] {
  return lines
    .filter((l) => l.name.trim() && l.qty)
    .map((l) => ({
      name: l.name.trim(),
      qty: Number(l.qty),
      unit: l.unit || undefined,
      categoryId: l.categoryId || undefined,
      estimatedUnitCost: l.estimatedUnitCost ? Number(l.estimatedUnitCost) : undefined,
      justification: l.justification || undefined,
      fromNeedIds: l.fromNeedId ? [l.fromNeedId] : [],
    }));
}

// ── Compile a request (heads) ─────────────────────────────────────────────────────

function CompilePanel({ orgNodeId, categories, onCompiled }: { orgNodeId: string; categories: ResourceCategoryDto[]; onCompiled: () => void }) {
  const [openNeeds, setOpenNeeds] = useState<NeedLineDto[]>([]);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadOpenNeeds() {
    api
      .get<NeedLineDto[]>(`/resources/needs?node=${encodeURIComponent(orgNodeId)}`)
      .then(setOpenNeeds)
      .catch(() => setOpenNeeds([]));
  }
  useEffect(loadOpenNeeds, [orgNodeId]);

  async function submit() {
    const inputLines = toInputLines(lines);
    if (!title.trim() || !inputLines.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<PurchaseRequestDto>("/resources/purchase-requests", { title: title.trim(), orgNodeId, lines: inputLines });
      setTitle("");
      setLines([emptyLine()]);
      loadOpenNeeds();
      onCompiled();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not compile this request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Compile a purchase request">
      <div className="p-12 flex flex-col gap-10">
        {error && <ErrorNote>{error}</ErrorNote>}
        {openNeeds.length > 0 && (
          <div className="text-10.5 text-dim">
            {openNeeds.length} open need{openNeeds.length === 1 ? "" : "s"} in this unit — pick "From need" on a line to carry one forward.
          </div>
        )}
        <label className="flex flex-col gap-3">
          <span className={labelCls}>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q1 lab equipment" className={`${inputCls} max-w-[360px]`} />
        </label>
        <LinesEditor lines={lines} onChange={setLines} categories={categories} openNeeds={openNeeds} />
        <div>
          <Button variant="primary" onClick={submit} disabled={busy || !title.trim() || !toInputLines(lines).length}>
            Submit for approval
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ── One request, shared by every list below ────────────────────────────────────

function RequestCard({
  request,
  viewerId,
  categories,
  onChanged,
  showReceive,
  showAdvance,
}: {
  request: PurchaseRequestDto;
  viewerId: string;
  categories: ResourceCategoryDto[];
  onChanged: () => void;
  showReceive?: boolean;
  showAdvance?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [lines, setLines] = useState<EditableLine[]>(() =>
    request.lines.map((l) => ({
      key: l.id,
      name: l.name,
      qty: String(l.qty),
      unit: l.unit ?? "",
      categoryId: l.categoryId ?? "",
      estimatedUnitCost: l.estimatedUnitCost !== null ? String(l.estimatedUnitCost) : "",
      justification: l.justification ?? "",
      fromNeedId: l.fromNeedIds[0] ?? "",
    })),
  );
  const [title, setTitle] = useState(request.title);
  const [receiveState, setReceiveState] = useState<Record<string, { qty: string; categoryId: string; storeParentId: string; containers: ContainerOptionDto[] }>>({});

  const currentStep = request.steps.find((s) => s.status === "PENDING");
  const canDecide = request.stage === "APPROVING" && currentStep?.approverId === viewerId;
  const isRequester = request.raisedById === viewerId;
  const ordered = request.lines.reduce((n, l) => n + l.qty, 0);
  const received = request.lines.reduce((n, l) => n + (l.receivedQty ?? 0), 0);

  async function decide(decision: "APPROVE" | "REJECT" | "REVISE") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/decide`, { decision });
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record this decision");
    } finally {
      setBusy(false);
    }
  }

  async function resubmit() {
    const inputLines = toInputLines(lines);
    if (!title.trim() || !inputLines.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/resources/purchase-requests/${request.id}`, { title: title.trim(), orgNodeId: request.orgNodeId, lines: inputLines });
      setRevising(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resubmit this request");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/cancel`);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not cancel this request");
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/advance`, {});
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not advance this request");
    } finally {
      setBusy(false);
    }
  }

  function receiveFieldsFor(lineId: string, defaultCategoryId: string | null) {
    return receiveState[lineId] ?? { qty: "", categoryId: defaultCategoryId ?? "", storeParentId: "", containers: [] };
  }

  function updateReceive(lineId: string, defaultCategoryId: string | null, patch: Partial<{ qty: string; categoryId: string; storeParentId: string; containers: ContainerOptionDto[] }>) {
    const current = receiveFieldsFor(lineId, defaultCategoryId);
    setReceiveState((s) => ({ ...s, [lineId]: { ...current, ...patch } }));
  }

  async function loadContainers(lineId: string, defaultCategoryId: string | null, categoryId: string) {
    if (!categoryId) {
      updateReceive(lineId, defaultCategoryId, { categoryId, containers: [], storeParentId: "" });
      return;
    }
    updateReceive(lineId, defaultCategoryId, { categoryId });
    try {
      const rows = await api.get<ContainerOptionDto[]>(`/resources/items/containers?categoryId=${encodeURIComponent(categoryId)}`);
      updateReceive(lineId, defaultCategoryId, { categoryId, containers: rows });
    } catch {
      updateReceive(lineId, defaultCategoryId, { categoryId, containers: [] });
    }
  }

  async function receive(lineId: string, defaultCategoryId: string | null) {
    const f = receiveFieldsFor(lineId, defaultCategoryId);
    if (!f.qty || !f.categoryId || !f.storeParentId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/receive`, { lineId, qty: Number(f.qty), categoryId: f.categoryId, storeParentId: f.storeParentId });
      setReceiveState((s) => ({ ...s, [lineId]: { qty: "", categoryId: f.categoryId, storeParentId: "", containers: f.containers } }));
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not register this stock");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-3 p-12 flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-11.5 font-medium">
            {request.reference} · {request.title}
          </div>
          <div className="text-10.5 text-dim">
            {request.orgNodeName} · by {request.raisedByName} · {new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
        <Tag tone={STAGE_TONE[request.stage] ?? "neutral"}>{STAGE_LABEL[request.stage]}</Tag>
      </div>

      <ChainTrail steps={request.steps} />
      {request.feedback && <div className="text-10.5 text-dim italic">"{request.feedback}"</div>}
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-col gap-4">
        {request.lines.map((l) => (
          <div key={l.id} className="text-10.5 text-dim flex items-center justify-between">
            <span>
              {l.name} · {l.qty}
              {l.unit ? ` ${l.unit}` : ""}
              {l.estimatedUnitCost !== null ? ` · ~${l.estimatedUnitCost}/unit` : ""}
            </span>
            {l.receivedQty !== null && (
              <span className="text-9.5">
                received {l.receivedQty}/{l.qty}
              </span>
            )}
          </div>
        ))}
      </div>
      {ordered > 0 && received > 0 && (
        <div className="text-9.5 text-faint">
          {received}/{ordered} received{received >= ordered ? " — complete" : ""}
        </div>
      )}

      {canDecide && !revising && (
        <div className="flex items-center gap-8 pt-4">
          <Button variant="primary" onClick={() => decide("APPROVE")} disabled={busy}>
            Approve
          </Button>
          <Button variant="danger" onClick={() => decide("REJECT")} disabled={busy}>
            Reject
          </Button>
          <Button onClick={() => decide("REVISE")} disabled={busy}>
            Send back for revision
          </Button>
        </div>
      )}
      {request.stage === "APPROVING" && !canDecide && currentStep && (
        <div className="text-10.5 text-faint">
          {currentStep.approverId ? `Waiting on ${currentStep.approverName ?? currentStep.label}.` : `Waiting — ${currentStep.label} is currently vacant.`}
        </div>
      )}

      {isRequester && isEditable(request.stage) && !revising && (
        <div>
          <Button variant="primary" onClick={() => setRevising(true)}>
            Edit &amp; resubmit
          </Button>
        </div>
      )}
      {revising && (
        <div className="flex flex-col gap-8 pt-4 border-t border-border">
          <label className="flex flex-col gap-3">
            <span className={labelCls}>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} max-w-[360px]`} />
          </label>
          <LinesEditor lines={lines} onChange={setLines} categories={categories} openNeeds={[]} />
          <div className="flex items-center gap-8">
            <Button variant="primary" onClick={resubmit} disabled={busy || !title.trim() || !toInputLines(lines).length}>
              Resubmit
            </Button>
            <Button onClick={() => setRevising(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isRequester && !isFinished(request.stage) && request.stage !== "REVISING" && (
        <div>
          <button className="text-10.5 text-bad" onClick={cancel} disabled={busy}>
            Withdraw this request
          </button>
        </div>
      )}

      {showAdvance && (
        <div className="pt-4 border-t border-border flex items-center justify-between">
          <span className="text-10.5 text-dim">{STAGE_HELP[request.stage]}</span>
          <Button variant="primary" onClick={advance} disabled={busy}>
            Advance
          </Button>
        </div>
      )}

      {showReceive && (
        <div className="pt-4 border-t border-border flex flex-col gap-8">
          {request.lines
            .filter((l) => l.receivedQty === null || l.receivedQty < l.qty)
            .map((l) => {
              const f = receiveFieldsFor(l.id, l.categoryId);
              return (
                <div key={l.id} className="flex flex-wrap items-end gap-8">
                  <span className="text-10.5 min-w-[140px]">{l.name}</span>
                  <label className="flex flex-col gap-3">
                    <span className={labelCls}>Qty arrived</span>
                    <input value={f.qty} onChange={(e) => updateReceive(l.id, l.categoryId, { qty: e.target.value })} type="number" min="0.0001" className={`${inputCls} w-[80px]`} />
                  </label>
                  <label className="flex flex-col gap-3">
                    <span className={labelCls}>Category</span>
                    <select value={f.categoryId} onChange={(e) => loadContainers(l.id, l.categoryId, e.target.value)} className={`${inputCls} min-w-[150px]`}>
                      <option value="">Choose…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-3">
                    <span className={labelCls}>Into</span>
                    <select value={f.storeParentId} onChange={(e) => updateReceive(l.id, l.categoryId, { storeParentId: e.target.value })} className={`${inputCls} min-w-[180px]`} disabled={!f.categoryId}>
                      <option value="">Choose a store…</option>
                      {f.containers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {[...c.path, c.name].join(" / ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button variant="primary" onClick={() => receive(l.id, l.categoryId)} disabled={busy || !f.qty || !f.categoryId || !f.storeParentId}>
                    Register arrived stock
                  </Button>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── Boxed lists ────────────────────────────────────────────────────────────────

function RequestListPanel({
  title,
  box,
  viewerId,
  categories,
  emptyLabel,
  showReceive,
  showAdvance,
}: {
  title: string;
  box: "mine" | "pipeline" | "receiving";
  viewerId: string;
  categories: ResourceCategoryDto[];
  emptyLabel: string;
  showReceive?: boolean;
  showAdvance?: boolean;
}) {
  const [rows, setRows] = useState<PurchaseRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .get<PurchaseRequestDto[]>(`/resources/purchase-requests?box=${box}`)
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load requests"));
  }
  useEffect(load, [box]);

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel title={title}>
        {rows === null ? (
          <PanelLoading rows={3} />
        ) : rows.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">{emptyLabel}</div>
        ) : (
          <div className="p-12 flex flex-col gap-10">
            {rows.map((r) => (
              <RequestCard key={r.id} request={r} viewerId={viewerId} categories={categories} onChanged={load} showReceive={showReceive} showAdvance={showAdvance} />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PurchasingPage() {
  const { user, me } = useAuth();
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const roles = useMemo(() => user?.roles ?? [], [user]);
  if (!user) return null;

  const isStudent = roles.includes("STUDENT");
  const canCompile = roles.includes("MANAGER") || roles.includes("SYS_ADMIN");
  const canRunPipeline = roles.includes("PROCUREMENT") || roles.includes("SYS_ADMIN");
  const canReceive = roles.includes("STORE_KEEPER") || roles.includes("SYS_ADMIN");
  const ownNodeId = me?.scope?.isOccupant ? me.scope.nodeId : null;

  return (
    <Screen>
      {!isStudent && <RaiseNeedPanel categories={categories} />}
      {canCompile && ownNodeId && <CompilePanel orgNodeId={ownNodeId} categories={categories} onCompiled={() => setRefreshKey((k) => k + 1)} />}
      {canCompile && !ownNodeId && (
        <Panel title="Compile a purchase request">
          <div className="px-14 py-12 text-11 text-dim">You don't currently head a unit on the org chart, so there's nothing to compile a request for.</div>
        </Panel>
      )}
      <RequestListPanel key={`mine-${refreshKey}`} title="My requests" box="mine" viewerId={user.id} categories={categories} emptyLabel="You haven't compiled any purchase requests." />
      {canRunPipeline && (
        <RequestListPanel key={`pipeline-${refreshKey}`} title="Pipeline" box="pipeline" viewerId={user.id} categories={categories} emptyLabel="Nothing is currently on order." showAdvance />
      )}
      {canReceive && (
        <RequestListPanel key={`receiving-${refreshKey}`} title="Receive" box="receiving" viewerId={user.id} categories={categories} emptyLabel="Nothing has arrived at the store yet." showReceive />
      )}
    </Screen>
  );
}

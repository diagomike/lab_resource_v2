"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ChainStepDto,
  CompilePurchaseInput,
  ContainerOptionDto,
  DepartmentPurchasablesDto,
  NeedLineDto,
  PurchaseRequestDto,
  ResourceCategoryDto,
} from "@/lib/shared";
import { TreePicker, containerTreeOptions } from "@/components/TreePicker";
import { PURCHASE_UNITS } from "@/lib/shared";
import { STAGE_HELP, STAGE_LABEL, isEditable, isFinished } from "@/lib/domain/purchasing";
import { suggestedLines } from "@/lib/domain/purchasables";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Panel, Screen, ErrorNote, Button, Tag, ConfirmDialog } from "@/components/ui";
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

/** `ended`: the request is withdrawn, rejected or closed — a step still marked pending is
 *  no longer waiting on anyone, so it isn't highlighted as if it were. */
function ChainTrail({ steps, ended = false }: { steps: ChainStepDto[]; ended?: boolean }) {
  if (!steps.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-6">
      {steps.map((s, i) => (
        <span key={s.id} className="flex items-center gap-6">
          {i > 0 && <span className="text-faint">→</span>}
          <Tag tone={ended && s.status === "PENDING" ? "neutral" : STEP_TONE[s.status]}>
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
                  {n.purchaseReference && n.purchaseStage && (
                    <div className="text-9.5 text-dim">
                      Carried into {n.purchaseReference} · {STAGE_LABEL[n.purchaseStage]}
                    </div>
                  )}
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

// ── Department purchasables — the labs' ideal state vs. the live register ─────────

/** Read-only roll-up of every lab this unit owns against its approved ideal targets
 *  (`lib/domain/purchasables.ts`). "Fill request lines" hands the suggestion to the
 *  lines editor below — the head still edits, reduces or removes anything before
 *  submitting; nothing here is ever sent upward on its own. */
function PurchasablesSection({ orgNodeId, onFill }: { orgNodeId: string; onFill: (lines: EditableLine[]) => void }) {
  const [data, setData] = useState<DepartmentPurchasablesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeBroken, setIncludeBroken] = useState(true);
  const [expanded, setExpanded] = useState(false);

  function compute() {
    setError(null);
    setExpanded(true);
    api
      .get<DepartmentPurchasablesDto>(`/resources/departments/${encodeURIComponent(orgNodeId)}/purchasables`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not compute purchasables"));
  }

  function fill() {
    if (!data) return;
    onFill(
      suggestedLines(data.rows, includeBroken).map((l) => ({
        ...emptyLine(),
        name: l.name,
        qty: String(l.qty),
        unit: "pcs",
        categoryId: l.categoryId,
        justification: l.justification,
      })),
    );
  }

  const suggestionCount = data ? suggestedLines(data.rows, includeBroken).length : 0;

  return (
    <div className="flex flex-col gap-8 border border-border rounded-3 p-10">
      <div className="flex items-center justify-between gap-8">
        <div className="text-10.5 text-dim">Start from what your labs are missing against their approved ideal state.</div>
        <Button onClick={compute}>{data ? "Recompute" : "Compute from labs' ideal vs current"}</Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {expanded && data === null && !error && <PanelLoading rows={2} />}
      {data && data.rows.length === 0 && (
        <div className="text-10.5 text-faint">No lab owned by {data.orgNodeName} has an approved ideal target yet.</div>
      )}
      {data && data.rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-11">
              <thead>
                <tr className="text-9.5 uppercase tracking-label text-faint border-b border-border">
                  <th className="text-left px-8 py-6">Category</th>
                  <th className="text-right px-8 py-6">Ideal</th>
                  <th className="text-right px-8 py-6">Current</th>
                  <th className="text-right px-8 py-6">Gap</th>
                  {/* R2-6 of the 2026-09-23 run: this counts every unit that needs attention, not only BROKEN ones. */}
                  <th className="text-right px-8 py-6" title="Broken, impaired, under maintenance or lost — every unit that needs attention">
                    Not working
                  </th>
                  <th className="text-right px-8 py-6" title="What Fill request lines will order for this category">
                    To buy
                  </th>
                  <th className="text-left px-8 py-6">By lab</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.categoryId} className="border-b border-border last:border-0">
                    <td className="px-8 py-6">{r.categoryName}</td>
                    <td className="px-8 py-6 text-right font-mono">{r.idealQty}</td>
                    <td className="px-8 py-6 text-right font-mono">{r.actualCount}</td>
                    <td className={`px-8 py-6 text-right font-mono ${r.gap > 0 ? "text-warn" : ""}`}>{r.gap}</td>
                    <td className={`px-8 py-6 text-right font-mono ${r.brokenCount > 0 ? "text-bad" : ""}`}>{r.brokenCount}</td>
                    <td className="px-8 py-6 text-right font-mono font-semibold">{r.buyGap + (includeBroken ? r.replaceCount : 0)}</td>
                    <td className="px-8 py-6 text-10 text-dim">
                      {/* A department can have dozens of labs — a count that opens, not a wall of text. */}
                      <details>
                        <summary className="cursor-pointer select-none">
                          {r.labs.filter((l) => l.gap > 0 || l.brokenCount > 0).length} of {r.labs.length} labs short or not working
                        </summary>
                        <div className="mt-4 flex flex-col gap-1">
                          {r.labs
                            .filter((l) => l.gap > 0 || l.brokenCount > 0)
                            .map((l) => (
                              <span key={l.labItemId}>
                                {l.labName}: {l.actualCount}/{l.idealQty}
                                {l.brokenCount ? ` · ${l.brokenCount} not working` : ""}
                              </span>
                            ))}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-10">
            <label className="flex items-center gap-6 text-10.5">
              <input type="checkbox" checked={includeBroken} onChange={(e) => setIncludeBroken(e.target.checked)} />
              Include replacements for items that are broken or lost
            </label>
            <Button variant="primary" onClick={fill} disabled={suggestionCount === 0}>
              Fill request lines ({suggestionCount})
            </Button>
            <span className="text-9.5 text-faint">Replaces the lines below — edit or reduce them before submitting.</span>
          </div>
          <div className="text-10 text-faint leading-normal">
            <strong className="font-medium">To buy</strong> never counts a part twice: a missing workstation is one Workstation Setup (its computer, monitor and
            parts come with it). Replacements are for items that failed themselves — an impaired computer is mended by replacing its broken part, and items
            under maintenance are already being repaired.
          </div>
        </>
      )}
    </div>
  );
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
        <OpenNeedsList
          needs={openNeeds}
          carried={new Set(lines.map((l) => l.fromNeedId).filter(Boolean))}
          onAdd={(n) =>
            setLines((prev) => {
              const line = { ...emptyLine(), fromNeedId: n.id, name: n.name, qty: String(n.qty), unit: n.unit ?? "", categoryId: n.categoryId ?? "", justification: n.reason };
              // Fill the first blank line rather than leaving an empty one above it.
              const blank = prev.findIndex((l) => !l.name.trim() && !l.fromNeedId);
              return blank >= 0 ? prev.map((l, i) => (i === blank ? { ...line, key: l.key } : l)) : [...prev, line];
            })
          }
          onDeclined={loadOpenNeeds}
        />
        <label className="flex flex-col gap-3">
          <span className={labelCls}>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Q1 lab equipment" className={`${inputCls} max-w-[360px]`} />
        </label>
        <PurchasablesSection orgNodeId={orgNodeId} onFill={setLines} />
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

/** The unit's open needs, for the head: who asked, why, and two ways to answer — carry
 *  it into the request being compiled, or decline it with a reason the raiser sees.
 *  (Before this, the only trace of them was the "From need" picker on a line, and the
 *  server's decline endpoint had no screen at all.) */
function OpenNeedsList({
  needs,
  carried,
  onAdd,
  onDeclined,
}: {
  needs: NeedLineDto[];
  carried: Set<string>;
  onAdd: (need: NeedLineDto) => void;
  onDeclined: () => void;
}) {
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decline(id: string) {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<NeedLineDto>(`/resources/needs/${encodeURIComponent(id)}/decline`, { note: note.trim() });
      setDeclining(null);
      setNote("");
      onDeclined();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not decline this need");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <span className={labelCls}>Open needs in this unit</span>
      {needs.length === 0 ? (
        <div className="text-10.5 text-faint">No open needs — nobody in the unit is waiting on a purchase.</div>
      ) : (
        <div className="border border-border rounded-2 divide-y divide-border">
          {error && <ErrorNote>{error}</ErrorNote>}
          {needs.map((n) => (
            <div key={n.id} className="px-10 py-8 flex flex-col gap-6">
              <div className="flex flex-wrap items-baseline gap-8">
                <span className="text-11.5 font-medium">{n.name}</span>
                <span className="text-10.5 font-mono text-dim">
                  × {n.qty}
                  {n.unit ? ` ${n.unit}` : ""}
                </span>
                <span className="text-10.5 text-dim">
                  raised by {n.raisedByName} · {new Date(n.createdAt).toLocaleDateString()}
                </span>
                <span className="flex-1" />
                <Button onClick={() => onAdd(n)} disabled={carried.has(n.id)}>
                  {carried.has(n.id) ? "In this request" : "Add to request"}
                </Button>
                <Button variant="danger" onClick={() => (setDeclining(declining === n.id ? null : n.id), setNote(""))}>
                  Decline…
                </Button>
              </div>
              <div className="text-10.5 text-dim">“{n.reason}”</div>
              {declining === n.id && (
                <form
                  className="flex flex-wrap items-center gap-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void decline(n.id);
                  }}
                >
                  <input
                    autoFocus
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why — shown to the person who raised it"
                    aria-label="Reason for declining"
                    className={`${inputCls} flex-1 min-w-[240px]`}
                  />
                  <Button type="submit" variant="danger" disabled={busy || !note.trim()}>
                    Decline need
                  </Button>
                  <Button onClick={() => setDeclining(null)}>Cancel</Button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── One request, shared by every list below ────────────────────────────────────

/** The request's permanent record — every submission, decision (with who and why),
 *  pipeline report and receipt, in order. Survives send-backs, unlike the live
 *  chain above it. */
export function HistoryTimeline({ history }: { history: PurchaseRequestDto["history"] }) {
  const [open, setOpen] = useState(false);
  if (!history.length) return null;
  const shown = open ? history : history.slice(-3);
  return (
    <div className="flex flex-col gap-3 border-l-2 border-border pl-8">
      {history.length > 3 && (
        <button type="button" className="self-start text-9.5 text-accent" onClick={() => setOpen((o) => !o)}>
          {open ? "Show latest only" : `Show full history (${history.length})`}
        </button>
      )}
      {shown.map((e, i) => (
        <div key={`${e.at}-${i}`} className="text-10 text-dim">
          <span className="text-faint">{new Date(e.at).toLocaleString()}</span> · <span className="font-medium">{e.byName}</span> · {STAGE_LABEL[e.stage]}
          {e.note ? <span> — {e.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

function RequestCard({
  request,
  viewerId,
  categories,
  onChanged,
  showReceive,
  showAdvance,
  canRunPipeline,
  readOnly,
}: {
  request: PurchaseRequestDto;
  viewerId: string;
  categories: ResourceCategoryDto[];
  onChanged: () => void;
  showReceive?: boolean;
  showAdvance?: boolean;
  canRunPipeline?: boolean;
  /** Status-following only — no decide/revise/withdraw affordances. */
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
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
  const canDecide = !readOnly && request.stage === "APPROVING" && currentStep?.approverId === viewerId;
  const isRequester = !readOnly && request.raisedById === viewerId;
  const ordered = request.lines.reduce((n, l) => n + l.qty, 0);
  const received = request.lines.reduce((n, l) => n + (l.receivedQty ?? 0), 0);

  async function decide(decision: "APPROVE" | "REJECT" | "REVISE") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/decide`, { decision, note: note.trim() || undefined });
      setNote("");
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

  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  async function cancel(procurementNote?: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/cancel`, procurementNote !== undefined ? { note: procurementNote } : undefined);
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
      await api.post(`/resources/purchase-requests/${request.id}/advance`, { note: note.trim() || undefined });
      setNote("");
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

  // A line usually arrives with its category already set (it was ordered as one), so the
  // "Into" choices must be loaded for it up front — they used to load only when the
  // category was CHANGED, which left the pre-filled lines with no destination at all.
  useEffect(() => {
    if (!showReceive) return;
    for (const l of request.lines) {
      if (!l.categoryId || receiveState[l.id]) continue;
      if (l.receivedQty !== null && l.receivedQty >= l.qty) continue;
      void loadContainers(l.id, l.categoryId, l.categoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReceive, request.id]);

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

      <ChainTrail steps={request.steps} ended={isFinished(request.stage)} />
      {request.feedback && <div className="text-10.5 text-dim italic">"{request.feedback}"</div>}
      <HistoryTimeline history={request.history} />
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
        <div className="flex flex-wrap items-center gap-8 pt-4">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (why — shown to everyone following this request)" className={`${inputCls} min-w-[260px] flex-1`} />
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

      {/* F-047 of the 2026-09-15 campaign — the raiser may withdraw only while the
          request is still theirs to decide (APPROVING; REVISING has its own Edit &
          resubmit path above). From ORDER_PLACED on, procurement has already acted
          on it — placing an order, finding a buyer — so cancelling from there is
          procurement's own call, with a required note (below), not a silent
          withdrawal nobody downstream is told about. */}
      {isRequester && request.stage === "APPROVING" && (
        <div>
          {/* Withdrawing ends the request for everyone in the chain — confirm first, like
              every other consequential action in the app. */}
          <button className="text-10.5 text-bad" onClick={() => setConfirmWithdraw(true)} disabled={busy}>
            Withdraw this request
          </button>
        </div>
      )}
      {confirmWithdraw && (
        <ConfirmDialog
          title="Withdraw this request"
          message={`Withdraw ${request.reference}? It stops wherever it is in the approval chain, and any needs carried into it reopen so they can go into another request.`}
          confirmLabel="Withdraw"
          tone="danger"
          busy={busy}
          error={null}
          onConfirm={async () => {
            await cancel();
            setConfirmWithdraw(false);
          }}
          onCancel={() => setConfirmWithdraw(false)}
        />
      )}
      {canRunPipeline && !isFinished(request.stage) && request.stage !== "APPROVING" && request.stage !== "REVISING" && (
        <ProcurementCancel busy={busy} onCancel={cancel} />
      )}

      {showAdvance && (
        <div className="pt-4 border-t border-border flex flex-wrap items-center justify-between gap-8">
          <span className="text-10.5 text-dim">{STAGE_HELP[request.stage]}</span>
          <div className="flex items-center gap-8">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className={`${inputCls} min-w-[200px]`} />
            <Button variant="primary" onClick={advance} disabled={busy}>
              Advance
            </Button>
          </div>
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
                    <div className="min-w-[220px]">
                      <TreePicker
                        options={containerTreeOptions(f.containers)}
                        value={f.storeParentId}
                        onChange={(id) => updateReceive(l.id, l.categoryId, { storeParentId: id })}
                        disabled={!f.categoryId}
                        placeholder="Choose a store…"
                      />
                    </div>
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

/** F-047 of the 2026-09-15 campaign — procurement's own cancellation of a placed
 *  order, which (unlike the raiser's plain withdrawal) requires a note: this is
 *  what everyone tracking the order — the store, whoever's watching the pipeline —
 *  will read to understand why it stopped. */
function ProcurementCancel({ busy, onCancel }: { busy: boolean; onCancel: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <button className="text-10.5 text-bad" onClick={() => setOpen(true)} disabled={busy}>
        Cancel this order…
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-6 pt-4 border-t border-border">
      <label className="flex flex-col gap-3">
        <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Reason (required — visible to everyone tracking this order)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="border border-border2 bg-panel h-26 px-8 rounded-2 text-11.5 outline-none focus:border-accent" />
      </label>
      <div className="flex items-center gap-8">
        <Button variant="danger" disabled={busy || !note.trim()} onClick={() => onCancel(note.trim())}>
          Confirm cancellation
        </Button>
        <Button onClick={() => setOpen(false)} disabled={busy}>
          Never mind
        </Button>
      </div>
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
  canRunPipeline,
  readOnly,
}: {
  title: string;
  box: "mine" | "pipeline" | "receiving" | "tracking";
  viewerId: string;
  categories: ResourceCategoryDto[];
  emptyLabel: string;
  showReceive?: boolean;
  showAdvance?: boolean;
  /** F-047 of the 2026-09-15 campaign — procurement may cancel a request that's
   *  already ORDER_PLACED or beyond, with a required note; the raiser's own
   *  withdrawal stops being offered from that stage on. */
  canRunPipeline?: boolean;
  readOnly?: boolean;
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
              <RequestCard
                key={r.id}
                request={r}
                viewerId={viewerId}
                categories={categories}
                onChanged={load}
                showReceive={showReceive}
                showAdvance={showAdvance}
                canRunPipeline={canRunPipeline}
                readOnly={readOnly}
              />
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
  const canRunPipeline = roles.includes("PROCUREMENT") || roles.includes("SYS_ADMIN");
  const canReceive = roles.includes("STORE_KEEPER") || roles.includes("SYS_ADMIN");
  // Occupancy decides who heads a unit (F-017 of the 2026-09-15 campaign) — not the
  // MANAGER role label, which used to gate this panel independently of `ownNodeId`
  // and could silently disagree with it (a role change, or a fresh appointment,
  // leaving the panel showing the wrong thing until the role happened to match).
  const ownNodeId = me?.scope?.isOccupant ? me.scope.nodeId : null;

  return (
    <Screen>
      {!isStudent && <RaiseNeedPanel categories={categories} />}
      {ownNodeId && <CompilePanel orgNodeId={ownNodeId} categories={categories} onCompiled={() => setRefreshKey((k) => k + 1)} />}
      <RequestListPanel key={`mine-${refreshKey}`} title="My requests" box="mine" viewerId={user.id} categories={categories} emptyLabel="You haven't compiled any purchase requests." canRunPipeline={canRunPipeline} />
      {canRunPipeline && (
        <RequestListPanel key={`pipeline-${refreshKey}`} title="Pipeline" box="pipeline" viewerId={user.id} categories={categories} emptyLabel="Nothing is currently on order." showAdvance canRunPipeline />
      )}
      {canReceive && (
        <RequestListPanel key={`receiving-${refreshKey}`} title="Receive" box="receiving" viewerId={user.id} categories={categories} emptyLabel="Nothing has arrived at the store yet." showReceive />
      )}
      <RequestListPanel
        key={`tracking-${refreshKey}`}
        title="Purchase request status"
        box="tracking"
        viewerId={user.id}
        categories={categories}
        emptyLabel="No purchase request involving your unit or office yet."
        readOnly
      />
    </Screen>
  );
}

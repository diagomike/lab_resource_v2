"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  ChainStepDto,
  CompilePurchaseInput,
  LabSummaryDto,
  NeedLineDto,
  PurchaseAttachmentDto,
  PurchaseRequestDto,
  ReplacementSuggestionDto,
  ResourceCategoryDto,
} from "@/lib/shared";
import { PURCHASE_UNITS } from "@/lib/shared";
import { STAGE_HELP, STAGE_LABEL, isEditable, isFinished, linesFromNeeds } from "@/lib/domain/purchasing";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Panel, Screen, ErrorNote, Button, Tag, ConfirmDialog, Tabs } from "@/components/ui";
import { PanelLoading, InlineError } from "@/components/states";
import { ImportsPanel } from "./ImportsPanel";
import { AttachmentPicker, RequestDocuments, discardAttachments } from "./PurchaseAttachments";
import { CategoryCombobox } from "./AddModal";

const inputCls = "h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent";
const labelCls = "text-10 uppercase tracking-label text-dim font-semibold";

/** What a need's status means to the person following it. */
function needStatusText(n: NeedLineDto): { text: string; tone: "warn" | "good" | "bad" | "neutral" } {
  if (n.status === "DECLINED") return { text: "Declined", tone: "bad" };
  if (n.status === "CARRIED") return { text: n.purchaseReference ? `In ${n.purchaseReference}` : "In a request", tone: "good" };
  return { text: "Waiting for the head", tone: "warn" };
}

const PRIORITY_TEXT: Record<NeedLineDto["priority"], string> = { ESSENTIAL: "Essential", IMPORTANT: "Important", NICE_TO_HAVE: "Nice to have" };
const PRIORITY_TONE: Record<NeedLineDto["priority"], "bad" | "warn" | "neutral"> = { ESSENTIAL: "bad", IMPORTANT: "warn", NICE_TO_HAVE: "neutral" };
const PRIORITY_HELP: Record<NeedLineDto["priority"], string> = {
  ESSENTIAL: "Classes or research can't run without it",
  IMPORTANT: "Work is slowed or limited without it",
  NICE_TO_HAVE: "It would improve the lab",
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
          {i > 0 && <span className="text-faint" aria-hidden="true">→</span>}
          <Tag tone={ended && s.status === "PENDING" ? "neutral" : STEP_TONE[s.status]}>
            {s.label}
            {s.status === "PENDING" && !s.approverId ? " (vacant)" : s.approverName ? ` · ${s.approverName}` : ""}
          </Tag>
        </span>
      ))}
    </div>
  );
}

// ── A custodian asks for something for their lab ───────────────────────────────

function AskForSomething({ categories, labs, replacing, onCancelReplacing, onRaised }: {
  categories: ResourceCategoryDto[];
  labs: LabSummaryDto[];
  /** Set when the custodian chose "Ask for replacements" on broken or lost items. */
  replacing: ReplacementSuggestionDto | null;
  onCancelReplacing: () => void;
  onRaised: () => void;
}) {
  const [labItemId, setLabItemId] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("pcs");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState<NeedLineDto["priority"]>("IMPORTANT");
  const [reason, setReason] = useState("");
  const [spec, setSpec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // One lab: it is chosen for you.
  useEffect(() => {
    if (!labItemId && labs.length === 1) setLabItemId(labs[0].id);
  }, [labs, labItemId]);

  // Asking for a replacement fills the form from the broken item.
  useEffect(() => {
    if (!replacing) return;
    setLabItemId(replacing.labItemId);
    setName(replacing.categoryName);
    setQty(String(replacing.items.length));
    setUnit("pcs");
    setCategoryId(replacing.categoryId);
    setPriority("ESSENTIAL");
    setReason(replacementReason(replacing));
    setDone(null);
  }, [replacing]);

  function reset() {
    setName("");
    setQty("1");
    setUnit("pcs");
    setCategoryId("");
    setPriority("IMPORTANT");
    setReason("");
    setSpec("");
  }

  async function submit() {
    if (!labItemId || !name.trim() || !reason.trim() || !(Number(qty) > 0)) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<NeedLineDto>("/resources/needs", {
        labItemId,
        name: name.trim(),
        qty: Number(qty),
        unit: unit || undefined,
        categoryId: categoryId || undefined,
        priority,
        kind: replacing ? "REPLACEMENT" : "NEW",
        replacesItemIds: replacing ? replacing.items.map((i) => i.id) : [],
        spec: spec.trim() || undefined,
        reason: reason.trim(),
      });
      setDone(`Sent to the head: ${name.trim()} × ${qty}.`);
      reset();
      onCancelReplacing();
      onRaised();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send this need");
    } finally {
      setBusy(false);
    }
  }

  if (!labs.length) {
    return (
      <Panel title="Ask for something">
        <div className="px-14 py-12 text-11.5 text-dim">You don&apos;t run a lab yet. Your department head assigns you to a lab, and then you can ask for what it needs.</div>
      </Panel>
    );
  }

  return (
    <Panel title={replacing ? `Ask for ${replacing.items.length === 1 ? "a replacement" : `${replacing.items.length} replacements`} — ${replacing.categoryName}, ${replacing.labName}` : "Ask for something"}>
      <form
        id="ask-for-something"
        className="p-14 flex flex-col gap-12 scroll-mt-14"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-11.5 text-dim">Tell your department head what a lab needs and why. The head gathers the labs&apos; needs into a purchase request.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        {done && <div className="text-11.5 text-good" role="status">{done}</div>}
        <div className="grid gap-12 sm:grid-cols-2">
          <label className="flex flex-col gap-4">
            <span className={labelCls}>For which lab</span>
            <select value={labItemId} onChange={(e) => setLabItemId(e.target.value)} className={inputCls} disabled={!!replacing}>
              <option value="">Choose a lab…</option>
              {labs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-4">
            <span className={labelCls}>What is needed</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Digital oscilloscope" className={inputCls} />
          </label>
          <div className="flex gap-8">
            <label className="flex flex-col gap-4 w-[90px]">
              <span className={labelCls}>How many</span>
              <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="0.0001" step="any" className={inputCls} />
            </label>
            <label className="flex flex-col gap-4 flex-1">
              <span className={labelCls}>Unit</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
                {PURCHASE_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-4">
            <span className={labelCls}>Kind of resource (if the register knows it)</span>
            <CategoryCombobox categories={categories.filter((c) => c.active)} value={categoryId} loading={false} onChange={setCategoryId} onAddCategory={() => window.open("/categories?new=1", "_blank")} />
          </div>
        </div>
        <fieldset className="flex flex-col gap-6">
          <legend className={`${labelCls} mb-4`}>How much it matters</legend>
          <div className="flex flex-wrap gap-8">
            {(["ESSENTIAL", "IMPORTANT", "NICE_TO_HAVE"] as const).map((p) => (
              <label key={p} className={`flex-1 min-w-[160px] cursor-pointer rounded-2 border px-10 py-8 ${priority === p ? "border-accent bg-soft" : "border-border2 hover:bg-panel2"}`}>
                <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="sr-only" />
                <span className="block text-11.5 font-semibold">{PRIORITY_TEXT[p]}</span>
                <span className="block text-10.5 text-dim mt-2">{PRIORITY_HELP[p]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-4">
          <span className={labelCls}>Why the lab needs it</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. 25 students share 3 working units in the Signals practical" className={`${inputCls} h-auto py-6`} />
        </label>
        <label className="flex flex-col gap-4">
          <span className={labelCls}>Specification (optional)</span>
          <input value={spec} onChange={(e) => setSpec(e.target.value)} placeholder="Model, size, a supplier's quote reference…" className={inputCls} />
        </label>
        <div className="flex items-center gap-8">
          <Button type="submit" variant="primary" disabled={busy || !labItemId || !name.trim() || !reason.trim()}>
            {busy ? "Sending…" : "Send to the head"}
          </Button>
          {replacing && <Button onClick={() => (onCancelReplacing(), setName(""), setQty("1"), setCategoryId(""), setReason(""))}>Not a replacement</Button>}
        </div>
      </form>
    </Panel>
  );
}

/** "Chair 03 and Chair 07 are broken." — or, when the names don't tell them apart,
 *  "13 Chair items: 12 broken, 1 lost." */
function replacementReason(r: ReplacementSuggestionDto): string {
  const broken = r.items.filter((i) => i.status === "BROKEN").length;
  const lost = r.items.length - broken;
  const names = [...new Set(r.items.map((i) => i.name))];
  if (names.length === r.items.length && names.length <= 3) {
    const state = lost && broken ? "broken or lost" : lost ? "lost" : "broken";
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `${list} ${names.length === 1 ? "is" : "are"} ${state}.`;
  }
  const state = lost && broken ? `${broken} broken, ${lost} lost` : lost ? "all lost" : "all broken";
  return `${r.items.length} ${r.categoryName} items: ${state}.`;
}

/** Broken or lost things in the custodian's labs that nobody has asked to replace — one
 *  row per kind of thing per lab. */
function ReplacementsPanel({ rows, onAsk }: { rows: ReplacementSuggestionDto[]; onAsk: (r: ReplacementSuggestionDto) => void }) {
  if (!rows.length) return null;
  const total = rows.reduce((n, r) => n + r.items.length, 0);
  return (
    <Panel title={`Broken or lost — not asked for yet (${total})`}>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={`${r.labItemId}:${r.categoryId}`} className="px-14 py-8 flex flex-wrap items-center gap-8">
            <span className="text-11.5 font-medium">
              {r.items.length} × {r.categoryName}
            </span>
            <span className="text-10.5 text-dim">· {r.labName}</span>
            <span className="text-10.5 text-dim basis-full sm:basis-auto">{replacementReason(r)}</span>
            <span className="flex-1" />
            <Button onClick={() => onAsk(r)}>Ask for {r.items.length === 1 ? "a replacement" : `${r.items.length} replacements`}</Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MyNeeds({ needs, onChanged }: { needs: NeedLineDto[] | null; onChanged: () => void }) {
  const [withdrawing, setWithdrawing] = useState<NeedLineDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    if (!withdrawing) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/resources/needs/${encodeURIComponent(withdrawing.id)}`);
      setWithdrawing(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not withdraw this need");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="What you've asked for">
      {needs === null ? (
        <PanelLoading rows={2} />
      ) : needs.length === 0 ? (
        <div className="px-14 py-12 text-11.5 text-dim">Nothing yet. What you ask for appears here, with what the head decided.</div>
      ) : (
        <ul className="divide-y divide-border">
          {needs.map((n) => {
            const status = needStatusText(n);
            return (
              <li key={n.id} className="px-14 py-9 flex flex-wrap items-start gap-10">
                <div className="flex-1 min-w-[220px] flex flex-col gap-2">
                  <div className="text-11.5">
                    <span className="font-medium">{n.name}</span>
                    <span className="font-mono text-dim">
                      {" "}
                      × {n.qty}
                      {n.unit ? ` ${n.unit}` : ""}
                    </span>
                    {n.labName && <span className="text-dim"> · {n.labName}</span>}
                  </div>
                  <div className="text-10.5 text-dim">
                    {n.kind === "REPLACEMENT" && n.replacesItems.length ? `Replaces ${n.replacesItems.length === 1 ? n.replacesItems[0].name : `${n.replacesItems.length} items`} · ` : ""}“{n.reason}”
                  </div>
                  {n.status === "DECLINED" && n.note && <div className="text-10.5 text-bad">Head: “{n.note}”</div>}
                  {n.purchaseReference && n.purchaseStage && (
                    <div className="text-10.5 text-dim">
                      {n.purchaseReference} · {STAGE_LABEL[n.purchaseStage]}
                    </div>
                  )}
                </div>
                <Tag tone={PRIORITY_TONE[n.priority]}>{PRIORITY_TEXT[n.priority]}</Tag>
                <Tag tone={status.tone}>{status.text}</Tag>
                {n.status === "OPEN" && (
                  <button type="button" className="text-10.5 text-bad hover:underline" onClick={() => setWithdrawing(n)}>
                    Withdraw
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {withdrawing && (
        <ConfirmDialog
          title="Withdraw this need"
          message={`Take back your request for ${withdrawing.name}? The head hasn't acted on it yet.`}
          confirmLabel="Withdraw"
          tone="warn"
          busy={busy}
          error={error}
          onConfirm={withdraw}
          onCancel={() => setWithdrawing(null)}
        />
      )}
    </Panel>
  );
}

// ── A head reads the labs' needs ────────────────────────────────────────────────

function LabNeedsReview({
  needs,
  error,
  onRetry,
  onDeclined,
  onBuild,
}: {
  needs: NeedLineDto[] | null;
  error: string | null;
  onRetry: () => void;
  onDeclined: () => void;
  /** Starts a purchase request from the chosen needs. */
  onBuild: (chosen: NeedLineDto[]) => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [declining, setDeclining] = useState<NeedLineDto | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);

  const byLab = useMemo(() => {
    const m = new Map<string, NeedLineDto[]>();
    for (const n of needs ?? []) m.set(n.labName ?? "No lab named", [...(m.get(n.labName ?? "No lab named") ?? []), n]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [needs]);

  const toggle = (id: string) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  async function decline() {
    if (!declining || !note.trim()) return;
    setBusy(true);
    setDeclineError(null);
    try {
      await api.post<NeedLineDto>(`/resources/needs/${encodeURIComponent(declining.id)}/decline`, { note: note.trim() });
      setDeclining(null);
      setNote("");
      setChosen((prev) => {
        const next = new Set(prev);
        next.delete(declining.id);
        return next;
      });
      onDeclined();
    } catch (e) {
      setDeclineError(e instanceof ApiError ? e.message : "Could not decline this need");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="The labs' needs"
      actions={
        needs && needs.length > 0 ? (
          <Button variant="primary" disabled={chosen.size === 0} onClick={() => onBuild((needs ?? []).filter((n) => chosen.has(n.id)))}>
            Build a request from {chosen.size || "the chosen"} need{chosen.size === 1 ? "" : "s"}
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <InlineError message={error} onRetry={onRetry} />
      ) : needs === null ? (
        <PanelLoading rows={3} />
      ) : needs.length === 0 ? (
        <div className="px-14 py-12 text-11.5 text-dim">No open needs. When a custodian asks for something for a lab, it appears here for you to carry into a request or decline.</div>
      ) : (
        <div className="flex flex-col">
          <div className="px-14 py-8 text-10.5 text-dim border-b border-border flex items-center gap-10">
            <label className="flex items-center gap-6 cursor-pointer">
              <input type="checkbox" checked={chosen.size === needs.length} onChange={(e) => setChosen(e.target.checked ? new Set(needs.map((n) => n.id)) : new Set())} />
              Choose all {needs.length}
            </label>
            <span>Essential needs are listed first in each lab.</span>
          </div>
          {byLab.map(([lab, rows]) => (
            <section key={lab} className="border-b border-border last:border-0">
              <h3 className="px-14 pt-10 pb-4 text-11 font-semibold">{lab}</h3>
              <ul>
                {rows.map((n) => (
                  <li key={n.id} className="px-14 py-8 flex flex-wrap items-start gap-10 hover:bg-panel2">
                    <input type="checkbox" checked={chosen.has(n.id)} onChange={() => toggle(n.id)} aria-label={`Choose ${n.name} for ${lab}`} className="mt-3" />
                    <div className="flex-1 min-w-[220px] flex flex-col gap-2">
                      <div className="text-11.5">
                        <span className="font-medium">{n.name}</span>
                        <span className="font-mono text-dim">
                          {" "}
                          × {n.qty}
                          {n.unit ? ` ${n.unit}` : ""}
                        </span>
                        {n.categoryName && <span className="text-dim"> · {n.categoryName}</span>}
                      </div>
                      <div className="text-10.5 text-dim">
                        {n.kind === "REPLACEMENT" && n.replacesItems.length ? <span className="text-bad">Replaces {n.replacesItems.length === 1 ? n.replacesItems[0].name : `${n.replacesItems.length} broken or lost items`} · </span> : null}“{n.reason}”
                        {n.spec ? <span> · {n.spec}</span> : null}
                      </div>
                      <div className="text-10 text-faint">
                        {n.raisedByName} · {new Date(n.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Tag tone={PRIORITY_TONE[n.priority]}>{PRIORITY_TEXT[n.priority]}</Tag>
                    <button type="button" className="text-10.5 text-bad hover:underline" onClick={() => (setDeclining(n), setNote(""), setDeclineError(null))}>
                      Decline…
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {declining && (
        <ConfirmDialog
          title={`Decline: ${declining.name}`}
          tone="danger"
          confirmLabel="Decline"
          busy={busy}
          confirmDisabled={!note.trim()}
          error={declineError}
          message={
            <div className="flex flex-col gap-8">
              <span>
                {declining.raisedByName} sees your reason. It stays in their list as declined.
              </span>
              <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — e.g. not this budget year" aria-label="Reason for declining" className={inputCls} />
            </div>
          }
          onConfirm={decline}
          onCancel={() => setDeclining(null)}
        />
      )}
    </Panel>
  );
}

// ── Lines editor — shared by "build" and "revise and resubmit" ─────────────────

interface EditableLine {
  key: string;
  name: string;
  qty: string;
  unit: string;
  categoryId: string;
  estimatedUnitCost: string;
  justification: string;
  /** The labs' needs this line answers. */
  fromNeedIds: string[];
}

let lineKeyCounter = 0;
function emptyLine(): EditableLine {
  return { key: `l${lineKeyCounter++}`, name: "", qty: "1", unit: "pcs", categoryId: "", estimatedUnitCost: "", justification: "", fromNeedIds: [] };
}

function linesFor(needs: NeedLineDto[]): EditableLine[] {
  return linesFromNeeds(needs).map((l) => ({
    ...emptyLine(),
    name: l.name,
    qty: String(l.qty),
    unit: l.unit ?? "pcs",
    categoryId: l.categoryId ?? "",
    justification: l.justification,
    fromNeedIds: l.fromNeedIds,
  }));
}

function LinesEditor({ lines, onChange, categories }: { lines: EditableLine[]; onChange: (lines: EditableLine[]) => void; categories: ResourceCategoryDto[] }) {
  function update(key: string, patch: Partial<EditableLine>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  return (
    <div className="flex flex-col gap-8">
      {lines.map((l, i) => (
        <fieldset key={l.key} className="flex flex-col gap-8 border border-border rounded-2 p-10">
          <legend className="px-4 text-10.5 text-dim">
            Line {i + 1}
            {l.fromNeedIds.length ? ` · answers ${l.fromNeedIds.length} lab need${l.fromNeedIds.length === 1 ? "" : "s"}` : ""}
          </legend>
          <div className="flex flex-wrap items-end gap-8">
            <label className="flex flex-col gap-4 flex-1 min-w-[180px]">
              <span className={labelCls}>Item</span>
              <input value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} className={inputCls} />
            </label>
            <label className="flex flex-col gap-4 w-[80px]">
              <span className={labelCls}>Qty</span>
              <input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} type="number" min="0.0001" step="any" className={inputCls} />
            </label>
            <label className="flex flex-col gap-4">
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
            <label className="flex flex-col gap-4">
              <span className={labelCls}>Kind of resource</span>
              <select value={l.categoryId} onChange={(e) => update(l.key, { categoryId: e.target.value })} className={`${inputCls} min-w-[150px]`}>
                <option value="">Not sure</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-4 w-[110px]">
              <span className={labelCls}>Est. unit cost</span>
              <input value={l.estimatedUnitCost} onChange={(e) => update(l.key, { estimatedUnitCost: e.target.value })} type="number" min="0" className={inputCls} />
            </label>
          </div>
          <label className="flex flex-col gap-4">
            <span className={labelCls}>Justification</span>
            <textarea value={l.justification} onChange={(e) => update(l.key, { justification: e.target.value })} rows={2} className={`${inputCls} h-auto py-6`} />
          </label>
          <div>
            <button type="button" className="text-10.5 text-bad hover:underline disabled:opacity-40" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} disabled={lines.length === 1}>
              Remove this line
            </button>
          </div>
        </fieldset>
      ))}
      <div>
        <Button onClick={() => onChange([...lines, emptyLine()])}>+ Add a line</Button>
      </div>
    </div>
  );
}

function toInputLines(lines: EditableLine[]): CompilePurchaseInput["lines"] {
  return lines
    .filter((l) => l.name.trim() && Number(l.qty) > 0)
    .map((l) => ({
      name: l.name.trim(),
      qty: Number(l.qty),
      unit: l.unit || undefined,
      categoryId: l.categoryId || undefined,
      estimatedUnitCost: l.estimatedUnitCost ? Number(l.estimatedUnitCost) : undefined,
      justification: l.justification || undefined,
      fromNeedIds: l.fromNeedIds,
    }));
}

// ── A head builds a purchase request ─────────────────────────────────────────────

function BuildRequest({
  orgNodeId,
  unitName,
  categories,
  openNeeds,
  replacements,
  prefill,
  onClosePrefill,
  onBuilt,
}: {
  orgNodeId: string;
  unitName: string;
  categories: ResourceCategoryDto[];
  openNeeds: NeedLineDto[];
  replacements: ReplacementSuggestionDto[];
  /** Needs the head chose on the Lab needs tab. */
  prefill: NeedLineDto[] | null;
  onClosePrefill: () => void;
  onBuilt: (reference: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [files, setFiles] = useState<PurchaseAttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prefill?.length) return;
    setOpen(true);
    setLines(linesFor(prefill));
    if (!title) setTitle(`${unitName} — lab needs, ${new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}`);
    onClosePrefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const carried = new Set(lines.flatMap((l) => l.fromNeedIds));
  const notCarried = openNeeds.filter((n) => !carried.has(n.id));
  const blank = (l: EditableLine) => !l.name.trim() && !l.fromNeedIds.length;

  function addNeeds(needs: NeedLineDto[]) {
    setLines((prev) => [...prev.filter((l) => !blank(l)), ...linesFor(needs)]);
  }
  function addReplacement(r: ReplacementSuggestionDto) {
    setLines((prev) => [
      ...prev.filter((l) => !blank(l)),
      { ...emptyLine(), name: r.categoryName, qty: String(r.items.length), categoryId: r.categoryId, justification: `${r.labName}: ${replacementReason(r)}` },
    ]);
  }

  async function submit() {
    const inputLines = toInputLines(lines);
    if (!title.trim() || !inputLines.length) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<PurchaseRequestDto>("/resources/purchase-requests", { title: title.trim(), orgNodeId, lines: inputLines, attachmentIds: files.map((f) => f.id) });
      setTitle("");
      setLines([emptyLine()]);
      setFiles([]);
      setSubmitted((n) => n + 1);
      setOpen(false);
      onBuilt(created.reference);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send this request");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Panel title={`Purchase requests for ${unitName}`}>
        <div className="px-14 py-12 flex flex-wrap items-center gap-10">
          <span className="text-11.5 text-dim flex-1 min-w-[240px]">
            {openNeeds.length
              ? `${openNeeds.length} lab need${openNeeds.length === 1 ? " is" : "s are"} waiting. Build a request from them on the Lab needs tab, or start one here.`
              : "Build a request when your labs need something. It goes to the dean, the College Managing Director, the AVP and procurement."}
          </span>
          <Button variant="primary" onClick={() => setOpen(true)}>
            Build a purchase request
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Build a purchase request">
      <form
        className="p-14 flex flex-col gap-14"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && <ErrorNote>{error}</ErrorNote>}
        <label className="flex flex-col gap-4">
          <span className={labelCls}>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Signals lab equipment, 2026/27" className={`${inputCls} max-w-[460px]`} />
        </label>

        {notCarried.length > 0 && (
          <details className="border border-border rounded-2">
            <summary className="px-10 py-8 cursor-pointer text-11.5">
              {notCarried.length} more lab need{notCarried.length === 1 ? "" : "s"} you can add
            </summary>
            <ul className="divide-y divide-border">
              {notCarried.map((n) => (
                <li key={n.id} className="px-10 py-6 flex flex-wrap items-center gap-8 text-11">
                  <Tag tone={PRIORITY_TONE[n.priority]}>{PRIORITY_TEXT[n.priority]}</Tag>
                  <span className="font-medium">{n.name}</span>
                  <span className="font-mono text-dim">× {n.qty}</span>
                  <span className="text-dim">· {n.labName ?? "—"}</span>
                  <span className="flex-1" />
                  <Button onClick={() => addNeeds([n])}>Add</Button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {replacements.length > 0 && (
          <details className="border border-border rounded-2">
            <summary className="px-10 py-8 cursor-pointer text-11.5">
              {replacements.reduce((n, r) => n + r.items.length, 0)} broken or lost items nobody has asked to replace
            </summary>
            <ul className="divide-y divide-border">
              {replacements.map((r) => (
                <li key={`${r.labItemId}:${r.categoryId}`} className="px-10 py-6 flex flex-wrap items-center gap-8 text-11">
                  <span className="font-medium">
                    {r.items.length} × {r.categoryName}
                  </span>
                  <span className="text-dim">· {r.labName}</span>
                  <span className="flex-1" />
                  <Button onClick={() => addReplacement(r)}>Add {r.items.length === 1 ? "a replacement" : `${r.items.length} replacements`}</Button>
                </li>
              ))}
            </ul>
          </details>
        )}

        <LinesEditor lines={lines} onChange={setLines} categories={categories} />
        <div className="flex flex-col gap-4">
          <span className={labelCls}>Supporting documents</span>
          <AttachmentPicker
            key={submitted}
            value={files}
            onChange={setFiles}
            onBusyChange={setUploading}
            disabled={busy}
            label="Attach minutes or letters"
            hint="Approval minutes, stamped letters of authority, quotations (PDF, photo or scan, .xlsx)"
          />
        </div>
        <div className="flex items-center gap-8">
          <Button type="submit" variant="primary" disabled={busy || uploading || !title.trim() || !toInputLines(lines).length}>
            {busy ? "Sending…" : "Send for approval"}
          </Button>
          <Button
            onClick={() => {
              discardAttachments(files);
              setFiles([]);
              setOpen(false);
            }}
            disabled={busy}
          >
            Close
          </Button>
          <span className="text-10.5 text-dim">Goes to the dean first. Nothing is sent until you press Send.</span>
        </div>
      </form>
    </Panel>
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
          {e.attachments.length ? (
            <span className="text-faint">
              {" "}
              · {e.attachments.length} document{e.attachments.length === 1 ? "" : "s"}
            </span>
          ) : null}
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
  showAdvance,
  canRunPipeline,
  readOnly,
}: {
  request: PurchaseRequestDto;
  viewerId: string;
  categories: ResourceCategoryDto[];
  onChanged: () => void;
  showAdvance?: boolean;
  canRunPipeline?: boolean;
  /** Status-following only — no decide/revise/withdraw affordances. */
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [files, setFiles] = useState<PurchaseAttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lines, setLines] = useState<EditableLine[]>(() =>
    request.lines.map((l) => ({
      key: l.id,
      name: l.name,
      qty: String(l.qty),
      unit: l.unit ?? "",
      categoryId: l.categoryId ?? "",
      estimatedUnitCost: l.estimatedUnitCost !== null ? String(l.estimatedUnitCost) : "",
      justification: l.justification ?? "",
      fromNeedIds: l.fromNeedIds,
    })),
  );
  const [title, setTitle] = useState(request.title);

  const currentStep = request.steps.find((s) => s.status === "PENDING");
  const canDecide = !readOnly && request.stage === "APPROVING" && currentStep?.approverId === viewerId;
  const isRequester = !readOnly && request.raisedById === viewerId;
  const ordered = request.lines.reduce((n, l) => n + l.qty, 0);
  const received = request.lines.reduce((n, l) => n + (l.receivedQty ?? 0), 0);

  async function decide(decision: "APPROVE" | "REJECT" | "REVISE") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/decide`, { decision, note: note.trim() || undefined, attachmentIds: files.map((f) => f.id) });
      setNote("");
      setFiles([]);
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
      await api.put(`/resources/purchase-requests/${request.id}`, { title: title.trim(), orgNodeId: request.orgNodeId, lines: inputLines, attachmentIds: files.map((f) => f.id) });
      setFiles([]);
      setRevising(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resubmit this request");
    } finally {
      setBusy(false);
    }
  }

  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  async function cancel(procurementNote?: string, attachmentIds: string[] = []) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/purchase-requests/${request.id}/cancel`, procurementNote !== undefined ? { note: procurementNote, attachmentIds } : undefined);
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
      <RequestDocuments history={request.history} />
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
        <div className="flex flex-col gap-6 pt-4">
          <div className="flex flex-wrap items-center gap-8">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (why — shown to everyone following this request)" className={`${inputCls} min-w-[260px] flex-1`} />
            <Button variant="primary" onClick={() => decide("APPROVE")} disabled={busy || uploading}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => decide("REJECT")} disabled={busy || uploading}>
              Reject
            </Button>
            <Button onClick={() => decide("REVISE")} disabled={busy || uploading}>
              Send back for revision
            </Button>
          </div>
          <AttachmentPicker
            value={files}
            onChange={setFiles}
            onBusyChange={setUploading}
            disabled={busy}
            label="Attach a letter or minutes"
            hint="Goes with your decision — e.g. the letter or constraint you're citing"
          />
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
          <LinesEditor lines={lines} onChange={setLines} categories={categories} />
          <AttachmentPicker
            value={files}
            onChange={setFiles}
            onBusyChange={setUploading}
            disabled={busy}
            label="Attach documents"
            hint="Add what was asked for — earlier documents stay on the request"
          />
          <div className="flex items-center gap-8">
            <Button variant="primary" onClick={resubmit} disabled={busy || uploading || !title.trim() || !toInputLines(lines).length}>
              Resubmit
            </Button>
            <Button
              onClick={() => {
                discardAttachments(files);
                setFiles([]);
                setRevising(false);
              }}
              disabled={busy}
            >
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

    </div>
  );
}

/** F-047 of the 2026-09-15 campaign — procurement's own cancellation of a placed
 *  order, which (unlike the raiser's plain withdrawal) requires a note: this is
 *  what everyone tracking the order — the store, whoever's watching the pipeline —
 *  will read to understand why it stopped. */
function ProcurementCancel({ busy, onCancel }: { busy: boolean; onCancel: (note: string, attachmentIds: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<PurchaseAttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);

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
      <AttachmentPicker value={files} onChange={setFiles} onBusyChange={setUploading} disabled={busy} label="Attach a letter" hint="e.g. the supplier's withdrawal" />
      <div className="flex items-center gap-8">
        <Button variant="danger" disabled={busy || uploading || !note.trim()} onClick={() => onCancel(note.trim(), files.map((f) => f.id))}>
          Confirm cancellation
        </Button>
        <Button
          onClick={() => {
            discardAttachments(files);
            setFiles([]);
            setOpen(false);
          }}
          disabled={busy}
        >
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
  showAdvance,
  canRunPipeline,
  readOnly,
  excludeOwn,
}: {
  title: string;
  box: "mine" | "pipeline" | "tracking";
  viewerId: string;
  categories: ResourceCategoryDto[];
  emptyLabel: string;
  showAdvance?: boolean;
  /** F-047 of the 2026-09-15 campaign — procurement may cancel a request that's
   *  already ORDER_PLACED or beyond, with a required note; the raiser's own
   *  withdrawal stops being offered from that stage on. */
  canRunPipeline?: boolean;
  readOnly?: boolean;
  /** Leave out what this person raised themselves (shown in its own list). */
  excludeOwn?: boolean;
}) {
  const [rows, setRows] = useState<PurchaseRequestDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .get<PurchaseRequestDto[]>(`/resources/purchase-requests?box=${box}`)
      .then((all) => setRows(excludeOwn ? all.filter((r) => r.raisedById !== viewerId) : all))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load requests"));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

type Section = "needs" | "requests" | "arrivals";

/**
 * Purchasing, in three sections:
 *  - Lab needs: a custodian asks for what their lab needs; the head reads the labs'
 *    needs and builds a request from the ones they choose.
 *  - Requests: building a request (heads), following one, and procurement's pipeline.
 *  - Arrivals: what was bought and arrived — Property Administration records it, the
 *    store keeper loads the store.
 * Each person sees the sections they use, and lands on the one with their work.
 */
function PurchasingInner() {
  const { user, me } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [built, setBuilt] = useState<string | null>(null);

  const roles = useMemo(() => user?.roles ?? [], [user]);
  const isCustodian = roles.includes("CUSTODIAN") || roles.includes("SYS_ADMIN");
  // Occupancy decides who heads a unit (F-017 of the 2026-09-15 campaign) — not the
  // MANAGER role label. Only a department or college post builds a request.
  const headsUnit = me?.scope?.isOccupant && (me.scope.kind === "DEPARTMENT" || me.scope.kind === "COLLEGE") ? me.scope : null;
  const canRunPipeline = roles.includes("PROCUREMENT") || roles.includes("SYS_ADMIN");
  const canRecordImports = roles.includes("PROPERTY_ADMIN") || roles.includes("SYS_ADMIN");
  const canLoadStore = roles.includes("STORE_KEEPER") || roles.includes("SYS_ADMIN");
  const seesArrivals = canRecordImports || canLoadStore || roles.includes("PROCUREMENT");
  const seesNeeds = isCustodian || !!headsUnit;

  const sections: Section[] = [...(seesNeeds ? (["needs"] as const) : []), "requests", ...(seesArrivals ? (["arrivals"] as const) : [])];
  // Each person lands where their work starts: custodians and heads on the labs' needs,
  // the store and Property Administration on arrivals, everyone else on requests.
  const fallback: Section = seesNeeds ? "needs" : (canLoadStore || canRecordImports) && !canRunPipeline ? "arrivals" : "requests";
  const requested = params.get("tab") as Section | null;
  const section: Section = requested && sections.includes(requested) ? requested : sections.includes(fallback) ? fallback : "requests";
  const go = useCallback(
    (s: Section) => {
      const qp = new URLSearchParams(params.toString());
      qp.set("tab", s);
      router.replace(`${pathname}?${qp.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // The custodian's labs, needs and broken items; the head's open needs and broken items.
  const [labs, setLabs] = useState<LabSummaryDto[]>([]);
  const [myNeeds, setMyNeeds] = useState<NeedLineDto[] | null>(null);
  const [myReplacements, setMyReplacements] = useState<ReplacementSuggestionDto[]>([]);
  const [replacing, setReplacing] = useState<ReplacementSuggestionDto | null>(null);
  const [openNeeds, setOpenNeeds] = useState<NeedLineDto[] | null>(null);
  const [openNeedsError, setOpenNeedsError] = useState<string | null>(null);
  const [unitReplacements, setUnitReplacements] = useState<ReplacementSuggestionDto[]>([]);
  const [prefill, setPrefill] = useState<NeedLineDto[] | null>(null);

  useEffect(() => {
    api
      .get<ResourceCategoryDto[]>("/resources/categories")
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  const loadCustodian = useCallback(() => {
    if (!isCustodian || !user) return;
    api.get<LabSummaryDto[]>("/resources/labs").then((rows) => setLabs(rows.filter((l) => l.custodianId === user.id))).catch(() => setLabs([]));
    api.get<NeedLineDto[]>("/resources/needs").then(setMyNeeds).catch(() => setMyNeeds([]));
    api.get<ReplacementSuggestionDto[]>("/resources/needs/replacements").then(setMyReplacements).catch(() => setMyReplacements([]));
  }, [isCustodian, user]);

  const headNodeId = headsUnit?.nodeId ?? null;
  const loadHead = useCallback(() => {
    if (!headNodeId) return;
    setOpenNeedsError(null);
    api
      .get<NeedLineDto[]>(`/resources/needs?node=${encodeURIComponent(headNodeId)}`)
      .then(setOpenNeeds)
      .catch((e) => setOpenNeedsError(e instanceof ApiError ? e.message : "Could not load the labs' needs"));
    api.get<ReplacementSuggestionDto[]>(`/resources/needs/replacements?node=${encodeURIComponent(headNodeId)}`).then(setUnitReplacements).catch(() => setUnitReplacements([]));
  }, [headNodeId]);

  useEffect(loadCustodian, [loadCustodian]);
  useEffect(loadHead, [loadHead]);

  if (!user) return null;

  const tabs = sections.map((s) => ({
    key: s,
    label: s === "needs" ? "Lab needs" : s === "requests" ? "Requests" : "Arrivals",
    count: s === "needs" && headsUnit ? (openNeeds?.length ?? 0) : undefined,
  }));

  return (
    <Screen>
      <Tabs label="Purchasing sections" tabs={tabs} value={section} onChange={go} />

      {section === "needs" && (
        <>
          {headsUnit && (
            <LabNeedsReview
              needs={openNeeds}
              error={openNeedsError}
              onRetry={loadHead}
              onDeclined={loadHead}
              onBuild={(chosen) => {
                setPrefill(chosen);
                go("requests");
              }}
            />
          )}
          {isCustodian && (
            <>
              <AskForSomething categories={categories} labs={labs} replacing={replacing} onCancelReplacing={() => setReplacing(null)} onRaised={() => (loadCustodian(), loadHead())} />
              <ReplacementsPanel
                rows={myReplacements}
                onAsk={(r) => {
                  setReplacing(r);
                  document.getElementById("ask-for-something")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
              <MyNeeds needs={myNeeds} onChanged={loadCustodian} />
            </>
          )}
        </>
      )}

      {section === "requests" && (
        <>
          {built && (
            <div className="bg-goodbg border border-good text-good rounded-2 px-12 py-9 text-11.5" role="status">
              {built} was sent for approval. It appears under Your requests below, with where it is now.
            </div>
          )}
          {headsUnit && (
            <BuildRequest
              orgNodeId={headsUnit.nodeId!}
              unitName={headsUnit.name}
              categories={categories}
              openNeeds={openNeeds ?? []}
              replacements={unitReplacements}
              prefill={prefill}
              onClosePrefill={() => setPrefill(null)}
              onBuilt={(reference) => {
                setBuilt(reference);
                setRefreshKey((k) => k + 1);
                loadHead();
              }}
            />
          )}
          {headsUnit && (
            <RequestListPanel key={`mine-${refreshKey}`} title="Your requests" box="mine" viewerId={user.id} categories={categories} emptyLabel="You haven't sent a purchase request yet." canRunPipeline={canRunPipeline} />
          )}
          {canRunPipeline && (
            <RequestListPanel key={`pipeline-${refreshKey}`} title="On order — where each one is" box="pipeline" viewerId={user.id} categories={categories} emptyLabel="Nothing is on order right now." showAdvance canRunPipeline />
          )}
          <RequestListPanel
            key={`tracking-${refreshKey}`}
            title={headsUnit ? "Other requests involving your unit" : "Purchase requests you follow"}
            box="tracking"
            viewerId={user.id}
            categories={categories}
            emptyLabel="No purchase request involving your unit or office yet."
            readOnly
            excludeOwn={!!headsUnit}
          />
        </>
      )}

      {section === "arrivals" && <ImportsPanel key={`imports-${refreshKey}`} categories={categories} canRecord={canRecordImports} canLoad={canLoadStore} />}
    </Screen>
  );
}

/** useSearchParams needs a Suspense boundary. */
export default function PurchasingPage() {
  return (
    <Suspense>
      <PurchasingInner />
    </Suspense>
  );
}

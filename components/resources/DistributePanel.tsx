"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DistributeResultDto, DistributionDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { useHomeCounts } from "@/lib/home-counts";
import { Panel, Button, ErrorNote, Tag } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { toast } from "@/components/toast";

const inputCls = "h-24 px-6 rounded-2 border border-border2 bg-panel text-11";
const labelCls = "text-10.5 uppercase tracking-label text-faint";

type Send = { labId: string; itemIds: string[]; needIds?: string[]; renameAs?: string };

/**
 * Purchasing → Distribute (lib/server/resources/distribution.ts): the store keeper sends
 * stock from the stores they keep to the labs. What a purchase brought for a lab that
 * asked for it is already laid out, with the units to send; anything else is picked by
 * hand. Each send is a store handover: Property Administration approves it and the
 * lab's custodian accepts it into their care.
 */
export function DistributePanel() {
  const { refresh: refreshCounts } = useHomeCounts();
  const [data, setData] = useState<DistributionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<DistributeResultDto["results"] | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<DistributionDto>("/resources/distributions")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load what is in your stores"));
  }, []);
  useEffect(load, [load]);

  async function send(sends: Send[]) {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const r = await api.post<DistributeResultDto>("/resources/distributions", { sends });
      setResults(r.results);
      const ok = r.results.filter((x) => x.ok).length;
      if (ok) toast.success(`${ok} send${ok === 1 ? "" : "s"} started. Property Administration approves, then each lab's custodian accepts.`, { href: "/approvals?box=mine&kind=transfer", linkLabel: "Follow them" });
      load();
      refreshCounts();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  const labName = (id: string) => data?.labs.find((l) => l.id === id)?.name ?? data?.suggestions.find((g) => g.lab.id === id)?.lab.name ?? "a lab";

  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      {results && (
        <div className="flex flex-col gap-4">
          {results.map((r, i) => (
            <div key={i} className={`text-11 rounded-2 border px-10 py-6 ${r.ok ? "border-good bg-goodbg text-good" : "border-bad bg-badbg text-bad"}`}>
              {labName(r.labId)}: {r.ok ? r.summary : r.error}
            </div>
          ))}
        </div>
      )}
      {data === null ? (
        <Panel title="Bought for the labs">
          <PanelLoading rows={3} />
        </Panel>
      ) : data.stores.length === 0 ? (
        <Panel title="Distribute">
          <div className="px-14 py-12 text-11.5 text-dim">You don't keep a store yet. Property Administration (or a college's ADAA) makes you a store's keeper.</div>
        </Panel>
      ) : (
        <>
          <Suggestions data={data} busy={busy} onSend={send} />
          <ByHand data={data} busy={busy} onSend={send} />
        </>
      )}
    </>
  );
}

// ── What purchases brought for labs that asked ──────────────────────────────────

function Suggestions({ data, busy, onSend }: { data: DistributionDto; busy: boolean; onSend: (sends: Send[]) => void }) {
  // How many to send per need (defaults to what was asked, capped by what is free).
  const [counts, setCounts] = useState<Record<string, string>>({});
  const countFor = (needId: string, qty: number, available: number) => {
    const typed = counts[needId];
    return typed === undefined ? Math.min(qty, available) : Math.max(0, Math.min(available, Math.floor(Number(typed) || 0)));
  };

  function sendsFor(groups: DistributionDto["suggestions"]): Send[] {
    return groups
      .map((g) => {
        const lines = g.lines.filter((l) => !l.bulk && countFor(l.needId, l.qty, l.items.length) > 0);
        return { labId: g.lab.id, itemIds: lines.flatMap((l) => l.items.slice(0, countFor(l.needId, l.qty, l.items.length)).map((i) => i.id)), needIds: lines.map((l) => l.needId) };
      })
      .filter((s) => s.itemIds.length);
  }

  const all = sendsFor(data.suggestions);
  return (
    <Panel
      title={`Bought for the labs (${data.suggestions.length})`}
      actions={
        all.length > 1 ? (
          <Button variant="primary" disabled={busy} onClick={() => onSend(all)}>
            Send all ({all.length} labs)
          </Button>
        ) : undefined
      }
    >
      {data.suggestions.length === 0 ? (
        <div className="px-14 py-12 text-11.5 text-dim">Nothing a lab asked for is waiting in your stores. When a purchase arrives and is loaded, what each lab asked for appears here, ready to send.</div>
      ) : (
        <div className="p-12 flex flex-col gap-10">
          {data.suggestions.map((g) => {
            const sends = sendsFor([g]);
            return (
              <div key={g.lab.id} className="border border-border rounded-3 p-10 flex flex-col gap-6">
                <div className="flex flex-wrap items-center gap-8">
                  <a href={`/places/${g.lab.id}`} className="text-11.5 font-semibold text-text hover:text-accent">
                    {g.lab.name}
                  </a>
                  <span className="text-11 text-dim">
                    {g.lab.unitName} · run by {g.lab.custodianName}
                  </span>
                  <span className="flex-1" />
                  <Button variant="primary" disabled={busy || !sends.length} onClick={() => onSend(sends)}>
                    Send to {g.lab.name.length > 28 ? "this lab" : g.lab.name}
                  </Button>
                </div>
                {g.lines.map((l) => {
                  const n = countFor(l.needId, l.qty, l.items.length);
                  return (
                    <div key={l.needId} className="flex flex-wrap items-center gap-8 text-11">
                      <span className="w-[180px] truncate">{l.name}</span>
                      <span className="text-dim">
                        asked {l.qty}
                        {l.purchaseReference ? ` · ${l.purchaseReference}` : ""}
                      </span>
                      {l.bulk ? (
                        <Tag>a quantity: move it from Resources</Tag>
                      ) : l.items.length === 0 ? (
                        <Tag tone="warn">none free in your stores</Tag>
                      ) : (
                        <>
                          <label className="flex items-center gap-4">
                            send
                            <input
                              type="number"
                              min="0"
                              max={l.items.length}
                              value={counts[l.needId] ?? String(n)}
                              onChange={(e) => setCounts((c) => ({ ...c, [l.needId]: e.target.value }))}
                              className={`${inputCls} w-[60px]`}
                            />
                            of {l.items.length} free
                          </label>
                          <span className="text-faint truncate max-w-[260px]" title={l.items.slice(0, n).map((i) => i.name).join(", ")}>
                            {l.items
                              .slice(0, Math.min(n, 3))
                              .map((i) => i.name)
                              .join(", ")}
                            {n > 3 ? ` +${n - 3} more` : ""}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ── Anything else, by hand ──────────────────────────────────────────────────────

function ByHand({ data, busy, onSend }: { data: DistributionDto; busy: boolean; onSend: (sends: Send[]) => void }) {
  const [labQuery, setLabQuery] = useState("");
  const [labId, setLabId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [count, setCount] = useState("1");
  const [renameAs, setRenameAs] = useState("");
  const [list, setList] = useState<Array<{ categoryId: string; count: number }>>([]);

  const labs = useMemo(() => {
    const q = labQuery.trim().toLowerCase();
    return data.labs.filter((l) => !q || `${l.name} ${l.unitName} ${l.custodianName}`.toLowerCase().includes(q)).slice(0, 60);
  }, [data.labs, labQuery]);
  const kind = data.stock.find((s) => s.categoryId === categoryId);
  const listed = (id: string) => list.filter((x) => x.categoryId === id).reduce((n, x) => n + x.count, 0);
  const left = kind ? kind.items.length - listed(kind.categoryId) : 0;

  function add() {
    const n = Math.max(1, Math.min(left, Math.floor(Number(count) || 0)));
    if (!kind || n < 1) return;
    setList((l) => [...l, { categoryId: kind.categoryId, count: n }]);
    setCount("1");
  }

  function itemIds(): string[] {
    const used = new Map<string, number>();
    return list.flatMap((x) => {
      const from = used.get(x.categoryId) ?? 0;
      used.set(x.categoryId, from + x.count);
      return (data.stock.find((s) => s.categoryId === x.categoryId)?.items ?? []).slice(from, from + x.count).map((i) => i.id);
    });
  }

  return (
    <Panel title="Send by hand" actions={<span className="text-11 text-faint">Anything in your stores, to any lab</span>}>
      <div className="p-12 flex flex-col gap-10">
        <div className="flex flex-wrap items-end gap-8">
          <label className="flex flex-col gap-3">
            <span className={labelCls}>To which lab</span>
            <input value={labQuery} onChange={(e) => setLabQuery(e.target.value)} placeholder="Find a lab, unit or custodian…" className={`${inputCls} w-[220px]`} />
          </label>
          <select value={labId} onChange={(e) => setLabId(e.target.value)} className={`${inputCls} min-w-[260px]`} aria-label="Lab">
            <option value="">Choose a lab…</option>
            {labs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.unitName} · {l.custodianName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-8">
          <label className="flex flex-col gap-3">
            <span className={labelCls}>What</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputCls} min-w-[220px]`}>
              <option value="">{data.stock.length ? "Choose from your stores…" : "Nothing free in your stores"}</option>
              {data.stock.map((s) => (
                <option key={s.categoryId} value={s.categoryId}>
                  {s.categoryName} ({s.items.length - listed(s.categoryId)} free)
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-3">
            <span className={labelCls}>How many</span>
            <input type="number" min="1" max={left} value={count} onChange={(e) => setCount(e.target.value)} className={`${inputCls} w-[70px]`} />
          </label>
          <Button disabled={!kind || left < 1} onClick={add}>
            Add
          </Button>
        </div>
        {list.length > 0 && (
          <div className="flex flex-col gap-4 text-11">
            {list.map((x, i) => (
              <div key={i} className="flex items-center gap-8">
                <span>
                  {x.count} × {data.stock.find((s) => s.categoryId === x.categoryId)?.categoryName}
                </span>
                <button type="button" className="text-faint" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
            <label className="flex flex-col gap-3 max-w-[300px]">
              <span className={labelCls}>Name them there as (optional)</span>
              <input value={renameAs} onChange={(e) => setRenameAs(e.target.value)} placeholder="e.g. Workstation" className={inputCls} />
            </label>
          </div>
        )}
        <div>
          <Button
            variant="primary"
            disabled={busy || !labId || !list.length}
            onClick={() => {
              onSend([{ labId, itemIds: itemIds(), ...(renameAs.trim() ? { renameAs: renameAs.trim() } : {}) }]);
              setList([]);
              setRenameAs("");
            }}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
          <span className="ml-10 text-11 text-faint">Property Administration approves it; the lab's custodian accepts it into their care.</span>
        </div>
      </div>
    </Panel>
  );
}

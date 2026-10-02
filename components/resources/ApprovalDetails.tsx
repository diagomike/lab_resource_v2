"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { NeedLineDto, PurchaseDetailsDto, PurchaseRequestDto, TransferDetailsDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Tag } from "@/components/ui";

/**
 * What an approver reads before deciding — the things themselves, not the one-line
 * summary. Open from the start for the person whose decision it is; one click away for
 * everyone else following the request.
 */
function Disclosure({ label, defaultOpen, children }: { label: string; defaultOpen: boolean; children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="self-start border-0 bg-transparent p-0 text-11 font-semibold text-accent flex items-center gap-4 cursor-pointer hover:underline"
      >
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        {label}
      </button>
      {open && children(open)}
    </div>
  );
}

function useDetails<T>(url: string, enabled: boolean): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || data) return;
    let live = true;
    api.get<T>(url).then(
      (d) => live && setData(d),
      (e) => live && setError(e instanceof ApiError ? e.message : "Couldn't load the details."),
    );
    return () => {
      live = false;
    };
  }, [url, enabled, data]);
  return { data, error };
}

const path = (names: string[]) => names.join(" › ");

// ── Transfers ────────────────────────────────────────────────────────────────

export function TransferDetails({ requestId, defaultOpen }: { requestId: string; defaultOpen: boolean }) {
  return (
    <Disclosure label="What is moving, from where, to whom" defaultOpen={defaultOpen}>
      {(open) => <TransferDetailsBody requestId={requestId} open={open} />}
    </Disclosure>
  );
}

function TransferDetailsBody({ requestId, open }: { requestId: string; open: boolean }) {
  const { data, error } = useDetails<TransferDetailsDto>(`/resources/transfers/${requestId}/details`, open);
  if (error) return <div className="text-11 text-bad">{error}</div>;
  if (!data) return <div className="text-11 text-faint">Loading the details…</div>;

  const live = data.items.filter((i) => !i.removed);
  const froms = [...new Set(live.map((i) => path(i.from)))];
  const owners = [...new Set(live.map((i) => i.ownerUnitName))];
  const custodians = [...new Set(live.map((i) => i.custodianName))];

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 sm:grid-cols-2">
        <Side title="From">
          <Fact label="Place">{froms.length === 1 ? froms[0] || "–" : `${froms.length} places (see each below)`}</Fact>
          <Fact label="Owned by">{owners.join(", ") || "–"}</Fact>
          <Fact label="Answered for by">{custodians.join(", ") || "–"}</Fact>
        </Side>
        <Side title="To">
          <Fact label="Place">{path(data.to.place)}</Fact>
          <Fact label="Unit">{data.to.unitName}</Fact>
          <Fact label="Ownership">{data.to.ownershipMoves ? `Moves to ${data.to.unitName} for good` : `Stays with ${owners.join(", ") || "its owner"}`}</Fact>
          <Fact label="Will answer for it">{data.to.custodianName ?? `No change: ${custodians.join(", ") || "the same custodian"}`}</Fact>
        </Side>
      </div>

      <div className="text-11 text-dim">
        {data.movementTitle} · {data.items.length} resource{data.items.length === 1 ? "" : "s"}
        {live.some((i) => i.partsTotal) ? `, with ${live.reduce((n, i) => n + i.partsTotal, 0)} parts inside` : ""}
      </div>

      <ul className="flex flex-col border border-border rounded-2 divide-y divide-border">
        {data.items.map((i) => (
          <li key={i.id} className="px-10 py-8 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-6">
              <span className="text-11.5 font-medium">{i.name}</span>
              {i.categoryName && <span className="text-11 text-dim">{i.categoryName}</span>}
              {i.qty !== null && (
                <span className="text-11 font-mono text-dim">
                  × {i.qty}
                  {i.unit ? ` ${i.unit}` : ""}
                </span>
              )}
              {i.status && <Tag tone={i.status === "Working" ? "good" : i.status === "Maintenance" ? "cross" : "bad"}>{i.status}</Tag>}
              {i.changedSinceAsked && <Tag tone="warn">Changed since it was asked for</Tag>}
              {i.removed && <Tag tone="bad">No longer in the register</Tag>}
            </div>
            {!i.removed && (
              <>
                <div className="text-11 text-dim">
                  Now in {path(i.from) || "–"} · held by {i.holderUnitName}
                  {i.holderUnitName !== i.ownerUnitName ? ` (owned by ${i.ownerUnitName})` : ""} · {i.custodianName}
                </div>
                {i.details.length > 0 && (
                  <dl className="text-11 flex flex-wrap gap-x-12 gap-y-2">
                    {i.details.map((d) => (
                      <div key={d.label} className="flex gap-4">
                        <dt className="text-faint">{d.label}:</dt>
                        <dd className="text-text">{d.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {i.partsTotal > 0 && (
                  <div className="text-11 text-dim">
                    Travels with {i.partsTotal} part{i.partsTotal === 1 ? "" : "s"}: {i.parts.map((p) => `${p.name} ×${p.count}`).join(", ")}
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Side({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-border rounded-2 px-10 py-8 flex flex-col gap-3 bg-panel2">
      <div className="text-10.5 uppercase tracking-label font-semibold text-faint">{title}</div>
      {children}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="text-11 flex gap-6">
      <span className="text-faint flex-none w-[110px]">{label}</span>
      <span className="text-text min-w-0">{children}</span>
    </div>
  );
}

// ── Purchases ────────────────────────────────────────────────────────────────

const PRIORITY_TEXT: Record<NeedLineDto["priority"], string> = { ESSENTIAL: "Essential", IMPORTANT: "Important", NICE_TO_HAVE: "Nice to have" };
const PRIORITY_TONE: Record<NeedLineDto["priority"], "bad" | "warn" | "neutral"> = { ESSENTIAL: "bad", IMPORTANT: "warn", NICE_TO_HAVE: "neutral" };

const money = (n: number) => `ETB ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Every line with its cost worked out, the request's total, and — open for the
 *  approver — the lab needs behind each line. */
export function PurchaseLines({ request, defaultOpen }: { request: PurchaseRequestDto; defaultOpen: boolean }) {
  const lineTotal = (l: PurchaseRequestDto["lines"][number]) => (l.estimatedUnitCost !== null ? l.estimatedUnitCost * l.qty : null);
  const priced = request.lines.filter((l) => l.estimatedUnitCost !== null);
  const total = priced.reduce((n, l) => n + lineTotal(l)!, 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="border border-border rounded-2 overflow-x-auto">
        <table className="w-full text-11 border-collapse">
          <thead>
            <tr className="bg-panel2 text-faint text-left">
              <th className="font-semibold px-10 py-6">What</th>
              <th className="font-semibold px-10 py-6 text-right whitespace-nowrap">How many</th>
              <th className="font-semibold px-10 py-6 text-right whitespace-nowrap">Est. unit cost</th>
              <th className="font-semibold px-10 py-6 text-right whitespace-nowrap">Line total</th>
            </tr>
          </thead>
          <tbody>
            {request.lines.map((l) => (
              <tr key={l.id} className="border-t border-border align-top">
                <td className="px-10 py-6">
                  <div className="text-11.5 font-medium">{l.name}</div>
                  {l.justification && <div className="text-11 text-dim whitespace-pre-wrap mt-2">{l.justification}</div>}
                </td>
                <td className="px-10 py-6 text-right font-mono whitespace-nowrap">
                  {l.qty}
                  {l.unit ? ` ${l.unit}` : ""}
                </td>
                <td className="px-10 py-6 text-right font-mono whitespace-nowrap">{l.estimatedUnitCost !== null ? money(l.estimatedUnitCost) : "–"}</td>
                <td className="px-10 py-6 text-right font-mono whitespace-nowrap">{lineTotal(l) !== null ? money(lineTotal(l)!) : "–"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border2 bg-panel2">
              <td className="px-10 py-6 font-semibold" colSpan={3}>
                Estimated total
                {priced.length < request.lines.length ? <span className="font-normal text-dim"> ({request.lines.length - priced.length} line{request.lines.length - priced.length === 1 ? "" : "s"} without a cost)</span> : null}
              </td>
              <td className="px-10 py-6 text-right font-mono font-semibold whitespace-nowrap">{priced.length ? money(total) : "–"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Disclosure label="Why each line is asked for: the lab needs behind it" defaultOpen={defaultOpen}>
        {(open) => <PurchaseNeeds request={request} open={open} />}
      </Disclosure>
    </div>
  );
}

function PurchaseNeeds({ request, open }: { request: PurchaseRequestDto; open: boolean }) {
  const { data, error } = useDetails<PurchaseDetailsDto>(`/resources/purchase-requests/${request.id}/details`, open);
  if (error) return <div className="text-11 text-bad">{error}</div>;
  if (!data) return <div className="text-11 text-faint">Loading the details…</div>;
  const byLine = new Map(data.lines.map((l) => [l.lineId, l]));

  return (
    <ul className="flex flex-col gap-8">
      {request.lines.map((l) => {
        const d = byLine.get(l.id);
        return (
          <li key={l.id} className="border border-border rounded-2 px-10 py-8 flex flex-col gap-4">
            <div className="text-11.5">
              <span className="font-medium">{l.name}</span>
              {d?.categoryName && <span className="text-dim"> · {d.categoryName}</span>}
            </div>
            {!d || d.needs.length === 0 ? (
              <div className="text-11 text-faint">Added by the department directly. No lab need behind it. Its reason is the line's own justification.</div>
            ) : (
              <ul className="flex flex-col gap-6">
                {d.needs.map((n) => (
                  <li key={n.id} className="text-11 flex flex-col gap-2 pl-8 border-l-2 border-border2">
                    <div className="flex flex-wrap items-center gap-6">
                      <span className="font-medium">{n.labName ?? n.orgNodeName}</span>
                      <span className="font-mono text-dim">
                        × {n.qty}
                        {n.unit ? ` ${n.unit}` : ""}
                      </span>
                      <Tag tone={PRIORITY_TONE[n.priority]}>{PRIORITY_TEXT[n.priority]}</Tag>
                      {n.kind === "REPLACEMENT" && <Tag tone="bad">Replacement</Tag>}
                    </div>
                    <div className="text-dim">“{n.reason}”</div>
                    {n.spec && <div className="text-dim">Specification: {n.spec}</div>}
                    {n.kind === "REPLACEMENT" && n.replacesItems.length > 0 && <div className="text-dim">Replaces: {n.replacesItems.map((r) => r.name).join(", ")}</div>}
                    <div className="text-faint">
                      Raised by {n.raisedByName} · {new Date(n.createdAt).toLocaleDateString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

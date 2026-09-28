"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PublicTrackingDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import PortalChrome, { RequireRequester } from "@/components/portal/PortalChrome";
import { Panel, ErrorNote, Button, Tag, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { EXTERNAL_STATUS_LABEL, KIND_LABEL, externalStatusTone, formatEtb } from "@/components/external/labels";
import PaymentPanel from "@/components/portal/PaymentPanel";

/**
 * A signed-in requester's own request: where it stands, the quote (each department's part
 * and the university's bank account), their payments, what is held (then booked) for them
 * and when, and — once the AVP's office has confirmed the payment — who to contact in each
 * department. Everything after that is arranged with those people directly.
 */
function RequestView({ id }: { id: string }) {
  const [data, setData] = useState<PublicTrackingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<PublicTrackingDto>(`/portal/requests/${encodeURIComponent(id)}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "This request isn't one of yours." : "Could not load your request."));
  }, [id]);
  useEffect(load, [load]);

  async function cancel() {
    setBusy(true);
    try {
      setData(await api.post<PublicTrackingDto>(`/portal/requests/${encodeURIComponent(id)}/cancel`));
      setConfirmCancel(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalChrome>
      <div>
        <Link href="/portal/requests" className="text-11 text-accent">
          ← My requests
        </Link>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!data && !error && (
        <Panel>
          <PanelLoading rows={4} />
        </Panel>
      )}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-10">
            <h1 className="text-19 font-semibold font-mono">{data.reference}</h1>
            <Tag tone="neutral">{KIND_LABEL[data.kind]}</Tag>
            <Tag tone={externalStatusTone(data.status)}>{EXTERNAL_STATUS_LABEL[data.status]}</Tag>
          </div>
          <div className="text-12 text-dim">
            {data.organizationName} · {data.contactName}
          </div>

          {data.contacts.length > 0 && (
            <Panel title="Who to contact">
              <div className="px-14 py-12 flex flex-col gap-10 text-12">
                <div className="text-dim">Your payment is confirmed. Arrange arrival{data.kind === "SAMPLE_ANALYSIS" ? ", delivering your samples and receiving the results" : " and anything on the day"} with:</div>
                {data.contacts.map((c) => (
                  <div key={c.departmentName} className="flex flex-col gap-3">
                    <div className="font-medium">{c.departmentName}</div>
                    {c.people.map((p, i) => (
                      <div key={i} className="text-11.5">
                        {p.name}
                        {p.role ? <span className="text-dim"> · {p.role}</span> : null} · <a href={`tel:${p.phone}`} className="text-accent">{p.phone}</a>
                        {p.email ? (
                          <>
                            {" "}
                            · <a href={`mailto:${p.email}`} className="text-accent">{p.email}</a>
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {data.bookings.length > 0 && (
            <Panel title={data.bookings.every((b) => b.confirmed) ? "Booked for you" : "Held for you"}>
              <div className="px-14 py-10 flex flex-col gap-6">
                {data.bookings.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-8 text-11.5">
                    <span className="font-mono">
                      {b.date} · {b.start}–{b.end}
                    </span>
                    <span>{b.place}</span>
                    <Tag tone={b.confirmed ? "good" : "accent"}>{b.confirmed ? "Booked" : "Held until you pay"}</Tag>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {data.quote && (
            <Panel title="Quote">
              <div className="px-14 py-12 flex flex-col gap-8 text-12">
                <div className="text-21 font-semibold font-mono">{formatEtb(data.quote.amountSantim)}</div>
                {data.quote.paymentDeadline && <div>Payable by {new Date(data.quote.paymentDeadline).toLocaleDateString()} — what is held for you stays held until then.</div>}
                {data.quote.bank ? (
                  <div>
                    Pay into <strong>{data.quote.bank.bankName}</strong>, account <span className="font-mono">{data.quote.bank.accountNumber}</span> ({data.quote.bank.accountName}). Use{" "}
                    <span className="font-mono">{data.reference}</span> as the payment reason.
                  </div>
                ) : (
                  <div className="text-dim">The payment account will be confirmed to you by the university.</div>
                )}
                {data.quote.breakdown.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <span className="text-dim">Cost breakdown:</span>
                    {data.quote.breakdown.map((b) => (
                      <div key={b.departmentName} className="text-11.5">
                        {b.departmentName}: <span className="font-mono">{formatEtb(b.amountSantim)}</span>
                        {b.sheetUrl && (
                          <>
                            {" "}
                            ·{" "}
                            <a href={b.sheetUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                              details
                            </a>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {data.quote.note && <div className="text-dim italic">{data.quote.note}</div>}
              </div>
            </Panel>
          )}

          {data.quote && data.payment && <PaymentPanel data={data} onUpdated={setData} />}
          {data.status === "PAID" && <div className="text-11.5 text-dim">Paid in full — the Academic Vice President&apos;s office is confirming your payment. Your bookings and contacts appear here once it has.</div>}

          {data.closingNote && <ErrorNote>{data.closingNote}</ErrorNote>}

          <Panel title="Progress">
            <div className="px-14 py-10 flex flex-col gap-6">
              {data.timeline.map((t, i) => (
                <div key={i} className="text-11.5">
                  <span className="font-mono text-dim">{new Date(t.at).toLocaleString()}</span> · {t.label}
                  {t.note ? <span className="text-dim"> — {t.note}</span> : null}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="What you asked for">
            <div className="px-14 py-10 flex flex-col gap-6 text-11.5">
              <div className="text-dim">{data.purpose}</div>
              {data.sample && (
                <div>
                  <span className="font-mono">{data.sample.sampleCount} samples</span> · {data.sample.analysis}
                  {data.sample.categoryName ? <span className="text-faint"> ({data.sample.categoryName})</span> : null}
                </div>
              )}
              {data.windows.map((w, i) => (
                <div key={i} className="font-mono">
                  {w.date} · {w.start}–{w.end}
                </div>
              ))}
              {data.lines.map((l, i) => (
                <div key={i}>
                  <span className="font-mono">{l.quantity} ×</span> {l.description}
                  {l.categoryName ? <span className="text-faint"> ({l.categoryName})</span> : null}
                </div>
              ))}
            </div>
          </Panel>

          {data.canCancel && (
            <div>
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                Cancel this request
              </Button>
            </div>
          )}
          {confirmCancel && (
            <ConfirmDialog title="Cancel this request" message="Anything held for you is released. This cannot be undone — you would need to send a new request." confirmLabel="Cancel request" busy={busy} onConfirm={cancel} onCancel={() => setConfirmCancel(false)} />
          )}
        </>
      )}
    </PortalChrome>
  );
}

export default function PortalRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireRequester>
      <RequestView id={id} />
    </RequireRequester>
  );
}

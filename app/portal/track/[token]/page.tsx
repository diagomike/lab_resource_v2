"use client";

import { use, useCallback, useEffect, useState } from "react";
import type { PublicTrackingDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import PortalChrome from "@/components/portal/PortalChrome";
import { Panel, ErrorNote, Button, Tag, ConfirmDialog } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { EXTERNAL_STATUS_LABEL, externalStatusTone, formatEtb } from "@/components/external/labels";
import PaymentPanel from "@/components/portal/PaymentPanel";

/** Public — the requester's own request, reached by the token in their emailed link. */
export default function PortalTrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<PublicTrackingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<PublicTrackingDto>(`/public/track/${encodeURIComponent(token)}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "This link is not valid, or has been replaced by a newer one we emailed you." : "Could not load your request."));
  }, [token]);
  useEffect(load, [load]);

  async function cancel() {
    setBusy(true);
    try {
      setData(await api.post<PublicTrackingDto>(`/public/track/${encodeURIComponent(token)}/cancel`));
      setConfirmCancel(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not cancel.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PortalChrome>
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
            <Tag tone={externalStatusTone(data.status)}>{EXTERNAL_STATUS_LABEL[data.status]}</Tag>
          </div>
          <div className="text-12 text-dim">
            {data.organizationName} · {data.contactName}
          </div>

          {data.quote && (
            <Panel title="Quote">
              <div className="px-14 py-12 flex flex-col gap-8 text-12">
                <div className="text-21 font-semibold font-mono">{formatEtb(data.quote.amountSantim)}</div>
                {data.quote.paymentDeadline && <div>Payable by {new Date(data.quote.paymentDeadline).toLocaleDateString()} — the requested slots are held until then.</div>}
                {data.quote.bank ? (
                  <div>
                    Pay into <strong>{data.quote.bank.bankName}</strong>, account <span className="font-mono">{data.quote.bank.accountNumber}</span> ({data.quote.bank.accountName}).
                  </div>
                ) : (
                  <div className="text-dim">The payment account will be confirmed to you by the university.</div>
                )}
                {data.quote.sheetUrls.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-dim">Pricing breakdown:</span>
                    {data.quote.sheetUrls.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="text-accent underline break-all">
                        {u}
                      </a>
                    ))}
                  </div>
                )}
                {data.quote.note && <div className="text-dim italic">{data.quote.note}</div>}
              </div>
            </Panel>
          )}

          {data.quote && data.payment && <PaymentPanel token={token} data={data} onUpdated={setData} />}

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
            <ConfirmDialog title="Cancel this request" message="Any slots held for you are released. This cannot be undone — you would need to send a new request." confirmLabel="Cancel request" busy={busy} onConfirm={cancel} onCancel={() => setConfirmCancel(false)} />
          )}
        </>
      )}
    </PortalChrome>
  );
}

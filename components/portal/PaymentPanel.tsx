"use client";

import { useState } from "react";
import type { PaymentProvider, PaymentVerificationStatus, PublicTrackingDto, SubmitPaymentResultDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Panel, ErrorNote, Button, Tag } from "@/components/ui";
import { formatEtb, parseEtb } from "@/components/external/labels";

/**
 * Track 8 — the requester confirms their payment on the tracking page. They pick how they
 * paid and give the receipt's reference; the university's verifier reads the bank's
 * receipt. If it can't (or the bank isn't reachable), they may ask a person to check it
 * instead, stating the amount. Several payments may add up to the quote.
 */

const inputClass = "h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent";
const labelClass = "text-9.5 uppercase tracking-label text-faint font-semibold";

export const PAYMENT_STATUS_LABEL: Record<PaymentVerificationStatus, string> = {
  VERIFIED: "Verified",
  REJECTED: "Not verified",
  PENDING_REVIEW: "Being checked",
  MANUAL_VERIFIED: "Verified by hand",
  MANUAL_REJECTED: "Not accepted",
};

export function paymentTone(status: PaymentVerificationStatus): "good" | "bad" | "accent" {
  return status === "VERIFIED" || status === "MANUAL_VERIFIED" ? "good" : status === "PENDING_REVIEW" ? "accent" : "bad";
}

export default function PaymentPanel({ token, data, onUpdated }: { token: string; data: PublicTrackingDto; onUpdated: (next: PublicTrackingDto) => void }) {
  const payment = data.payment!;
  const quote = data.quote!;
  const [provider, setProvider] = useState<PaymentProvider | "">(payment.providers[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [suffix, setSuffix] = useState("");
  const [phone, setPhone] = useState("");
  const [manual, setManual] = useState(false);
  const [amount, setAmount] = useState(((quote.amountSantim - payment.paidSantim) / 100).toFixed(2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SubmitPaymentResultDto | null>(null);

  const option = payment.providers.find((p) => p.id === provider);
  const remaining = Math.max(0, quote.amountSantim - payment.paidSantim);
  const santim = parseEtb(amount);
  const suffixDigits = option?.extra?.kind === "SUFFIX" ? option.extra.digits : 8;
  const extraOk = !option?.extra || (option.extra.kind === "SUFFIX" ? suffix.length === option.extra.digits : /^2519\d{8}$/.test(phone));
  const ready = Boolean(option) && reference.trim().length >= 4 && extraOk && (!manual || santim !== null);

  async function submit() {
    if (!option) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await api.post<SubmitPaymentResultDto>(`/public/track/${encodeURIComponent(token)}/payments`, {
        provider: option.id,
        reference: reference.trim(),
        accountSuffix: option.extra?.kind === "SUFFIX" ? suffix : undefined,
        phoneNumber: option.extra?.kind === "PHONE" ? phone : undefined,
        manualReview: manual || undefined,
        amountSantim: manual ? santim : undefined,
        note: manual && note.trim() ? note.trim() : undefined,
      });
      setOutcome(result);
      onUpdated(result.tracking);
      if (result.outcome !== "REJECTED") {
        setReference("");
        setSuffix("");
        setPhone("");
        setManual(false);
        setNote("");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not submit this payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Payment">
      <div className="px-14 py-12 flex flex-col gap-10 text-11.5">
        <div className="flex flex-wrap items-baseline gap-8">
          <span className="font-mono font-semibold">{formatEtb(payment.paidSantim)}</span>
          <span className="text-dim">of {formatEtb(quote.amountSantim)} confirmed</span>
          {payment.pendingCount > 0 && <Tag tone="accent">{payment.pendingCount} being checked</Tag>}
        </div>

        {payment.attempts.length > 0 && (
          <div className="flex flex-col gap-4">
            {payment.attempts.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-8 text-10.5">
                <span className="font-mono">{a.reference}</span>
                <span className="text-dim">{payment.providers.find((p) => p.id === a.provider)?.label ?? a.provider}</span>
                {a.amountSantim !== null && <span className="font-mono">{formatEtb(a.amountSantim)}</span>}
                <Tag tone={paymentTone(a.status)}>{PAYMENT_STATUS_LABEL[a.status]}</Tag>
                {a.reason && <span className="text-dim">— {a.reason}</span>}
              </div>
            ))}
          </div>
        )}

        {payment.canSubmit && payment.providers.length === 0 && <div className="text-dim">Online payment confirmation is not available yet — please send your receipt to the university's office.</div>}

        {payment.canSubmit && payment.providers.length > 0 && (
          <div className="flex flex-col gap-8 border-t border-border pt-10">
            <div className="text-dim">
              {remaining < quote.amountSantim ? `Paid the remaining ${formatEtb(remaining)}?` : "Paid?"} Enter the reference from your bank receipt and we check it with the bank directly.
            </div>
            <div className="flex flex-wrap gap-10">
              <label className="flex flex-col gap-4">
                <span className={labelClass}>Paid through</span>
                <select value={provider} onChange={(e) => setProvider(e.target.value as PaymentProvider)} className={inputClass}>
                  {payment.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {option && (
                <label className="flex flex-col gap-4 flex-1 min-w-[200px]">
                  <span className={labelClass}>{option.referenceLabel}</span>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} className={`${inputClass} font-mono`} autoComplete="off" />
                </label>
              )}
              {option?.extra?.kind === "SUFFIX" && (
                <label className="flex flex-col gap-4">
                  <span className={labelClass}>{option.extra.label}</span>
                  <input value={suffix} onChange={(e) => setSuffix(e.target.value.replace(/\D/g, "").slice(0, suffixDigits))} inputMode="numeric" className={`${inputClass} font-mono`} />
                </label>
              )}
              {option?.extra?.kind === "PHONE" && (
                <label className="flex flex-col gap-4">
                  <span className={labelClass}>{option.extra.label}</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 12))} inputMode="numeric" placeholder="2519…" className={`${inputClass} font-mono`} />
                </label>
              )}
            </div>

            {manual && (
              <div className="flex flex-wrap gap-10">
                <label className="flex flex-col gap-4">
                  <span className={labelClass}>Amount you paid (ETB)</span>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputClass} font-mono`} />
                </label>
                <label className="flex flex-col gap-4 flex-1 min-w-[200px]">
                  <span className={labelClass}>Note for the office (optional)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid at the Adama branch" className={inputClass} />
                </label>
              </div>
            )}

            {outcome?.outcome === "REJECTED" && (
              <div className="flex flex-col gap-4 border border-border2 rounded-2 px-8 py-6">
                <span className="text-bad">{outcome.reason}</span>
                {!manual && (
                  <span className="text-dim">
                    {outcome.unavailable ? "The bank could not be reached just now. Try again later, or " : "If you are sure the details are right, "}
                    <button onClick={() => setManual(true)} className="text-accent underline">
                      ask the university's office to check it by hand
                    </button>
                    .
                  </span>
                )}
              </div>
            )}
            {outcome?.outcome === "VERIFIED" && <div className="text-good">Payment confirmed{outcome.tracking.status === "SCHEDULED" ? " — your booking is confirmed." : "."}</div>}
            {outcome?.outcome === "PENDING_REVIEW" && <div className="text-dim">Sent to the university's office. You will be emailed once they have checked it.</div>}
            {error && <ErrorNote>{error}</ErrorNote>}

            <div className="flex items-center gap-8">
              <Button variant="primary" onClick={submit} disabled={!ready || busy}>
                {busy ? "Checking with the bank…" : manual ? "Send for manual check" : "Verify payment"}
              </Button>
              {manual && <Button onClick={() => setManual(false)}>Back to automatic check</Button>}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

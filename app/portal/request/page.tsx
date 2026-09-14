"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { PublicCatalogDto, SubmitExternalRequestResultDto } from "@/lib/shared";
import { addDays, instantToCivil } from "@/lib/domain/civil-time";
import { ApiError } from "@/lib/api";
import PortalChrome from "@/components/portal/PortalChrome";
import { Panel, ErrorNote, Button } from "@/components/ui";

const inputClass = "h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent w-full";
const labelClass = "text-9.5 uppercase tracking-label text-faint font-semibold";
const MAX_LETTER_BYTES = 4 * 1024 * 1024;

type WindowDraft = { date: string; start: string; end: string };
type LineDraft = { description: string; quantity: string; categoryId: string };

/**
 * Public — an outside institution's request: who they are, what the event is, when,
 * what they need (free text, optionally pointing at a catalog category), and their
 * official letter as a PDF. Times are the venue's local time; the server converts.
 */
export default function PortalRequestPage() {
  const firstDate = addDays(instantToCivil(new Date()).date, 14);
  const [catalog, setCatalog] = useState<PublicCatalogDto | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [purpose, setPurpose] = useState("");
  const [windows, setWindows] = useState<WindowDraft[]>([{ date: firstDate, start: "09:00", end: "17:00" }]);
  const [lines, setLines] = useState<LineDraft[]>([{ description: "", quantity: "1", categoryId: "" }]);
  const [letter, setLetter] = useState<File | null>(null);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitExternalRequestResultDto | null>(null);

  useEffect(() => {
    fetch("/api/public/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  const categories = catalog?.groups.flatMap((g) => g.categories) ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!letter) return setError("Attach your official letter as a PDF.");
    if (letter.size > MAX_LETTER_BYTES) return setError("The letter must be at most 4 MB.");
    setBusy(true);
    try {
      const payload = {
        organizationName,
        contactName,
        contactEmail,
        contactPhone,
        purpose,
        website: website || undefined,
        windows,
        lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, categoryId: l.categoryId || undefined })),
      };
      const form = new FormData();
      form.set("payload", JSON.stringify(payload));
      form.set("letter", letter);
      const res = await fetch("/api/public/requests", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, body.message ?? "Your request could not be sent.");
      setDone(body as SubmitExternalRequestResultDto);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Your request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <PortalChrome>
        <Panel title="Request received">
          <div className="px-14 py-14 flex flex-col gap-10 text-12">
            <div>
              Your reference is <span className="font-mono font-semibold">{done.reference}</span>. We have emailed a confirmation to {contactEmail}.
            </div>
            <div className="text-dim">The link below is how you follow your request, receive the quote and confirm payment. Keep it — it is also in the email.</div>
            <div>
              <Link href={`/portal/track/${done.trackingToken}`} className="text-accent underline">
                Track {done.reference}
              </Link>
            </div>
          </div>
        </Panel>
      </PortalChrome>
    );
  }

  return (
    <PortalChrome>
      <h1 className="text-19 font-semibold">Request resources</h1>
      <form onSubmit={submit} className="flex flex-col gap-14">
        <Panel title="Who is asking">
          <div className="px-14 py-12 grid grid-cols-1 md:grid-cols-2 gap-10">
            <label className="flex flex-col gap-4 md:col-span-2">
              <span className={labelClass}>Institution or company</span>
              <input required value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-4">
              <span className={labelClass}>Contact person</span>
              <input required value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-4">
              <span className={labelClass}>Phone</span>
              <input required value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-4 md:col-span-2">
              <span className={labelClass}>Email — your quote and updates go here</span>
              <input required type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputClass} />
            </label>
            {/* Honeypot: hidden from people, tempting to bots. */}
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
          </div>
        </Panel>

        <Panel title="The event">
          <div className="px-14 py-12 flex flex-col gap-10">
            <label className="flex flex-col gap-4">
              <span className={labelClass}>What is it for</span>
              <textarea required rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. A 3-day data science training for 50 government employees" className="px-8 py-6 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent" />
            </label>
            <div className={labelClass}>When (Addis Ababa time)</div>
            {windows.map((w, i) => (
              <div key={i} className="flex flex-wrap items-end gap-8">
                <input type="date" required min={addDays(instantToCivil(new Date()).date, 2)} value={w.date} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} className={`${inputClass} w-auto`} />
                <input type="time" required value={w.start} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className={`${inputClass} w-auto`} />
                <span className="text-dim text-11 pb-6">to</span>
                <input type="time" required value={w.end} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className={`${inputClass} w-auto`} />
                {windows.length > 1 && (
                  <button type="button" onClick={() => setWindows(windows.filter((_, j) => j !== i))} className="text-10.5 text-bad pb-6">
                    Remove
                  </button>
                )}
              </div>
            ))}
            {windows.length < 10 && (
              <div>
                <Button onClick={() => setWindows([...windows, { ...windows[windows.length - 1], date: addDays(windows[windows.length - 1].date, 1) }])}>+ Another day</Button>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="What you need">
          <div className="px-14 py-12 flex flex-col gap-8">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_90px_190px_60px] gap-6 items-center">
                <input required value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} placeholder="e.g. Workstations with internet, in 3 lab rooms" className={inputClass} />
                <input required type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className={inputClass} />
                <select value={l.categoryId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))} className={inputClass}>
                  <option value="">Kind (optional)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {lines.length > 1 ? (
                  <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-10.5 text-bad">
                    Remove
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            {lines.length < 30 && (
              <div>
                <Button onClick={() => setLines([...lines, { description: "", quantity: "1", categoryId: "" }])}>+ Another item</Button>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Official letter">
          <div className="px-14 py-12 flex flex-col gap-6">
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setLetter(e.target.files?.[0] ?? null)} className="text-11" />
            <span className="text-10.5 text-faint">A signed letter from your institution, as a PDF of at most 4 MB.</span>
          </div>
        </Panel>

        {error && <ErrorNote>{error}</ErrorNote>}
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    </PortalChrome>
  );
}

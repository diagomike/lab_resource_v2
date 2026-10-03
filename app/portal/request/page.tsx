"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import type { PublicCatalogDto, PublicTrackingDto, SubmitExternalRequestResultDto } from "@/lib/shared";
import { maxPeople, recommend, setupLine } from "@/lib/domain/external-offers";
import { addDays, instantToCivil } from "@/lib/domain/civil-time";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { loadPublicCatalog } from "@/lib/portal-catalog";
import PortalChrome, { RequireRequester } from "@/components/portal/PortalChrome";
import { Panel, ErrorNote, Button } from "@/components/ui";

const inputClass = "h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent w-full";
const labelClass = "text-10.5 uppercase tracking-label text-faint font-semibold";
const MAX_LETTER_BYTES = 4 * 1024 * 1024;

type Kind = "FACILITY" | "SAMPLE_ANALYSIS";
type WindowDraft = { date: string; start: string; end: string };
type LineDraft = { description: string; quantity: string; categoryId: string };
type SetupDraft = { placeCategoryId: string; count: string; needs: Array<{ categoryId: string; qty: string }> };

const blankSetup = (): SetupDraft => ({ placeCategoryId: "", count: "1", needs: [{ categoryId: "", qty: "1" }] });

/**
 * A signed-in requester's new request: rooms or labs for an event (FACILITY), or samples
 * analysed on a machine for a report (SAMPLE_ANALYSIS) — who is asking (from the account,
 * editable), what for, when, what they need, and their official letter as a PDF. Times are
 * the venue's local time; the server converts.
 */
function RequestForm() {
  const { user } = useAuth();
  const firstDate = addDays(instantToCivil(new Date()).date, 14);
  const [catalog, setCatalog] = useState<PublicCatalogDto | null>(null);
  const [kind, setKind] = useState<Kind>("FACILITY");
  const [organizationName, setOrganizationName] = useState(user?.organisation ?? "");
  const [contactName, setContactName] = useState(user?.name ?? "");
  const [contactEmail, setContactEmail] = useState(user?.email ?? "");
  const [contactPhone, setContactPhone] = useState(user?.phone ?? "");
  const [purpose, setPurpose] = useState("");
  const [windows, setWindows] = useState<WindowDraft[]>([{ date: firstDate, start: "09:00", end: "17:00" }]);
  const [lines, setLines] = useState<LineDraft[]>([{ description: "", quantity: "1", categoryId: "" }]);
  const [setups, setSetups] = useState<SetupDraft[]>([]);
  // A packaged offer: what they are holding and for how many people; it fills the labs below.
  const [offerKey, setOfferKey] = useState("");
  const [people, setPeople] = useState("");
  // Editing a closed request (declined, expired, cancelled) to send it again.
  const [earlier, setEarlier] = useState<PublicTrackingDto | null>(null);
  const [machineCategoryId, setMachineCategoryId] = useState("");
  const [sampleCount, setSampleCount] = useState("1");
  const [analysis, setAnalysis] = useState("");
  const [letter, setLetter] = useState<File | null>(null);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitExternalRequestResultDto | null>(null);

  useEffect(() => {
    loadPublicCatalog()
      .then(setCatalog)
      .catch(() => setCatalog(null));
  }, []);

  // "Edit and send again": the closed request's details fill the form.
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("from");
    if (!from) return;
    api
      .get<PublicTrackingDto>(`/portal/requests/${from}`)
      .then((r) => {
        if (!r.canSendAgain) return;
        setEarlier(r);
        setKind(r.kind);
        setOrganizationName(r.organizationName);
        setContactName(r.contactName);
        setContactEmail(r.contactEmail);
        setContactPhone(r.contactPhone);
        setPurpose(r.purpose);
        setWindows(r.windows.map((w) => ({ date: w.date, start: w.start, end: w.end })));
        setLines(r.lines.length ? r.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), categoryId: "" })) : [{ description: "", quantity: "1", categoryId: "" }]);
        setSetups(r.setups.map((s) => ({ placeCategoryId: s.placeCategoryId, count: String(s.count), needs: s.needs.map((n) => ({ categoryId: n.categoryId, qty: String(n.qty) })) })));
        if (r.offer) {
          setOfferKey(r.offer.key);
          setPeople(r.offer.people ? String(r.offer.people) : "");
        }
        if (r.sample) {
          setSampleCount(String(r.sample.sampleCount));
          setAnalysis(r.sample.analysis);
        }
      })
      .catch(() => setError("The request you wanted to send again could not be opened. You can still fill in a new one."));
  }, []);

  const offers = catalog?.offers ?? [];
  const offer = offers.find((o) => o.key === offerKey) ?? null;
  const headcount = Number(people);
  const recommended = offer && people ? recommend(offer, headcount) : null;
  /** Choosing an offer or changing the headcount fills the labs below with what it recommends. */
  function applyOffer(key: string, count: string) {
    setOfferKey(key);
    setPeople(count);
    const chosen = offers.find((o) => o.key === key);
    const r = chosen && count ? recommend(chosen, Number(count)) : null;
    if (r) setSetups([{ placeCategoryId: r.placeCategoryId, count: String(r.count), needs: r.needs.map((n) => ({ categoryId: n.categoryId, qty: String(n.qty) })) }]);
  }

  const categories = catalog?.groups.flatMap((g) => g.categories) ?? [];
  const machines = categories.filter((c) => c.bookingMode === "EQUIPMENT");
  const placeKinds = categories.filter((c) => c.isPlace && c.bookingMode === "ROOM");
  const setupKinds = catalog?.setupKinds ?? [];
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? setupKinds.find((c) => c.id === id)?.name ?? "";
  const cleanSetups = setups
    .filter((s) => s.placeCategoryId)
    .map((s) => ({ placeCategoryId: s.placeCategoryId, count: Number(s.count) || 1, needs: s.needs.filter((n) => n.categoryId).map((n) => ({ categoryId: n.categoryId, qty: Number(n.qty) || 1 })) }));
  // "2 labs, 50 workstations, 2 projectors per session": what the setups add up to.
  const totals = (() => {
    const places = new Map<string, number>();
    const things = new Map<string, number>();
    for (const s of cleanSetups) {
      places.set(s.placeCategoryId, (places.get(s.placeCategoryId) ?? 0) + s.count);
      for (const n of s.needs) things.set(n.categoryId, (things.get(n.categoryId) ?? 0) + n.qty * s.count);
    }
    return [...places, ...things].map(([id, n]) => `${n} × ${nameOf(id)}`).join(", ");
  })();
  const updateSetup = (i: number, patch: Partial<SetupDraft>) => setSetups(setups.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!letter && !earlier) return setError("Attach your official letter as a PDF.");
    if (letter && letter.size > MAX_LETTER_BYTES) return setError("The letter must be at most 4 MB.");
    setBusy(true);
    try {
      const payload = {
        kind,
        organizationName,
        contactName,
        contactEmail,
        contactPhone,
        purpose,
        website: website || undefined,
        windows,
        setups: kind === "FACILITY" && cleanSetups.length ? cleanSetups : undefined,
        offerKey: kind === "FACILITY" && cleanSetups.length && offer ? offer.key : undefined,
        peopleCount: kind === "FACILITY" && cleanSetups.length && offer && Number.isInteger(headcount) && headcount > 0 ? headcount : undefined,
        resubmitOf: earlier?.id,
        lines:
          kind === "FACILITY" && !cleanSetups.length
            ? lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, categoryId: l.categoryId || undefined }))
            : lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, categoryId: l.categoryId || undefined })),
        sample: kind === "SAMPLE_ANALYSIS" ? { categoryId: machineCategoryId || undefined, sampleCount: Number(sampleCount) || 0, analysis } : undefined,
      };
      const form = new FormData();
      form.set("payload", JSON.stringify(payload));
      if (letter) form.set("letter", letter);
      const res = await fetch("/api/portal/requests", { method: "POST", body: form, credentials: "include" });
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
              Your reference is <span className="font-mono font-semibold">{done.reference}</span>. We have emailed you a confirmation.
            </div>
            <div className="text-dim">The Academic Vice President&apos;s office reviews it with the colleges and departments concerned; the quote appears on your request&apos;s page.</div>
            <div>
              <Link href={`/portal/requests/${done.id}`} className="text-accent underline">
                Follow {done.reference}
              </Link>
            </div>
          </div>
        </Panel>
      </PortalChrome>
    );
  }

  return (
    <PortalChrome>
      <h1 className="text-19 font-semibold">{earlier ? `Edit ${earlier.reference} and send it again` : "New request"}</h1>
      {earlier && (
        <div className="rounded-2 border border-border2 bg-panel px-14 py-10 text-11.5 flex flex-col gap-4">
          <div>
            <span className="font-mono font-semibold">{earlier.reference}</span> was closed{earlier.closingNote ? <>: <span className="text-bad">“{earlier.closingNote}”</span></> : "."}
          </div>
          <div className="text-dim">Everything you sent is filled in below. Change what is needed and send it: it goes to the university as a new request, linked to this one.</div>
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-14">
        <Panel title="What kind of request">
          <div className="px-14 py-12 flex flex-col gap-6">
            {(
              [
                ["FACILITY", "Rooms or labs", "For a workshop, training or exam. You come and use the university's labs and equipment."],
                ["SAMPLE_ANALYSIS", "Sample analysis", "You send samples; the university runs them on one of its machines and gives you the results."],
              ] as const
            ).map(([value, title, help]) => (
              <label key={value} className="flex items-start gap-8 text-11.5 cursor-pointer">
                <input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)} className="mt-3" />
                <span>
                  <span className="font-medium">{title}</span>
                  <span className="block text-11 text-faint">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </Panel>

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
              <span className={labelClass}>Email</span>
              <input required type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputClass} />
            </label>
            {/* Honeypot: hidden from people, tempting to bots. */}
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
          </div>
        </Panel>

        <Panel title={kind === "FACILITY" ? "The event" : "The analysis"}>
          <div className="px-14 py-12 flex flex-col gap-10">
            <label className="flex flex-col gap-4">
              <span className={labelClass}>What is it for</span>
              <textarea
                required
                rows={3}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder={kind === "FACILITY" ? "e.g. A 3-day data science training for 50 government employees" : "e.g. Mineral composition of soil samples for a road survey"}
                className="px-8 py-6 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
              />
            </label>
            {kind === "SAMPLE_ANALYSIS" && (
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px] gap-10">
                <label className="flex flex-col gap-4">
                  <span className={labelClass}>Machine</span>
                  <select value={machineCategoryId} onChange={(e) => setMachineCategoryId(e.target.value)} className={inputClass}>
                    <option value="">Not sure: the university will choose</option>
                    {machines.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-4">
                  <span className={labelClass}>Samples</span>
                  <input required type="number" min={1} value={sampleCount} onChange={(e) => setSampleCount(e.target.value)} className={inputClass} />
                </label>
                <label className="flex flex-col gap-4 md:col-span-2">
                  <span className={labelClass}>Analysis needed</span>
                  <input required value={analysis} onChange={(e) => setAnalysis(e.target.value)} placeholder="e.g. X-ray diffraction, phase identification" className={inputClass} />
                </label>
              </div>
            )}
            <div className={labelClass}>{kind === "FACILITY" ? "When (Addis Ababa time)" : "Preferred dates (Addis Ababa time)"}</div>
            {windows.map((w, i) => (
              <div key={i} className="flex flex-wrap items-end gap-8">
                <input type="date" required min={addDays(instantToCivil(new Date()).date, 2)} value={w.date} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} className={`${inputClass} w-auto`} />
                <input type="time" required value={w.start} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className={`${inputClass} w-auto`} />
                <span className="text-dim text-11 pb-6">to</span>
                <input type="time" required value={w.end} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className={`${inputClass} w-auto`} />
                {windows.length > 1 && (
                  <button type="button" onClick={() => setWindows(windows.filter((_, j) => j !== i))} className="text-11 text-bad pb-6">
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

        {kind === "FACILITY" && offers.length > 0 && (
          <Panel title="What are you holding?">
            <div className="px-14 py-12 flex flex-col gap-8">
              <div className="text-11 text-dim">Choose what it is and say for how many people: the labs you need are worked out for you. You can still change them below.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {offers.map((o) => (
                  <label key={o.key} className={`flex items-start gap-8 rounded-2 border px-10 py-8 text-11.5 cursor-pointer ${offerKey === o.key ? "border-accent bg-soft" : "border-border2"}`}>
                    <input type="radio" name="offer" checked={offerKey === o.key} onChange={() => applyOffer(o.key, people)} className="mt-3" />
                    <span>
                      <span className="font-medium">{o.name}</span>
                      <span className="block text-11 text-faint">{o.summary}</span>
                    </span>
                  </label>
                ))}
                <label className={`flex items-start gap-8 rounded-2 border px-10 py-8 text-11.5 cursor-pointer ${offerKey === "" ? "border-accent bg-soft" : "border-border2"}`}>
                  <input type="radio" name="offer" checked={offerKey === ""} onChange={() => setOfferKey("")} className="mt-3" />
                  <span>
                    <span className="font-medium">Something else</span>
                    <span className="block text-11 text-faint">Describe the labs you need yourself, below.</span>
                  </span>
                </label>
              </div>
              {offer && (
                <div className="flex flex-wrap items-center gap-8 text-11.5">
                  <label className="flex items-center gap-6">
                    <span className={labelClass}>For how many people</span>
                    <input type="number" min={1} max={maxPeople(offer)} value={people} onChange={(e) => applyOffer(offer.key, e.target.value)} className={`${inputClass} !w-[110px]`} aria-label="For how many people" />
                  </label>
                  {recommended ? (
                    <span>
                      <span className={labelClass}>We recommend</span> <strong className="font-medium">{setupLine(recommended)}</strong>
                    </span>
                  ) : people ? (
                    <span className="text-bad">Give a whole number of people, at most {maxPeople(offer)}. For more, send a second request.</span>
                  ) : (
                    <span className="text-faint">A {offer.placeCategoryName.toLowerCase()} here seats about {offer.seatsPerPlace}.</span>
                  )}
                </div>
              )}
            </div>
          </Panel>
        )}

        {kind === "FACILITY" && (
          <Panel title="The labs you need">
            <div className="px-14 py-12 flex flex-col gap-10">
              <div className="text-11 text-dim">
                Describe each kind of lab you need and what every one of them must have, for example 2 computer labs with 25 workstations and a projector each. The departments hold labs until your setup is covered.
              </div>
              {setups.map((s, i) => (
                <div key={i} className="rounded-2 border border-border2 px-10 py-8 flex flex-col gap-6">
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_90px_60px] gap-6 items-center">
                    <select value={s.placeCategoryId} onChange={(e) => updateSetup(i, { placeCategoryId: e.target.value })} className={inputClass} aria-label="Kind of place">
                      <option value="">Kind of place…</option>
                      {placeKinds.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input type="number" min={1} max={20} value={s.count} onChange={(e) => updateSetup(i, { count: e.target.value })} className={inputClass} aria-label="How many" title="How many" />
                    <button type="button" onClick={() => setSetups(setups.filter((_, j) => j !== i))} className="text-11 text-bad">
                      Remove
                    </button>
                  </div>
                  <div className={labelClass}>Each one must have</div>
                  {s.needs.map((n, k) => (
                    <div key={k} className="grid grid-cols-[90px_minmax(0,1fr)_60px] gap-6 items-center">
                      <input
                        type="number"
                        min={1}
                        value={n.qty}
                        onChange={(e) => updateSetup(i, { needs: s.needs.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)) })}
                        className={inputClass}
                        aria-label="How many in each"
                      />
                      <select value={n.categoryId} onChange={(e) => updateSetup(i, { needs: s.needs.map((x, j) => (j === k ? { ...x, categoryId: e.target.value } : x)) })} className={inputClass} aria-label="What it must have">
                        <option value="">Choose…</option>
                        {setupKinds.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => updateSetup(i, { needs: s.needs.filter((_, j) => j !== k) })} className="text-11 text-bad">
                        Remove
                      </button>
                    </div>
                  ))}
                  {s.needs.length < 20 && (
                    <div>
                      <button type="button" className="text-11 text-accent" onClick={() => updateSetup(i, { needs: [...s.needs, { categoryId: "", qty: "1" }] })}>
                        + Something else it must have
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {totals && (
                <div className="text-11">
                  <span className={labelClass}>Per session</span> {totals}
                </div>
              )}
              {setups.length < 10 && (
                <div>
                  <Button onClick={() => setSetups([...setups, blankSetup()])}>+ Add a lab setup</Button>
                </div>
              )}
            </div>
          </Panel>
        )}

        <Panel title={kind === "FACILITY" && !cleanSetups.length ? "What you need" : "Anything else you need (optional)"}>
          <div className="px-14 py-12 flex flex-col gap-8">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_90px_190px_60px] gap-6 items-center">
                <input
                  required={kind === "FACILITY" && !cleanSetups.length}
                  value={l.description}
                  onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  placeholder={kind === "FACILITY" ? "e.g. Workstations with internet, in 3 lab rooms" : "e.g. A written report in English"}
                  className={inputClass}
                />
                <input type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className={inputClass} />
                <select value={l.categoryId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))} className={inputClass}>
                  <option value="">Kind (optional)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {lines.length > 1 ? (
                  <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-11 text-bad">
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
            <span className="text-11 text-faint">A signed letter from your institution, as a PDF of at most 4 MB.</span>
            {earlier && <span className="text-11 text-dim">The letter you sent with {earlier.reference} ({earlier.letterFileName}) is attached again, unless you choose a new one here.</span>}
          </div>
        </Panel>

        {error && <ErrorNote>{error}</ErrorNote>}
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Sending…" : earlier ? "Send it again" : "Send request"}
          </Button>
        </div>
      </form>
    </PortalChrome>
  );
}

export default function PortalRequestPage() {
  return (
    <RequireRequester>
      <RequestForm />
    </RequireRequester>
  );
}

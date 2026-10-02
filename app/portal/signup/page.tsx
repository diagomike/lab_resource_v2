"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import PortalChrome from "@/components/portal/PortalChrome";
import { Panel, ErrorNote, Button } from "@/components/ui";

const inputClass = "h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent w-full";
const labelClass = "text-10.5 uppercase tracking-label text-faint font-semibold";

/** Public — an outside institution creates its requester account, then confirms its email. */
export default function PortalSignupPage() {
  const [form, setForm] = useState({ organisation: "", name: "", email: "", phone: "", password: "" });
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/public/signup", { ...form, website: website || undefined });
      setSentTo(form.email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <PortalChrome>
        <Panel title="Check your email">
          <div className="px-14 py-14 text-12 flex flex-col gap-8">
            <div>
              We sent a link to <strong>{sentTo}</strong>. Follow it to confirm your address, then sign in to send your request.
            </div>
            <div className="text-dim">No email after a few minutes? Check your spam folder, or sign up again to get a fresh link.</div>
          </div>
        </Panel>
      </PortalChrome>
    );
  }

  return (
    <PortalChrome>
      <h1 className="text-19 font-semibold">Create a requester account</h1>
      <p className="text-12 text-dim max-w-[620px]">
        One account for your institution or company: you send requests, see the quote, confirm your payment, and follow what has been booked for you. Already have one?{" "}
        <Link href="/login" className="text-accent underline">
          Sign in
        </Link>
        .
      </p>
      <form onSubmit={submit}>
        <Panel>
          <div className="px-14 py-12 grid grid-cols-1 md:grid-cols-2 gap-10">
            <label className="flex flex-col gap-4 md:col-span-2">
              <span className={labelClass}>Institution or company</span>
              <input required value={form.organisation} onChange={set("organisation")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-4">
              <span className={labelClass}>Your name</span>
              <input required value={form.name} onChange={set("name")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-4">
              <span className={labelClass}>Phone</span>
              <input required value={form.phone} onChange={set("phone")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-4">
              <span className={labelClass}>Email</span>
              <input required type="email" autoComplete="username" value={form.email} onChange={set("email")} className={inputClass} />
            </label>
            <label className="flex flex-col gap-4">
              <span className={labelClass}>Password (at least 8 characters)</span>
              <input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={set("password")} className={inputClass} />
            </label>
            {/* Honeypot: hidden from people, tempting to bots. */}
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
          </div>
        </Panel>
        {error && (
          <div className="mt-10">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
        <div className="mt-10">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>
    </PortalChrome>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, ApiError } from "@/lib/auth-context";
import { landingPathFor } from "@/lib/nav";
import { safeNext } from "@/lib/paths";
import AuthChrome from "@/components/AuthChrome";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const ctx = await login(email, password);
      // Back to where they were going (an emailed link), else their landing page. An
      // outside requester only ever goes back into the portal.
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));
      const landing = landingPathFor(ctx.user.roles);
      router.replace(next && (landing !== "/portal/requests" || next.startsWith("/portal")) ? next : landing);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthChrome
      subtitle="Sign in"
      footer="Staff access is by invitation: if your department registered you, the link in your email sets your password. An outside institution asking for resources or an analysis creates its own account on the portal (/portal/signup)."
    >
      <form onSubmit={onSubmit} className="px-14 py-12">
        <label className="block">
          <span className="text-10.5 uppercase tracking-caps text-faint font-semibold">Email</span>
          <input
            type="email"
            required
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-border2 bg-panel h-25 px-8 rounded-3 text-11.5 mt-3 outline-none focus:border-accent"
          />
        </label>

        <label className="block mt-10">
          <span className="text-10.5 uppercase tracking-caps text-faint font-semibold">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-border2 bg-panel h-25 px-8 rounded-3 text-11.5 mt-3 outline-none focus:border-accent"
          />
          <Link href="/forgot-password" className="block text-right text-11 text-dim mt-4">
            Forgot password?
          </Link>
        </label>

        {error && (
          <div className="flex gap-8 mt-10">
            <div className="w-3 bg-bad rounded-2 flex-none" />
            <div className="text-11 text-bad leading-loose">{error}</div>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{ opacity: busy ? 0.45 : 1 }}
          className="w-full border border-accent bg-accent text-white h-30 rounded-3 text-12 font-medium mt-14"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthChrome>
  );
}

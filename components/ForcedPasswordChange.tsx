"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import AuthChrome from "@/components/AuthChrome";

/**
 * The only screen an account with an administrator-issued temporary password can reach
 * (ProtectedRoute renders it in place of the workspace; session.ts refuses every other
 * API call). The temporary password goes in "current"; once changed, the flag clears
 * and the workspace appears — this session stays signed in, every other one ends.
 */
export default function ForcedPasswordChange() {
  const { user, refresh, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("The two new passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change your password");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full border border-border2 bg-panel h-25 px-8 rounded-3 text-11.5 mt-3 outline-none focus:border-accent";
  const label = "text-9.5 uppercase tracking-caps text-faint font-semibold";

  return (
    <AuthChrome subtitle="Choose a new password">
      <form onSubmit={onSubmit} className="px-14 py-12 flex flex-col gap-10">
        <p className="text-11 text-dim leading-loose">
          An administrator set a temporary password on <span className="font-mono text-text">{user?.email}</span>. Choose your own
          password to continue.
        </p>
        <label className="block">
          <span className={label}>Temporary password</span>
          <input type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} required className={field} />
        </label>
        <label className="block">
          <span className={label}>New password</span>
          <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required className={field} />
        </label>
        <label className="block">
          <span className={label}>Repeat new password</span>
          <input type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={field} />
        </label>
        {error && (
          <div className="flex gap-8">
            <div className="w-3 bg-bad rounded-2 flex-none" />
            <div className="text-11 text-bad leading-loose">{error}</div>
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{ opacity: busy ? 0.45 : 1 }}
          className="w-full border border-accent bg-accent text-white h-30 rounded-3 text-12 font-medium"
        >
          {busy ? "Saving…" : "Set password and continue"}
        </button>
        <button type="button" onClick={() => void logout()} className="text-10.5 text-dim">
          Sign out instead
        </button>
      </form>
    </AuthChrome>
  );
}

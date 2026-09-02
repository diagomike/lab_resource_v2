import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import AuthChrome from "../components/AuthChrome";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Always resolves — it never reveals whether the email matched an account, same
      // reasoning login's single error message follows.
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the reset link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthChrome subtitle="Reset your password">
      {sent ? (
        <div className="px-14 py-12">
          <div className="flex gap-8">
            <div className="w-3 bg-good rounded-2 flex-none" />
            <div>
              <div className="text-12.5 font-semibold">Check your email</div>
              <div className="text-11 text-dim leading-loose mt-3">
                If an account exists for <span className="text-text font-mono">{email}</span>, a reset link is on its
                way. It expires in 2 hours.
              </div>
            </div>
          </div>
          <Link to="/login" className="inline-block mt-12 text-11 text-accent">
            ← Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="px-14 py-12">
          <label className="block">
            <span className="text-9.5 uppercase tracking-caps text-faint font-semibold">Email</span>
            <input
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-border2 bg-panel h-25 px-8 rounded-3 text-11.5 mt-3 outline-none focus:border-accent"
            />
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
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <Link to="/login" className="block text-center text-10.5 text-dim mt-10">
            ← Back to sign in
          </Link>
        </form>
      )}
    </AuthChrome>
  );
}

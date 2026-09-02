import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import AuthChrome from "../components/AuthChrome";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, newPassword });
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 1800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset your password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthChrome subtitle="Set a new password">
      {!token ? (
        <div className="px-14 py-12">
          <div className="flex gap-8">
            <div className="w-3 bg-warn rounded-2 flex-none" />
            <div className="text-11 text-dim leading-loose">
              This link is missing its reset token. Request a new one from the sign-in page.
            </div>
          </div>
        </div>
      ) : done ? (
        <div className="px-14 py-12">
          <div className="flex gap-8">
            <div className="w-3 bg-good rounded-2 flex-none" />
            <div>
              <div className="text-12.5 font-semibold">Password updated</div>
              <div className="text-11 text-dim leading-loose mt-3">Taking you to sign in…</div>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="px-14 py-12">
          <label className="block">
            <span className="text-9.5 uppercase tracking-caps text-faint font-semibold">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full border border-border2 bg-panel h-25 px-8 rounded-3 text-11.5 mt-3 outline-none focus:border-accent"
            />
          </label>
          <label className="block mt-10">
            <span className="text-9.5 uppercase tracking-caps text-faint font-semibold">Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
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
            {busy ? "Saving…" : "Set new password"}
          </button>
          <Link to="/login" className="block text-center text-10.5 text-dim mt-10">
            ← Back to sign in
          </Link>
        </form>
      )}
    </AuthChrome>
  );
}

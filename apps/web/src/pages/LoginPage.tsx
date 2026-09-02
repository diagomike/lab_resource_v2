import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, ApiError } from "../lib/auth-context";
import { landingPathFor } from "../lib/nav";
import AuthChrome from "../components/AuthChrome";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
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
      // Land people where their workspace actually starts rather than on a generic home:
      // an admin opens on personnel, a department head on their labs (once that exists).
      navigate(landingPathFor(ctx.workspace, ctx.user.roles), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthChrome
      subtitle="Sign in"
      footer="Access is by invitation. If your department registered you, the link in your email sets your password — use it rather than signing in here."
    >
      <form onSubmit={onSubmit} className="px-14 py-12">
        <label className="block">
          <span className="text-9.5 uppercase tracking-caps text-faint font-semibold">Email</span>
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
          <span className="text-9.5 uppercase tracking-caps text-faint font-semibold">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-border2 bg-panel h-25 px-8 rounded-3 text-11.5 mt-3 outline-none focus:border-accent"
          />
          <Link to="/forgot-password" className="block text-right text-10 text-dim mt-4">
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

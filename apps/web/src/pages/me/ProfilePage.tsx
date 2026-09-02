import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useMeContext } from "../../components/shell/AppShell";
import { Panel, Screen, Button, Tag, ErrorNote } from "../../components/ui";
import { FONT_FAMILIES, FONT_SIZES, useTheme, type FontFamily, type FontSize } from "../../lib/theme-context";

export default function ProfilePage() {
  const { user } = useAuth();
  const me = useMeContext();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      // Every other session is dropped server-side, so say so — otherwise being signed
      // out on another device looks like a fault rather than the intended protection.
      setMsg({ tone: "ok", text: "Password changed. Any other devices have been signed out." });
      setCurrent("");
      setNext("");
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Could not change password" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <DisplayPanel />

      <Panel title="Your account">
        <dl className="px-14 py-12 grid grid-cols-[130px_1fr] gap-y-9 gap-x-12 text-11.5">
          <dt className="text-dim">Name</dt>
          <dd className="font-medium">{user?.name}</dd>
          <dt className="text-dim">Email</dt>
          <dd className="font-mono text-11">{user?.email}</dd>
          <dt className="text-dim">Roles</dt>
          <dd className="flex flex-wrap gap-4">
            {(user?.roles ?? []).map((r) => (
              <Tag key={r} tone="accent">
                {r.toLowerCase()}
              </Tag>
            ))}
          </dd>
          <dt className="text-dim">Unit</dt>
          <dd>{me?.scope?.name ?? <span className="text-faint">— no unit scope</span>}</dd>
          <dt className="text-dim">Cost visibility</dt>
          <dd>
            {me?.canSeeCost ? (
              <Tag tone="good">can see purchase costs</Tag>
            ) : (
              <Tag tone="neutral">costs hidden</Tag>
            )}
          </dd>
        </dl>
      </Panel>

      <Panel title="Change password">
        <form onSubmit={changePassword} className="px-14 py-12 flex flex-col gap-11 max-w-[380px]">
          <label className="block">
            <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              className="mt-4 w-full bg-panel2 border border-border2 rounded-2 h-26 px-9 text-12 outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-10.5 uppercase tracking-wider text-dim font-semibold">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              className="mt-4 w-full bg-panel2 border border-border2 rounded-2 h-26 px-9 text-12 outline-none focus:border-accent"
            />
            <span className="text-9.5 text-faint">At least 8 characters.</span>
          </label>

          {msg &&
            (msg.tone === "bad" ? (
              <ErrorNote>{msg.text}</ErrorNote>
            ) : (
              <div className="bg-goodbg text-good border border-good rounded-2 px-12 py-9 text-11">
                {msg.text}
              </div>
            ))}

          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Change password"}
            </Button>
          </div>
        </form>
      </Panel>
    </Screen>
  );
}

/** Theme, text size, and typeface — grouped together because they're all "how this looks
 *  to me", not account data. Applies immediately and persists to this browser only. */
function DisplayPanel() {
  const { theme, toggle, fontSize, setFontSize, fontFamily, setFontFamily } = useTheme();

  return (
    <Panel title="Display">
      <div className="px-14 py-12 flex flex-col gap-11 max-w-[420px]">
        <div>
          <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-6">Theme</div>
          <button
            type="button"
            onClick={toggle}
            className="border border-border2 bg-panel h-28 px-9 rounded-3 text-12.5"
          >
            {theme === "dark" ? "◑ Dark" : "◐ Light"} — switch to {theme === "dark" ? "light" : "dark"}
          </button>
        </div>
        <div>
          <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-6">Text size</div>
          <SegmentedChoice options={FONT_SIZES} value={fontSize} onChange={setFontSize} />
        </div>
        <div>
          <div className="text-10.5 uppercase tracking-wider text-dim font-semibold mb-6">Typeface</div>
          <SegmentedChoice options={FONT_FAMILIES} value={fontFamily} onChange={setFontFamily} />
          <div className="text-10.5 text-faint mt-4">
            Numbers, tags and dates always stay in IBM Plex Mono, whatever you pick here — that's what keeps them
            easy to compare at a glance.
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SegmentedChoice<T extends FontSize | FontFamily>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-px bg-panel3 p-2 rounded-3 w-fit flex-wrap">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            type="button"
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{ background: on ? "var(--panel)" : "transparent", color: on ? "var(--text)" : "var(--dim)" }}
            className="border-0 text-11.5 px-9 py-2 rounded-2 font-medium whitespace-nowrap"
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

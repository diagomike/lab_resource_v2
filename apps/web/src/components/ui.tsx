import type { ReactNode } from "react";

/**
 * The shared vocabulary every list and detail screen is built from.
 *
 * The design is flush panels divided by 1px rules — no floating cards, no shadows — so
 * these are deliberately thin: a Panel is a bordered box with an optional header strip,
 * and a Table is a plain grid. Anything fancier belongs to the screen, not here.
 *
 * IBM Plex Mono is used for every quantity, identifier and status token; IBM Plex Sans
 * for anything read as language. That split is a readability decision, applied through
 * the `mono` prop rather than left to each call site to remember.
 */

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-panel border border-border rounded-3 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center gap-8 px-14 py-9 border-b border-border">
          {title && (
            <div className="text-11 uppercase tracking-widest text-dim font-semibold flex-1">{title}</div>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles: Record<string, string> = {
    default: "bg-panel2 border-border2 text-text",
    primary: "bg-accent border-accent text-white",
    danger: "bg-badbg border-bad text-bad",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`border h-24 px-10 rounded-2 text-11 font-medium whitespace-nowrap disabled:opacity-45 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

/** A status/attribute token. Always mono — it is a value, not prose. */
export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent" | "cross";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-panel3 text-dim border-border2",
    good: "bg-goodbg text-good border-good",
    warn: "bg-warnbg text-warn border-warn",
    bad: "bg-badbg text-bad border-bad",
    accent: "bg-soft text-accent border-accent",
    cross: "bg-crossbg text-cross border-cross",
  };
  return (
    <span
      className={`inline-block border rounded-2 px-6 py-1 text-9.5 font-mono whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export interface Column<T> {
  header: string;
  /** Renders the cell. Return a string for plain text or a node for anything richer. */
  cell: (row: T) => ReactNode;
  /** Right-align and use mono — for counts, costs, dates and identifiers. */
  mono?: boolean;
  width?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    // Wide tables scroll inside their own container — the page body must never scroll
    // sideways, or the sidebar and header drift out of alignment on a narrow screen.
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[640px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.header}
                style={{ width: c.width }}
                className={`text-9.5 uppercase tracking-label text-faint font-semibold px-12 py-7 ${
                  c.mono ? "text-right" : "text-left"
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-border ${onRowClick ? "cursor-pointer hover:bg-panel2" : ""}`}
            >
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={`px-12 py-7 text-11.5 align-top ${
                    c.mono ? "text-right font-mono text-11" : ""
                  }`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Screen-level padding, so every page starts at the same rhythm. */
export function Screen({ children }: { children: ReactNode }) {
  return <div className="p-14 flex flex-col gap-14">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="bg-badbg text-bad border border-bad rounded-2 px-12 py-9 text-11">{children}</div>
  );
}

/** An overlay dialog for an action that needs more room than a row of buttons — still
 *  flush and un-shadowed, matching the rest of the design; the backdrop is what separates
 *  it from the page, not elevation. Click the backdrop or the × to dismiss. */
export function Modal({
  title,
  onClose,
  children,
  width = "480px",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-14">
      <div className="absolute inset-0 bg-black opacity-50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-panel border border-border2 rounded-3 max-h-[85vh] overflow-y-auto w-full"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center gap-8 px-14 py-9 border-b border-border sticky top-0 bg-panel">
          <div className="text-11 uppercase tracking-widest text-dim font-semibold flex-1">{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-14 leading-none text-faint hover:text-text px-4">
            ×
          </button>
        </div>
        <div className="px-14 py-14 flex flex-col gap-14">{children}</div>
      </div>
    </div>
  );
}

/**
 * A confirmation dialog for an action with a real consequence — changing who occupies a
 * node, deactivating one, deleting one. These are deliberately NOT one-click: a stray
 * click on a picker or a button shouldn't silently revoke someone's access or destroy a
 * node. `tone` picks the confirm button's styling; the message should say plainly what
 * is about to happen, not just repeat the action's name.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "warn" | "primary";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const barColor = tone === "danger" ? "bg-bad" : tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <Modal title={title} onClose={onCancel} width="420px">
      <div className="flex gap-10">
        <div className={`w-3 rounded-2 flex-none ${barColor}`} />
        <div className="text-11.5 text-dim leading-loose">{message}</div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-8">
        <Button variant={tone === "primary" ? "primary" : "danger"} onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

/**
 * An honest placeholder for a screen a later phase will build. It names the phase rather
 * than showing a blank panel, so a reviewer walking the app can tell "not built yet"
 * apart from "built and broken".
 */
export function NotBuiltYet({ what, phase }: { what: string; phase: string }) {
  return (
    <Screen>
      <Panel title={what}>
        <div className="px-14 py-20 text-11.5 text-faint leading-normal">
          Not built yet — scheduled for <span className="font-mono text-dim">{phase}</span>.
          <div className="mt-6 text-10.5">
            The route, navigation entry and role gating are already live, so this screen is
            reachable by exactly the people who will use it.
          </div>
        </div>
      </Panel>
    </Screen>
  );
}

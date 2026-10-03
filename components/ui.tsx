"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** Says what the button will do, on hover. */
  title?: string;
  /** danger only for what destroys or can't be undone; warn for "are you sure". */
  variant?: "default" | "primary" | "warn" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles: Record<string, string> = {
    default: "bg-panel2 border-border2 text-text",
    primary: "bg-accent border-accent text-white",
    warn: "bg-warnbg border-warn text-warn",
    danger: "bg-badbg border-bad text-bad",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`border h-28 px-12 rounded-2 text-11.5 font-medium whitespace-nowrap disabled:opacity-45 ${styles[variant]}`}
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
      className={`inline-block border rounded-2 px-6 py-1 text-10.5 font-mono whitespace-nowrap ${tones[tone]}`}
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
                className={`text-10.5 uppercase tracking-label text-faint font-semibold px-12 py-7 ${
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

/** Horizontal tabs for the sections of one screen. A count shows what is waiting in a
 *  section (it reads "3 waiting" to a screen reader, not just "3"). */
/**
 * Live counts beside a sidebar entry or a tab: a solid accent chip for what waits for
 * this person's action, a quieter slate-blue chip for what they follow that is still
 * moving (it disappears once everything reaches its end).
 */
export function CountChips({ action = 0, following = 0, declined = 0 }: { action?: number; following?: number; declined?: number }) {
  if (!action && !following && !declined) return null;
  const words = [declined ? `${declined} declined or sent back` : "", action ? `${action} waiting for you` : "", following ? `${following} in progress` : ""].filter(Boolean).join(", ");
  return (
    <span className="flex items-center gap-3 flex-none" title={words}>
      {declined > 0 && (
        <span className="text-10.5 font-semibold font-mono px-5 rounded-full bg-bad text-white leading-relaxed" aria-hidden="true">
          {declined}
        </span>
      )}
      {action > 0 && (
        <span className="text-10.5 font-semibold font-mono px-5 rounded-full bg-accent text-white leading-relaxed" aria-hidden="true">
          {action}
        </span>
      )}
      {following > 0 && (
        <span className="text-10.5 font-semibold font-mono px-5 rounded-full bg-followbg text-follow leading-relaxed" aria-hidden="true">
          {following}
        </span>
      )}
      <span className="sr-only">{words}</span>
    </span>
  );
}

export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  /** `count`: waiting for this person; `following`: theirs, still in progress. */
  tabs: Array<{ key: K; label: string; count?: number; following?: number }>;
  value: K;
  onChange: (key: K) => void;
  /** What the tabs switch between, for assistive tech ("Purchasing sections"). */
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-2 border-b border-border overflow-x-auto">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`px-12 h-32 text-12 font-medium flex items-center gap-6 border-b-2 -mb-px whitespace-nowrap ${on ? "border-accent text-text" : "border-transparent text-dim hover:text-text"}`}
          >
            {t.label}
            <CountChips action={t.count} following={t.following} />
          </button>
        );
      })}
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

/** Open modals, innermost last — Escape closes only the top one (a Change dialog opened
 *  over an item's details closes alone, leaving the details open). */
const openModals: object[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * An overlay dialog for an action that needs more room than a row of buttons — still
 * flush and un-shadowed, matching the rest of the design; the backdrop is what separates
 * it from the page, not elevation.
 *
 * Keyboard: focus moves into the dialog when it opens (its first field), Tab stays inside
 * it, and focus goes back to whatever opened it on close. With `dirty` (something typed
 * and not saved), the backdrop, Escape and × ask before throwing it away — only the
 * dialog's own Cancel/Save buttons close it outright.
 */
export function Modal({
  title,
  onClose,
  children,
  width = "480px",
  dirty = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  /** Something typed here isn't saved yet: closing by accident asks first. */
  dirty?: boolean;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(asking);
  askingRef.current = asking;

  /** A close the person didn't press Cancel/Save for: ask first when work would be lost. */
  const requestClose = useCallback(() => {
    if (dirtyRef.current && !askingRef.current) setAsking(true);
    else closeRef.current();
  }, []);

  useEffect(() => {
    const me = {};
    openModals.push(me);
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    // The first field, or the first control, or the dialog itself.
    const first = dialog?.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])") ?? dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (openModals[openModals.length - 1] !== me) return;
      if (e.key === "Escape") {
        // A picker inside the modal that closed its own list on this Escape marks it handled.
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (askingRef.current) setAsking(false);
        else requestClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && (document.activeElement === head || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (document.activeElement === tail || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        head.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      openModals.splice(openModals.indexOf(me), 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [requestClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-14">
      <div className="absolute inset-0 bg-black opacity-50" onClick={requestClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative bg-panel border border-border2 rounded-3 max-h-[85vh] overflow-y-auto w-full outline-none"
        style={{ maxWidth: width }}
      >
        <div className="flex items-center gap-8 px-14 py-9 border-b border-border sticky top-0 bg-panel z-10">
          <div className="text-11 uppercase tracking-widest text-dim font-semibold flex-1">{title}</div>
          <button type="button" onClick={requestClose} aria-label="Close" className="text-14 leading-none text-faint hover:text-text px-4">
            ×
          </button>
        </div>
        {asking && (
          <div role="alertdialog" aria-label="Discard your changes?" className="flex flex-wrap items-center gap-8 px-14 py-9 border-b border-warn bg-warnbg sticky top-[37px] z-10">
            <span className="text-11.5 text-warn font-medium flex-1 min-w-[160px]">You have changes that aren&apos;t saved. Discard them?</span>
            <Button variant="danger" onClick={() => closeRef.current()}>
              Discard
            </Button>
            <Button onClick={() => setAsking(false)}>Keep editing</Button>
          </div>
        )}
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
  confirmDisabled,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "warn" | "primary";
  busy?: boolean;
  /** The confirm button waits on something in the message (a reason to type). */
  confirmDisabled?: boolean;
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
        <Button variant={tone} onClick={onConfirm} disabled={busy || confirmDisabled}>
          {busy ? "Working…" : confirmLabel}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

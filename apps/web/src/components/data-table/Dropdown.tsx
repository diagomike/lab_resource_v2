import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The anchored popover the faceted filter, the column picker and the advanced filter
 * builder all hang off. Deliberately not a widget library: click-outside, Escape, and an
 * absolutely-positioned panel in the existing flush-panel styling is the whole contract —
 * the same call EntityPicker and ComboBox already made.
 */
export function Dropdown({
  trigger,
  children,
  width = "220px",
  align = "left",
  panelClassName = "",
  open: controlledOpen,
  onOpenChange,
}: {
  /** Rendered inside the trigger button. */
  trigger: (state: { open: boolean }) => ReactNode;
  /** Given a `close` callback so an action inside the panel can dismiss it. */
  children: (close: () => void) => ReactNode;
  width?: string;
  align?: "left" | "right";
  panelClassName?: string;
  /** Omit for an uncontrolled dropdown; supply both to drive it from outside (the toolbar
   *  needs this for the Ctrl+Shift+F shortcut). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    if (controlledOpen === undefined) setUncontrolled(next);
  };
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left">
        {trigger({ open })}
      </button>
      {open && (
        <div
          style={{ width }}
          className={`absolute z-30 mt-2 bg-panel border border-border2 rounded-2 overflow-hidden ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** The small bordered control every filter surface uses as its resting state. */
export const CONTROL_CLASS =
  "w-full flex items-center justify-between gap-6 bg-panel border border-border2 rounded-2 h-20 px-6 text-10 text-dim hover:border-accent";

/** A styled native select — used for field and operator pickers. Native is the right call
 *  here: it is keyboard-accessible for free and matches the selects already in the forms. */
export function MiniSelect({
  value,
  onChange,
  options,
  title,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  title?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-panel border border-border2 rounded-2 h-20 px-4 text-10 text-dim outline-none focus:border-accent ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

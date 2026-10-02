"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, X } from "lucide-react";

/**
 * Toasts — the short "done" (or "couldn't") after an action, with a link to what it
 * made when there is one ("Request sent · View"). They sit bottom-right, are read out
 * politely by screen readers, and go by themselves (errors stay longer). Errors that
 * belong to a form stay in the form; a toast is for the outcome of something finished.
 */

type Tone = "good" | "bad";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
  href?: string;
  linkLabel?: string;
}
interface ToastOptions {
  /** Where the result can be seen ("View"). */
  href?: string;
  linkLabel?: string;
}
interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi>({ success: () => {}, error: () => {} });

/** The mounted provider's `push` — so a success handler can say "done" without a hook. */
let emit: ((tone: Tone, message: string, options?: ToastOptions) => void) | null = null;

/** Show a toast from anywhere in the client (`toast.success("Saved")`). */
export const toast: ToastApi = {
  success: (message, options) => emit?.("good", message, options),
  error: (message, options) => emit?.("bad", message, options),
};

/**
 * For a supporting list that failed to load (the categories behind a filter, the units
 * in a picker): the screen still works, so say what is missing rather than pretend the
 * list is empty. `.catch(couldNotLoad("the categories", () => setCategories([])))`.
 */
export function couldNotLoad(what: string, fallback?: () => void): (e: unknown) => void {
  return (e) => {
    fallback?.();
    const why = e instanceof Error && e.message ? ` (${e.message})` : "";
    toast.error(`Couldn't load ${what}${why}. Some choices may be missing — reload the page to try again.`);
  };
}

const LIFETIME: Record<Tone, number> = { good: 5000, bad: 9000 };

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => closeRef.current(), LIFETIME[toast.tone]);
    return () => window.clearTimeout(t);
  }, [paused, toast.tone]);
  const Icon = toast.tone === "good" ? CircleCheck : CircleAlert;
  return (
    <div
      role={toast.tone === "bad" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={`pointer-events-auto flex items-start gap-8 bg-panel border rounded-4 px-12 py-9 w-full ${toast.tone === "good" ? "border-good" : "border-bad"}`}
    >
      <Icon size={15} aria-hidden="true" className={`flex-none mt-1 ${toast.tone === "good" ? "text-good" : "text-bad"}`} />
      <div className="flex-1 min-w-0 text-12 text-text leading-normal">
        {toast.message}
        {toast.href && (
          <>
            {" "}
            <Link href={toast.href} onClick={onClose} className="font-medium whitespace-nowrap">
              {toast.linkLabel ?? "View"}
            </Link>
          </>
        )}
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="border-0 bg-transparent text-faint hover:text-text p-0 flex-none cursor-pointer">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((tone: Tone, message: string, options?: ToastOptions) => {
    const id = next.current++;
    // At most three at once: the newest matter most.
    setToasts((list) => [...list.slice(-2), { id, tone, message, ...options }]);
  }, []);
  const api = useMemo<ToastApi>(() => ({ success: (m, o) => push("good", m, o), error: (m, o) => push("bad", m, o) }), [push]);
  useEffect(() => {
    emit = push;
    return () => {
      if (emit === push) emit = null;
    };
  }, [push]);
  const close = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="fixed bottom-32 right-12 left-12 sm:left-auto sm:w-[360px] z-[60] flex flex-col gap-6 pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => close(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

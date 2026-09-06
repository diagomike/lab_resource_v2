"use client";

import { useSyncExternalStore } from "react";

/**
 * The person's currently chosen access view (Track 1 of
 * ~/.claude/plans/lets-merge-the-work-memoized-journal.md) — per-browser UI state,
 * not session data: it lives here rather than in `auth-context.tsx` because the
 * server always re-validates it (a client-supplied view id is never trusted blindly
 * — see `views.ts`'s `resolveEffectiveView`), so losing it costs nothing more than
 * falling back to the person's own default view.
 *
 * A plain module-level store rather than a Context, so `Sidebar.tsx`'s picker,
 * `useRegisterState`, and `useItemChange.ts`'s plain (non-hook) submit functions can
 * all reach the same value without a wrapper every one of them would need to sit
 * under. `useSyncExternalStore`'s server snapshot is always `null` — the same "match
 * the server default, apply the real value only after mount" discipline
 * `theme-context.tsx` already established, avoiding that exact class of hydration
 * bug.
 */
const KEY = "lrms.activeViewId";

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

// Read once, at module load, on the client only — never during a component's
// render. `useSyncExternalStore` below is what actually reconciles this against the
// server's always-`null` snapshot without a hydration mismatch; this just seeds the
// value the very first read (`getActiveViewId`, a click-time call) would otherwise
// see as `null` even though a browser value exists.
let current: string | null = typeof window !== "undefined" ? readStored() : null;
const listeners = new Set<() => void>();

/** Non-reactive getter — for one-shot reads at click-time (submitChange/
 *  previewItemChange), not render-time. */
export function getActiveViewId(): string | null {
  return current;
}

export function setActiveViewId(id: string | null): void {
  current = id;
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Private window, cleared site data, storage blocked — the value still lives in
    // the module variable for this page load; it just won't survive a reload.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string | null {
  return current;
}

function getServerSnapshot(): string | null {
  return null;
}

/** Reactive read — Sidebar's picker and useRegisterState both need re-renders when
 *  this changes. `getServerSnapshot` always returns `null` (the server has no
 *  browser to read localStorage from); `useSyncExternalStore` reconciles that against
 *  the real client value after hydration on its own, the same "match the server
 *  default first" discipline `theme-context.tsx` already established. */
export function useActiveViewId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

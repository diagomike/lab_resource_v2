"use client";

import { useEffect, useRef } from "react";

/**
 * The one row a link named (`?need=`, `?import=`…) — the same marking Approvals gives the
 * card you followed: an accent edge on the soft fill, scrolled to the middle of the screen
 * once, when it has drawn.
 */
export const FOCUS_ROW = "bg-soft border-l-3 border-accent";

export function useScrollToFocus(domId: string | null, ready: boolean): void {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!domId || !ready || done.current === domId) return;
    const el = document.getElementById(domId);
    if (!el) return;
    done.current = domId;
    requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  });
}

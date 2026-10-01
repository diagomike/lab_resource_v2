"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { HomeCountsDto } from "@/lib/shared";
import { api } from "./api";

/**
 * The sidebar's badges and the bell's unread count, read once for the whole shell:
 * on load, whenever the window regains focus, and every minute. `refresh()` lets a
 * screen update them right after it acted (approved something, read a notice).
 */

interface CountsState {
  counts: HomeCountsDto | null;
  refresh: () => void;
}

const CountsContext = createContext<CountsState>({ counts: null, refresh: () => {} });

const EVERY_MS = 60_000;

export function HomeCountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<HomeCountsDto | null>(null);
  const refresh = useCallback(() => {
    // A failed refresh keeps the last numbers rather than blanking every badge.
    api.get<HomeCountsDto>("/home/counts").then(setCounts, () => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, EVERY_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return <CountsContext.Provider value={{ counts, refresh }}>{children}</CountsContext.Provider>;
}

export function useHomeCounts(): CountsState {
  return useContext(CountsContext);
}

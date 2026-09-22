"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingMarkersDto } from "@/lib/shared";
import { api } from "@/lib/api";

/** Which register items a pending lab Draft would change, and how — for the `*`
 *  markers. `refresh()` after an edit that may have been staged. */
export function usePendingMarkers(): { markers: PendingMarkersDto; refresh: () => void } {
  const [markers, setMarkers] = useState<PendingMarkersDto>({});
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    api
      .get<PendingMarkersDto>("/resources/labs/pending")
      .then((m) => live && setMarkers(m))
      .catch(() => live && setMarkers({}));
    return () => {
      live = false;
    };
  }, [token]);
  return { markers, refresh };
}

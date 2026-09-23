"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingMarkersDto, PendingTransferMarkersDto } from "@/lib/shared";
import { api } from "@/lib/api";

/** Which register items a pending lab Draft would change, and how — for the `*`
 *  markers — and which a pending transfer or handover will move (`⇄`). `refresh()`
 *  after an edit that may have been staged, or a transfer that was requested. */
export function usePendingMarkers(): { markers: PendingMarkersDto; transfers: PendingTransferMarkersDto; refresh: () => void } {
  const [markers, setMarkers] = useState<PendingMarkersDto>({});
  const [transfers, setTransfers] = useState<PendingTransferMarkersDto>({});
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    api
      .get<PendingMarkersDto>("/resources/labs/pending")
      .then((m) => live && setMarkers(m))
      .catch(() => live && setMarkers({}));
    api
      .get<PendingTransferMarkersDto>("/resources/transfers/pending")
      .then((m) => live && setTransfers(m))
      .catch(() => live && setTransfers({}));
    return () => {
      live = false;
    };
  }, [token]);
  return { markers, transfers, refresh };
}

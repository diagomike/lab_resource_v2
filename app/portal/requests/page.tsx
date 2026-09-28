"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RequesterRequestSummaryDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import PortalChrome, { RequireRequester } from "@/components/portal/PortalChrome";
import { Panel, ErrorNote, Tag } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { EXTERNAL_STATUS_LABEL, KIND_LABEL, externalStatusTone } from "@/components/external/labels";

/** A signed-in requester's own requests, newest first. */
function MyRequests() {
  const [rows, setRows] = useState<RequesterRequestSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RequesterRequestSummaryDto[]>("/portal/requests")
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load your requests."));
  }, []);

  return (
    <PortalChrome>
      <div className="flex flex-wrap items-center gap-10">
        <h1 className="text-19 font-semibold flex-1">My requests</h1>
        <Link href="/portal/request" className="inline-flex items-center border border-accent bg-accent text-white h-28 px-14 rounded-2 text-12 font-medium no-underline">
          New request
        </Link>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Panel>
        {rows === null ? (
          <PanelLoading rows={3} />
        ) : rows.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">You haven&apos;t sent a request yet.</div>
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/portal/requests/${r.id}`} className="block px-14 py-10 border-b border-border last:border-0 hover:bg-panel2 no-underline text-current">
              <div className="flex flex-wrap items-center gap-8">
                <span className="font-mono font-semibold text-11.5">{r.reference}</span>
                <Tag tone="neutral">{KIND_LABEL[r.kind]}</Tag>
                <Tag tone={externalStatusTone(r.status)}>{EXTERNAL_STATUS_LABEL[r.status]}</Tag>
                <span className="flex-1" />
                <span className="text-10.5 text-faint">{r.firstWindow ? `from ${r.firstWindow.date}` : ""}</span>
              </div>
              <div className="text-11 text-dim truncate">{r.purpose}</div>
            </Link>
          ))
        )}
      </Panel>
    </PortalChrome>
  );
}

export default function PortalMyRequestsPage() {
  return (
    <RequireRequester>
      <MyRequests />
    </RequireRequester>
  );
}

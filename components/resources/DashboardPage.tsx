"use client";

import { useEffect, useState } from "react";
import type { ItemSummaryDto } from "@/lib/shared";
import { EFFECTIVE_STATUS_LIST } from "@/lib/shared";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote } from "@/components/ui";
import { PanelLoading } from "@/components/states";

const TONE_CLASS: Record<string, string> = {
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  cross: "text-cross",
  dim: "text-dim",
  faint: "text-faint",
};

/**
 * What the register looks like from where you stand — the caller's own scope, never
 * the whole institution. lib/server/resources/items.ts's `summary()` computes
 * effective status over the WHOLE containment forest and then scopes the result, so
 * these counts already reflect derived (IMPAIRED-inclusive) status, not just what was
 * last written to a row.
 */
export default function DashboardPage() {
  const [summary, setSummary] = useState<ItemSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ItemSummaryDto>("/resources/items/summary")
      .then(setSummary)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the dashboard"));
  }, []);

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!summary ? (
        <Panel title="Overview">
          <PanelLoading rows={4} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
            <StatTile label="Resources in your scope" value={summary.total} />
            <StatTile label="Needs attention" value={summary.needsAttention} tone={summary.needsAttention > 0 ? "warn" : undefined} />
          </div>

          <Panel title="By status">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-10 px-14 py-14">
              {EFFECTIVE_STATUS_LIST.map((status) => (
                <div key={status} className="flex items-center justify-between border border-border rounded-3 px-11 py-8">
                  <span className="text-11 text-dim">{STATUS_LABEL[status]}</span>
                  <span className={`text-13 font-mono font-semibold ${TONE_CLASS[STATUS_TONE[status]] ?? ""}`}>
                    {summary.byEffectiveStatus[status] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          {summary.total === 0 && (
            <Panel title="Nothing here yet">
              <div className="px-14 py-14 text-11.5 text-dim leading-loose">
                No resources are filed under your scope yet. Categories and the register
                editing surface land in later phases of the replatforming plan.
              </div>
            </Panel>
          )}
        </>
      )}
    </Screen>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="bg-panel border border-border rounded-3 px-14 py-12">
      <div className="text-9.5 uppercase tracking-label text-faint font-semibold">{label}</div>
      <div className={`text-20 font-semibold mt-4 font-mono ${tone === "warn" && value > 0 ? "text-warn" : ""}`}>{value}</div>
    </div>
  );
}

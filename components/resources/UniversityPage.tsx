"use client";

import { Suspense, useMemo, useState } from "react";
import { useRegisterState, MODE_LABEL, MODE_HELP, type RegisterMode } from "@/lib/register/useRegisterState";
import { NEEDS_ATTENTION } from "@/lib/domain/status";
import { useAuth } from "@/lib/auth-context";
import { Panel, Screen, ErrorNote, Button } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { ResourceTable } from "./ResourceTable";
import { FilterBar } from "./FilterBar";
import { Inspector } from "./Inspector";
import { PullTransferModal } from "./PullTransferModal";

const MODES: RegisterMode[] = ["tree", "rollup", "flat"];

/**
 * "Does any department already have one of these, and is it working?" — the surface
 * a purchase-approving office or department head uses to answer that before
 * approving a purchase (10b of
 * ~/.claude/plans/three-product-changes-dynamic-thompson.md). Read-only, and provably
 * so: no Add button, no bulk toolbar, no inline commit — `Inspector`'s `readOnly`
 * prop covers the drill-through. Seeing further grants nothing; the write door stays
 * custody-based (`assertCanMutate`) regardless of what this page shows, unaffected by
 * `scope=UNIVERSITY`.
 *
 * Reuses the register's own engine wholesale rather than forking it — the same
 * `useRegisterState`/`FilterBar`/`ResourceTable`/`Inspector` `/register` uses,
 * parameterized by `scope: "UNIVERSITY"`. The one addition specific to this page is
 * the rollup card below: owning unit × category, split working / needs-attention —
 * the actual question this page exists to answer, and "on loan"
 * (current unit ≠ owning unit) is the owner/current split's whole point, so it is
 * called out explicitly rather than left for someone to notice in a column.
 *
 * Since Track 5 (~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md)
 * this is also where a transfer STARTS: transfers are pulled, so a custodian ticks
 * what another unit holds and asks for it into their own lab (`PullTransferModal`).
 * Still read-only — the request goes through the approval chain, nothing is written
 * from here directly.
 */
function UniversityPageInner() {
  const state = useRegisterState({ scope: "UNIVERSITY" });
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [pullOpen, setPullOpen] = useState(false);
  const allExpanded = state.expanded === true;
  const { user } = useAuth();

  /** A tree selection ticks a row's whole subtree; a transfer is about the top-most of
   *  those (the server collapses it the same way). Anything already in the viewer's own
   *  custody is left out — that is a Move in their own register, not a transfer. */
  const pullItems = useMemo(() => {
    const chosen = new Set(state.selectedItemIds);
    return state.selectedItemIds
      .filter((id) => {
        let parentId = state.byId.get(id)?.parentId ?? null;
        while (parentId) {
          if (chosen.has(parentId)) return false;
          parentId = state.byId.get(parentId)?.parentId ?? null;
        }
        return true;
      })
      .map((id) => state.byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row) && row!.custodianId !== user?.id)
      .map((row) => ({ id: row.id, name: row.name, categoryId: row.categoryId }));
  }, [state.selectedItemIds, state.byId, user?.id]);

  const rollup = useMemo(() => {
    const byKey = new Map<string, { key: string; unit: string; category: string; working: number; needsAttention: number; onLoan: number }>();
    for (const row of state.rows ?? []) {
      const key = `${row.ownerOrgNodeId}::${row.categoryId}`;
      const entry = byKey.get(key) ?? { key, unit: row.ownerOrgNodeName, category: row.categoryName, working: 0, needsAttention: 0, onLoan: 0 };
      if (NEEDS_ATTENTION.includes(row.effectiveStatus)) entry.needsAttention += 1;
      else entry.working += 1;
      if (row.currentOrgNodeId !== row.ownerOrgNodeId) entry.onLoan += 1;
      byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => a.unit.localeCompare(b.unit) || a.category.localeCompare(b.category));
  }, [state.rows]);

  return (
    <Screen>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      <Panel
        title="Rollup by owning unit × category"
        actions={<span className="text-10.5 text-faint">Counts reflect the filters below</span>}
      >
        {state.loading ? (
          <PanelLoading rows={4} />
        ) : rollup.length === 0 ? (
          <div className="px-14 py-14 text-11.5 text-dim">No resources match the current filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-11">
              <thead>
                <tr className="text-9.5 uppercase tracking-label text-faint font-semibold border-b border-border">
                  <th className="text-left px-14 py-8">Owning unit</th>
                  <th className="text-left px-14 py-8">Category</th>
                  <th className="text-right px-14 py-8">Working</th>
                  <th className="text-right px-14 py-8">Needs attention</th>
                  <th className="text-right px-14 py-8">On loan</th>
                </tr>
              </thead>
              <tbody>
                {rollup.map((r) => (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="px-14 py-6">{r.unit}</td>
                    <td className="px-14 py-6 text-dim">{r.category}</td>
                    <td className="px-14 py-6 text-right font-mono">{r.working}</td>
                    <td className={`px-14 py-6 text-right font-mono ${r.needsAttention > 0 ? "text-warn" : ""}`}>{r.needsAttention}</td>
                    <td className={`px-14 py-6 text-right font-mono ${r.onLoan > 0 ? "text-accent" : "text-faint"}`}>{r.onLoan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="University resources"
        actions={
          <div className="flex items-center gap-10">
            {state.mode !== "flat" && (
              <button
                onClick={() => state.setExpanded(allExpanded ? {} : true)}
                title={allExpanded ? "Collapse all" : "Expand all"}
                className="border border-border2 bg-panel2 text-dim h-24 px-9 rounded-2 text-10.5 flex items-center gap-5 flex-none"
              >
                <span>{allExpanded ? "▾" : "▸"}</span>
                <span>{allExpanded ? "Collapse all" : "Expand all"}</span>
              </button>
            )}
            <div className="flex items-center gap-4">
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => state.setMode(m)}
                  title={MODE_HELP[m]}
                  style={{
                    background: state.mode === m ? "var(--accent)" : "var(--panel2)",
                    color: state.mode === m ? "#fff" : "var(--dim)",
                  }}
                  className="border-0 text-10.5 font-medium px-9 py-4 rounded-2"
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <FilterBar filters={state.filters} onChange={state.setFilters} onClear={state.clearFilters} scope="UNIVERSITY" />

        {state.selectedItemIds.length > 0 && (
          <div className="flex items-center gap-8 px-14 py-7 border-b border-border bg-panel2">
            <span className="text-10.5 text-dim">
              {pullItems.length === 0 ? "Everything selected is already yours" : `${pullItems.length} to request`}
            </span>
            <Button variant="primary" disabled={pullItems.length === 0} onClick={() => setPullOpen(true)}>
              Request transfer to my lab…
            </Button>
            <button onClick={() => state.setSelection({})} className="text-10.5 text-faint ml-auto">
              Clear selection
            </button>
          </div>
        )}

        {state.loading ? (
          <PanelLoading rows={6} />
        ) : (
          <ResourceTable
            rows={state.rowNodes}
            byId={state.byId}
            expanded={state.expanded}
            onExpandedChange={state.setExpanded}
            selection={state.selection}
            onSelectionChange={state.setSelection}
            onInspect={setInspectId}
            showPath={state.mode === "flat"}
            selectable
          />
        )}
      </Panel>

      <Inspector itemId={inspectId} onClose={() => setInspectId(null)} onChanged={() => {}} onNavigate={setInspectId} readOnly scope="UNIVERSITY" canRequestPull />

      {pullOpen && pullItems.length > 0 && (
        <PullTransferModal
          items={pullItems}
          onClose={() => setPullOpen(false)}
          onDone={() => {
            setPullOpen(false);
            state.setSelection({});
          }}
        />
      )}
    </Screen>
  );
}

/** useSearchParams needs a Suspense boundary in the Next.js App Router. */
export default function UniversityPage() {
  return (
    <Suspense>
      <UniversityPageInner />
    </Suspense>
  );
}

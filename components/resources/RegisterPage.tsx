"use client";

import { Suspense, useState } from "react";
import { useRegisterState, MODE_LABEL, MODE_HELP, type RegisterMode } from "@/lib/register/useRegisterState";
import { Panel, Screen, ErrorNote, Button } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { ResourceTable } from "./ResourceTable";
import { FilterBar } from "./FilterBar";
import { Inspector } from "./Inspector";

const MODES: RegisterMode[] = ["tree", "rollup", "flat"];

function RegisterPageInner() {
  const state = useRegisterState();
  const [inspectId, setInspectId] = useState<string | null>(null);

  return (
    <Screen>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      <Panel
        title="Register"
        actions={
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
        }
      >
        <FilterBar filters={state.filters} onChange={state.setFilters} onClear={state.clearFilters} />

        {state.loading ? (
          <PanelLoading rows={6} />
        ) : (
          <>
            <ResourceTable
              rows={state.rowNodes}
              byId={state.byId}
              expanded={state.expanded}
              onExpandedChange={state.setExpanded}
              selection={state.selection}
              onSelectionChange={state.setSelection}
              onInspect={setInspectId}
              showPath={state.mode === "flat"}
            />

            {state.mode === "flat" && state.total > state.pageSize && (
              <div className="flex items-center justify-between px-14 py-9 border-t border-border">
                <span className="text-10.5 text-dim">
                  {(state.page - 1) * state.pageSize + 1}–{Math.min(state.page * state.pageSize, state.total)} of {state.total}
                </span>
                <div className="flex items-center gap-6">
                  <Button disabled={state.page <= 1} onClick={() => state.setPage(state.page - 1)}>
                    Previous
                  </Button>
                  <Button disabled={state.page * state.pageSize >= state.total} onClick={() => state.setPage(state.page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      <Inspector itemId={inspectId} onClose={() => setInspectId(null)} />
    </Screen>
  );
}

/** useSearchParams needs a Suspense boundary in the Next.js App Router. */
export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterPageInner />
    </Suspense>
  );
}

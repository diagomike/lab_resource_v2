"use client";

import { useEffect, useMemo, useState } from "react";
import type { ItemRowDto } from "@/lib/shared";
import { ApiError } from "@/lib/api";
import { resourcesApi } from "@/lib/resources/api";
import { buildItemColumns } from "@/lib/resources/columns";
import { DataTable } from "@/components/data-table";
import { Panel, Screen } from "@/components/ui";
import { InlineError, PanelLoading, EmptyState } from "@/components/states";

/**
 * Phase 1 of the resource register: a flat, scoped list. Every row here is one this
 * signed-in user may see — scope was applied server-side (ItemScopeService) before the
 * response ever left the API, so this page filters/sorts client-side over an already-
 * narrowed set, never over the whole register.
 *
 * Containment (parentId), the tree/rollup views, mutations and derived status arrive in
 * later phases — see the resource-register plan.
 */
export default function RegisterPage() {
  const [items, setItems] = useState<ItemRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setError(null);
    setItems(null);
    resourcesApi
      .search()
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the register"));
  }
  useEffect(reload, []);

  const columns = useMemo(buildItemColumns, []);

  return (
    <Screen>
      <Panel title="Resource register">
        {error ? (
          <InlineError message={error} onRetry={reload} />
        ) : items === null ? (
          <PanelLoading rows={6} />
        ) : items.length === 0 ? (
          <EmptyState title="Nothing here yet" body="No resources are recorded within your scope yet." />
        ) : (
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            tableId="register"
          />
        )}
      </Panel>
    </Screen>
  );
}

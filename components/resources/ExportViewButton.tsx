"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { ItemRowDto, ResourceCategoryDto } from "@/lib/shared";
import type { RowNode } from "@/lib/domain/tree";
import { api } from "@/lib/api";
import { toast } from "@/components/toast";
import { exportView } from "@/lib/register/export-view";

/** "Export this view" — what the register shows now, as a spreadsheet. */
export function ExportViewButton({ rows, byId, fileBase, paged }: { rows: RowNode[]; byId: Map<string, ItemRowDto>; fileBase: string; paged?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const categories = await api.getShared<ResourceCategoryDto[]>("/resources/categories");
      const n = await exportView(rows, byId, categories, fileBase);
      toast.success(`Exported ${n} item${n === 1 ? "" : "s"}${paged ? " (this page)" : ""} to a spreadsheet.`);
    } catch (e) {
      toast.error(`The export didn't work${e instanceof Error && e.message ? `: ${e.message}` : "."}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy || rows.length === 0}
      title={paged ? "Export the items on this page, as a spreadsheet" : "Export what is shown, as a spreadsheet"}
      className="border border-border2 bg-panel2 text-dim h-24 px-9 rounded-2 text-11 flex items-center gap-5 flex-none disabled:opacity-45"
    >
      <Download size={12} aria-hidden="true" />
      {busy ? "Exporting…" : "Export"}
    </button>
  );
}

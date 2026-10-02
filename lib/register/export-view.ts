"use client";

import type { ItemRowDto, ResourceCategoryDto } from "@/lib/shared";
import { STATUS_LABEL } from "@/lib/domain/status";
import type { RowNode } from "@/lib/domain/tree";

/**
 * "Export this view" — what the register shows right now (its filters and scope; in the
 * paged search list, the page on screen), one row per item, as an .xlsx file: the
 * fixed columns, then one column per detail the categories in view record. exceljs is
 * loaded only when someone exports.
 */

/** Every item the rows speak for, in display order, each once. */
export function itemsInView(rows: RowNode[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (list: RowNode[]) => {
    for (const r of list) {
      const ids = r.kind === "item" ? [r.item.id] : r.kind === "cluster" ? r.memberIds : [];
      for (const id of ids) if (!seen.has(id)) (seen.add(id), out.push(id));
      walk(r.children);
    }
  };
  walk(rows);
  return out;
}

function cell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return JSON.stringify(value);
}

export async function exportView(rows: RowNode[], byId: Map<string, ItemRowDto>, categories: ResourceCategoryDto[], fileBase: string): Promise<number> {
  const items = itemsInView(rows)
    .map((id) => byId.get(id))
    .filter((r): r is ItemRowDto => !!r);
  const usedCategories = new Set(items.map((i) => i.categoryId));
  // One column per detail, in category order; two categories' same-named details share it.
  const detailColumns: Array<{ key: string; label: string }> = [];
  const seenLabels = new Map<string, string>();
  for (const c of categories.filter((c) => usedCategories.has(c.id))) {
    for (const f of c.fields) {
      const id = `${f.label}`.toLowerCase();
      if (!seenLabels.has(id)) {
        seenLabels.set(id, f.label);
        detailColumns.push({ key: id, label: f.label });
      }
    }
  }
  const labelOf = new Map<string, Map<string, string>>(); // categoryId → key → column id
  for (const c of categories) labelOf.set(c.id, new Map(c.fields.map((f) => [f.key, f.label.toLowerCase()])));

  const { Workbook } = (await import("exceljs")).default ?? (await import("exceljs"));
  const book = new Workbook();
  book.created = new Date();
  const sheet = book.addWorksheet("Resources", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Name", key: "name", width: 34 },
    { header: "Where", key: "where", width: 44 },
    { header: "Category", key: "category", width: 24 },
    { header: "Status", key: "status", width: 16 },
    { header: "Quantity", key: "qty", width: 10 },
    { header: "Custodian", key: "custodian", width: 24 },
    { header: "Current unit", key: "current", width: 28 },
    { header: "Owner", key: "owner", width: 28 },
    ...detailColumns.map((d) => ({ header: d.label, key: `d:${d.key}`, width: 18 })),
  ];
  sheet.getRow(1).font = { bold: true };
  for (const i of items) {
    const row: Record<string, unknown> = {
      name: i.name,
      where: i.path.join(" › "),
      category: i.categoryName,
      status: STATUS_LABEL[i.status as keyof typeof STATUS_LABEL] ?? i.status,
      qty: i.qty,
      custodian: i.custodianName,
      current: i.currentOrgNodeName,
      owner: i.ownerOrgNodeName,
    };
    const map = labelOf.get(i.categoryId);
    for (const [k, v] of Object.entries(i.props ?? {})) {
      const col = map?.get(k);
      if (col) row[`d:${col}`] = cell(v);
    }
    sheet.addRow(row);
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileBase} ${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return items.length;
}

/**
 * What a department could buy to bring its labs to their approved ideal state — the
 * department-wide roll-up of every lab's own ideal-vs-actual sheet (Track 2's
 * `LabIdealTarget` against the live register).
 *
 * Deliberately a SUGGESTION, never a request: a head reads it while compiling their
 * own purchase request and decides what to carry forward (and how much of it), the
 * same "never auto-convert" discipline purchasing.ts already applies to needs.
 *
 * Gaps are summed PER LAB, each floored at zero. A lab holding more than its target
 * does not cancel another lab's shortage — surplus in one room is a transfer, not a
 * reason to buy less for a different room.
 */

export interface LabIdealRow {
  categoryId: string;
  categoryName: string;
  idealQty: number;
  actualCount: number;
  gap: number;
  brokenItems: Array<{ id: string; name: string; status: string }>;
}

export interface LabIdealSheet {
  labItemId: string;
  labName: string;
  rows: LabIdealRow[];
}

export interface PurchasableLab {
  labItemId: string;
  labName: string;
  idealQty: number;
  actualCount: number;
  gap: number;
  brokenCount: number;
}

export interface PurchasableRow {
  categoryId: string;
  categoryName: string;
  idealQty: number;
  actualCount: number;
  gap: number;
  brokenCount: number;
  labs: PurchasableLab[];
}

/** Only categories at least one lab actually set a target for — a department's ideal
 *  state is what drives this, not whatever happens to be on the shelves. */
export function aggregatePurchasables(sheets: LabIdealSheet[]): PurchasableRow[] {
  const byCategory = new Map<string, PurchasableRow>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      if (row.idealQty <= 0) continue;
      const entry = byCategory.get(row.categoryId) ?? { categoryId: row.categoryId, categoryName: row.categoryName, idealQty: 0, actualCount: 0, gap: 0, brokenCount: 0, labs: [] };
      const gap = Math.max(0, row.idealQty - row.actualCount);
      entry.idealQty += row.idealQty;
      entry.actualCount += row.actualCount;
      entry.gap += gap;
      entry.brokenCount += row.brokenItems.length;
      entry.labs.push({ labItemId: sheet.labItemId, labName: sheet.labName, idealQty: row.idealQty, actualCount: row.actualCount, gap, brokenCount: row.brokenItems.length });
      byCategory.set(row.categoryId, entry);
    }
  }
  return [...byCategory.values()].sort((a, b) => b.gap - a.gap || a.categoryName.localeCompare(b.categoryName));
}

export interface SuggestedLine {
  categoryId: string;
  name: string;
  qty: number;
  justification: string;
}

/** Request lines a head can start from: one per category with something to buy —
 *  the summed gap, plus a replacement for every broken/impaired unit when asked. The
 *  justification carries the per-lab breakdown, so the line can be defended upward
 *  without the approver having to open the register. */
export function suggestedLines(rows: PurchasableRow[], includeBroken: boolean): SuggestedLine[] {
  return rows
    .map((row) => {
      const qty = row.gap + (includeBroken ? row.brokenCount : 0);
      const perLab = row.labs
        .filter((l) => l.gap > 0 || (includeBroken && l.brokenCount > 0))
        .map((l) => `${l.labName} −${l.gap}${includeBroken && l.brokenCount ? ` +${l.brokenCount} broken` : ""}`)
        .join(", ");
      const justification = `Ideal ${row.idealQty}, current ${row.actualCount} across ${row.labs.length} lab${row.labs.length === 1 ? "" : "s"}${perLab ? ` (${perLab})` : ""}`;
      return { categoryId: row.categoryId, name: row.categoryName, qty, justification };
    })
    .filter((l) => l.qty > 0);
}

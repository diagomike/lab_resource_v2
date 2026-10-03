/**
 * How far the places held for an outside request cover what it asked for (2026-10-02).
 * The requester builds lab setups: "2 × Lab, each with 25 × Workstation and 1 ×
 * Projector". For every date and time asked for, the places held then are counted
 * against that: how many places of each kind, and how many of each thing (working, in
 * the held places) against how many the setups need in all. Pure; the server counts
 * what each held place holds.
 */

export interface SetupNeed {
  categoryId: string;
  categoryName: string;
  qty: number;
}

export interface Setup {
  placeCategoryId: string;
  placeCategoryName: string;
  /** How many places of this kind. */
  count: number;
  /** What each one must have. */
  needs: SetupNeed[];
}

export interface HeldPlace {
  /** The window it is held for ("2026-10-14 09:00–17:00"). */
  windowKey: string;
  placeCategoryId: string;
  /** Working things in it, by kind. */
  counts: Record<string, number>;
}

export interface CoverageRow {
  label: string;
  have: number;
  need: number;
}

export interface WindowCoverage {
  windowKey: string;
  rows: CoverageRow[];
  complete: boolean;
}

export interface Coverage {
  windows: WindowCoverage[];
  complete: boolean;
}

/** Per window: places of each kind, then things of each kind across the setups. */
export function coverageOf(setups: Setup[], windowKeys: string[], held: HeldPlace[]): Coverage {
  const places = new Map<string, { name: string; need: number }>();
  const things = new Map<string, { name: string; need: number }>();
  for (const s of setups) {
    const p = places.get(s.placeCategoryId) ?? { name: s.placeCategoryName, need: 0 };
    p.need += s.count;
    places.set(s.placeCategoryId, p);
    for (const n of s.needs) {
      const t = things.get(n.categoryId) ?? { name: n.categoryName, need: 0 };
      t.need += n.qty * s.count;
      things.set(n.categoryId, t);
    }
  }
  const windows = windowKeys.map((windowKey) => {
    const here = held.filter((h) => h.windowKey === windowKey);
    const rows: CoverageRow[] = [
      ...[...places.entries()].map(([id, p]) => ({ label: p.name, have: here.filter((h) => h.placeCategoryId === id).length, need: p.need })),
      ...[...things.entries()].map(([id, t]) => ({ label: t.name, have: here.reduce((sum, h) => sum + (h.counts[id] ?? 0), 0), need: t.need })),
    ];
    return { windowKey, rows, complete: rows.every((r) => r.have >= r.need) };
  });
  return { windows, complete: windows.length > 0 && windows.every((w) => w.complete) };
}

/** "1 of 2 Labs · 28 of 50 Workstations" for one window. */
export function coverageLine(w: WindowCoverage): string {
  return w.rows.map((r) => `${Math.min(r.have, r.need)} of ${r.need} ${r.label}`).join(" · ");
}

export interface Shortfall {
  categoryId: string;
  categoryName: string;
  have: number;
  need: number;
}

/** What a place lacks to be one of the requester's labs (2026-10-03): checked against the
 *  setup of its kind it comes closest to. `null` when no setup asks for its kind of place;
 *  `[]` when it has everything each one must have. A place is held only when it fits. */
export function shortfallOf(setups: Setup[], placeCategoryId: string, counts: Record<string, number>): Shortfall[] | null {
  const ofKind = setups.filter((s) => s.placeCategoryId === placeCategoryId);
  if (!ofKind.length) return null;
  let best: Shortfall[] | null = null;
  let bestMissing = Infinity;
  for (const s of ofKind) {
    const short = s.needs
      .map((n) => ({ categoryId: n.categoryId, categoryName: n.categoryName, have: counts[n.categoryId] ?? 0, need: n.qty }))
      .filter((n) => n.have < n.need);
    const missing = short.reduce((sum, n) => sum + n.need - n.have, 0);
    if (missing < bestMissing) {
      best = short;
      bestMissing = missing;
    }
  }
  return best;
}

/** "1 × Projector, 5 × Workstation": what is still missing. */
export function shortfallLine(short: Shortfall[]): string {
  return short.map((s) => `${s.need - s.have} × ${s.categoryName}`).join(", ");
}

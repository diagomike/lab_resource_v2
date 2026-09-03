/**
 * Derived, bottom-up impairment — ported from temp_works/src/lib/status.ts, verbatim.
 * Only an item's own status is ever stored (see types.ts's ItemStatus); everything
 * here is recomputed, never persisted. A stored rollup is a value that can silently
 * drift out of step with the facts beneath it, and a resource register that lies
 * about what works is worse than no register.
 */
import type { Category, EffectiveStatus, Item } from "./types";

/** Statuses that count as "down" when a critical child has them. IMPAIRED is in the
 *  set, which is what makes impairment travel: broken RAM impairs its Motherboard,
 *  and the impaired Motherboard impairs the Computer. */
const IMPAIRING = new Set<EffectiveStatus>(["BROKEN", "UNDER_MAINTENANCE", "LOST", "IMPAIRED"]);

export interface StatusInfo {
  effective: EffectiveStatus;
  /** Names of the critical children responsible, for the "why?" tooltip. */
  culprits: string[];
}

const WORKING: StatusInfo = { effective: "WORKING", culprits: [] };

/**
 * One bottom-up pass over the whole forest. Returns effective status for every item.
 *
 * Computed over the WHOLE relevant forest, not a scoped subset — a lab's condition is
 * a fact about the lab, not about who is looking, so this must never be called against
 * a caller's scoped item set and then filtered down; scope the RESULT, not the input.
 */
export function computeStatuses(items: Item[], categories: Record<string, Category>): Map<string, StatusInfo> {
  const childrenOf = new Map<string, Item[]>();
  for (const it of items) {
    if (it.parentId == null) continue;
    const arr = childrenOf.get(it.parentId);
    if (arr) arr.push(it);
    else childrenOf.set(it.parentId, [it]);
  }

  const out = new Map<string, StatusInfo>();
  const visiting = new Set<string>();

  const visit = (item: Item): StatusInfo => {
    const cached = out.get(item.id);
    if (cached) return cached;
    // Cycle guard. Reparenting is validated separately, but a corrupted row must not
    // hang the computation.
    if (visiting.has(item.id)) return WORKING;
    visiting.add(item.id);

    let info: StatusInfo;
    if (item.status !== "WORKING") {
      info = { effective: item.status, culprits: [] };
    } else {
      const kids = childrenOf.get(item.id) ?? [];
      const rule = categories[item.categoryId]?.impairRule ?? "ANY_CRITICAL";
      const criticals = kids.filter((k) => k.critical);
      const down = criticals.filter((k) => IMPAIRING.has(visit(k).effective));
      // Non-critical children are still visited so the whole map is populated.
      for (const k of kids) if (!k.critical) visit(k);

      const impaired =
        rule === "NEVER" ? false : rule === "ALL_CRITICAL" ? criticals.length > 0 && down.length === criticals.length : down.length > 0;

      info = impaired ? { effective: "IMPAIRED", culprits: down.map((k) => k.name) } : WORKING;
    }

    visiting.delete(item.id);
    out.set(item.id, info);
    return info;
  };

  for (const it of items) visit(it);
  return out;
}

export function statusOf(map: Map<string, StatusInfo>, id: string): EffectiveStatus {
  return map.get(id)?.effective ?? "WORKING";
}

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  WORKING: "Working",
  IMPAIRED: "Impaired",
  BROKEN: "Broken",
  UNDER_MAINTENANCE: "Maintenance",
  LOST: "Lost",
  CONSUMED: "Consumed",
};

/**
 * Colour carries urgency, not category — a broken unit and a lost one both need
 * action. Tone keys target the app's own palette
 * (~/.claude/plans/wait-i-want-gentle-haven.md §6's mapping), not temp_works'
 * shadcn/oklch token names: WORKING→good, IMPAIRED→warn, BROKEN→bad,
 * UNDER_MAINTENANCE→cross, LOST/CONSUMED→dim/faint. Values are `--token` names for
 * `components/ui.tsx`'s `StatusChip` to resolve against `tailwind.config.js`'s
 * scale — filled in by the UI phase that first renders a status chip, not this one.
 */
export const STATUS_TONE: Record<EffectiveStatus, string> = {
  WORKING: "good",
  IMPAIRED: "warn",
  BROKEN: "bad",
  UNDER_MAINTENANCE: "cross",
  LOST: "dim",
  CONSUMED: "faint",
};

/** Statuses that mean somebody has to do something. */
export const NEEDS_ATTENTION: EffectiveStatus[] = ["BROKEN", "IMPAIRED", "UNDER_MAINTENANCE", "LOST"];

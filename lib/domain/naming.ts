/**
 * Sibling names — one systematic scheme for "Workstation 01, 02, …" so a second bulk
 * add never repeats a name already in the same place.
 *
 * Rules (the user's own, from manual testing on 2026-09-22):
 *  - Two live siblings never share a name (compared case- and whitespace-insensitively).
 *  - Numbering continues from what is already there and FILLS GAPS FIRST: with
 *    Workstation 01–20 and 12 deleted, adding 5 gives 12, 21, 22, 23, 24.
 *  - A bare "Workstation" (no number) counts as taking slot 1.
 *  - Numbers are zero-padded to at least two digits. A fresh set is padded to fit its
 *    largest number (001…151). Once siblings exist, their padding is kept and larger
 *    numbers are simply written out (…, 98, 99, 100), so a second batch never mixes
 *    widths (R2-2 of the 2026-09-23 run: "01"–"75", then "076"–"151"). Existing names
 *    are never renamed.
 *  - A single new item keeps the bare base name when nothing beside it uses that base;
 *    otherwise it is numbered like the rest.
 *
 * "Siblings" means items with the same parent — for a top-level item, the top-level
 * items of the same owning unit.
 */

/** The comparison form of a name: trimmed, inner whitespace collapsed, lower-cased. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Numbers already taken under `base` among `siblingNames` (bare base = 1). */
export function usedNumbers(base: string, siblingNames: string[]): Set<number> {
  const b = normalizeName(base);
  const numbered = new RegExp(`^${escapeRegExp(b)} 0*(\\d+)$`);
  const used = new Set<number>();
  for (const raw of siblingNames) {
    const n = normalizeName(raw);
    if (n === b) used.add(1);
    const m = n.match(numbered);
    if (m) used.add(Number(m[1]));
  }
  return used;
}

/** The padding the existing numbered siblings already use: the widest zero-padded
 *  number among them ("Chair 007" → 3), or 2 when none is padded. */
function establishedWidth(base: string, siblingNames: string[]): number {
  const numbered = new RegExp(`^${escapeRegExp(normalizeName(base))} (\\d+)$`);
  let width = 2;
  for (const raw of siblingNames) {
    const m = normalizeName(raw).match(numbered);
    if (m && m[1].startsWith("0")) width = Math.max(width, m[1].length);
  }
  return width;
}

/** `count` new names under `base` that clash with none of `siblingNames`. */
export function allocateNames(base: string, siblingNames: string[], count: number): string[] {
  const cleanBase = base.trim().replace(/\s+/g, " ");
  if (count <= 0) return [];
  const used = usedNumbers(cleanBase, siblingNames);
  if (count === 1 && used.size === 0 && !siblingNames.some((s) => normalizeName(s) === normalizeName(cleanBase))) return [cleanBase];

  const picked: number[] = [];
  for (let n = 1; picked.length < count; n++) if (!used.has(n)) picked.push(n);
  const width = used.size ? establishedWidth(cleanBase, siblingNames) : Math.max(2, String(Math.max(...picked)).length);
  return picked.map((n) => `${cleanBase} ${String(n).padStart(width, "0")}`);
}

/** The first of `names` that already exists among `siblingNames` (or twice within
 *  `names` itself), or null — for the uniqueness check on rename and move. */
export function findNameClash(names: string[], siblingNames: string[]): string | null {
  const taken = new Set(siblingNames.map(normalizeName));
  for (const name of names) {
    const n = normalizeName(name);
    if (taken.has(n)) return name;
    taken.add(n);
  }
  return null;
}

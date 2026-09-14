/**
 * Who is already using this, then — the hierarchical clash rule for bookings. Track 6
 * of ~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md.
 *
 * A booking claims specific items for a half-open window [startsAt, endsAt). Two claims
 * clash when their windows overlap AND the items are related by containment:
 *  - the same item;
 *  - a room and anything inside it (booking a lab claims every machine in it, and a
 *    machine already booked makes the whole lab unavailable for exclusive use).
 * Two different machines in the same room never clash with each other.
 *
 * `blocking` separates what refuses a booking (HELD/CONFIRMED) from what only contends
 * with it (REQUESTED — two pending asks for one machine are worth showing now, not
 * after signatures). Pure: the server feeds it the lab's subtree and the overlapping
 * claims it loaded under its lock; the UI can run it too.
 */

export interface ExistingClaim {
  reservationId: string;
  itemId: string;
  startsAt: Date;
  endsAt: Date;
  blocking: boolean;
  title: string;
}

export interface ProposedBooking {
  itemIds: string[];
  startsAt: Date;
  endsAt: Date;
}

export interface Clash {
  reservationId: string;
  title: string;
  /** The proposed item that collides, and the already-claimed item it collides with. */
  itemId: string;
  claimedItemId: string;
  startsAt: Date;
  endsAt: Date;
  blocking: boolean;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Ancestor-or-self chain of an item, from a parent lookup. Stops on a cycle rather than
 *  looping — the register forbids one, but a pure function must not hang on bad input. */
export function lineageOf(itemId: string, parentOf: (id: string) => string | null | undefined): Set<string> {
  const out = new Set<string>();
  let current: string | null | undefined = itemId;
  while (current && !out.has(current)) {
    out.add(current);
    current = parentOf(current);
  }
  return out;
}

/** Are two items the same, or does one contain the other? */
export function related(a: string, b: string, parentOf: (id: string) => string | null | undefined): boolean {
  return lineageOf(a, parentOf).has(b) || lineageOf(b, parentOf).has(a);
}

/** Every existing claim the proposal collides with, one entry per (proposed item,
 *  claim) pair. `ignoreReservationIds` leaves out the proposal's own rows — deciding or
 *  regenerating something must not clash with itself. */
export function findClashes(
  proposed: ProposedBooking,
  existing: ExistingClaim[],
  parentOf: (id: string) => string | null | undefined,
  ignoreReservationIds: Iterable<string> = [],
): Clash[] {
  const ignore = new Set(ignoreReservationIds);
  const lineages = new Map(proposed.itemIds.map((id) => [id, lineageOf(id, parentOf)]));
  const out: Clash[] = [];
  for (const claim of existing) {
    if (ignore.has(claim.reservationId)) continue;
    if (!overlaps(proposed.startsAt, proposed.endsAt, claim.startsAt, claim.endsAt)) continue;
    const claimLineage = lineageOf(claim.itemId, parentOf);
    for (const itemId of proposed.itemIds) {
      if (lineages.get(itemId)!.has(claim.itemId) || claimLineage.has(itemId)) {
        out.push({ reservationId: claim.reservationId, title: claim.title, itemId, claimedItemId: claim.itemId, startsAt: claim.startsAt, endsAt: claim.endsAt, blocking: claim.blocking });
      }
    }
  }
  return out;
}

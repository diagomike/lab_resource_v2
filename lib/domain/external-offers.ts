/**
 * Packaged offers for outside requesters (2026-10-03). Instead of building a lab setup
 * by hand, the requester picks what they are holding (an examination, a training, a
 * workshop) and says for how many people; the offer turns that into the labs to ask for:
 * how many, and what each must have. The result is an ordinary lab setup, which they may
 * still edit. Pure: the server resolves each offer's kinds against the catalogue and
 * measures how many seats a typical place of that kind has.
 */
import type { Setup } from "./external-coverage";

export interface OfferSpec {
  key: string;
  name: string;
  /** One line for the requester: what it is for and what they get. */
  summary: string;
  /** Category key of the kind of place it is held in. */
  placeKey: string;
  /** Category key of what every person needs one of. */
  seatKey: string;
  /** Category keys of what every place must also have. */
  perPlace: Array<{ key: string; qty: number }>;
}

export const OFFERS: OfferSpec[] = [
  {
    key: "EXAM",
    name: "Examination",
    summary: "A computer-based recruitment or entrance examination: a workstation with internet for every candidate.",
    placeKey: "lab",
    seatKey: "setup",
    perPlace: [],
  },
  {
    key: "TRAINING",
    name: "Training",
    summary: "Hands-on training at the computers: a workstation for every trainee, and a whiteboard in each lab.",
    placeKey: "lab",
    seatKey: "setup",
    perPlace: [{ key: "whiteboard", qty: 1 }],
  },
  {
    key: "WORKSHOP",
    name: "Workshop",
    summary: "A workshop or seminar with presentations: a workstation for every participant, a projector and a whiteboard in each lab.",
    placeKey: "lab",
    seatKey: "setup",
    perPlace: [
      { key: "projector", qty: 1 },
      { key: "whiteboard", qty: 1 },
    ],
  },
];

/** An offer with its kinds found in the catalogue, and the seats a typical place has. */
export interface ResolvedOffer {
  key: string;
  name: string;
  summary: string;
  placeCategoryId: string;
  placeCategoryName: string;
  seatCategoryId: string;
  seatCategoryName: string;
  seatsPerPlace: number;
  perPlace: Array<{ categoryId: string; categoryName: string; qty: number }>;
}

/** A lab setup asks for at most this many places of one kind. */
export const MAX_PLACES = 20;
export const FALLBACK_SEATS = 20;

/** The seats a typical place has: the median of what the bookable places hold (a few
 *  larger rooms don't make every recommendation ask for more than most labs have). */
export function typicalSeats(counts: number[]): number {
  const have = counts.filter((n) => n > 0).sort((a, b) => a - b);
  if (!have.length) return FALLBACK_SEATS;
  return have[Math.floor((have.length - 1) / 2)];
}

/** The most people an offer can be recommended for. */
export const maxPeople = (offer: Pick<ResolvedOffer, "seatsPerPlace">) => offer.seatsPerPlace * MAX_PLACES;

/** The labs to ask for: as few as hold everyone, the people spread evenly over them. */
export function recommend(offer: ResolvedOffer, people: number): Setup | null {
  if (!Number.isInteger(people) || people < 1 || people > maxPeople(offer)) return null;
  const count = Math.ceil(people / offer.seatsPerPlace);
  const each = Math.ceil(people / count);
  return {
    placeCategoryId: offer.placeCategoryId,
    placeCategoryName: offer.placeCategoryName,
    count,
    needs: [{ categoryId: offer.seatCategoryId, categoryName: offer.seatCategoryName, qty: each }, ...offer.perPlace.map((p) => ({ categoryId: p.categoryId, categoryName: p.categoryName, qty: p.qty }))],
  };
}

/** "2 × Lab, each with 20 × Workstation Setup and 1 × Whiteboard". */
export function setupLine(setup: Setup): string {
  const needs = setup.needs.map((n) => `${n.qty} × ${n.categoryName}`);
  const list = needs.length > 1 ? `${needs.slice(0, -1).join(", ")} and ${needs[needs.length - 1]}` : needs[0];
  return `${setup.count} × ${setup.placeCategoryName}${list ? `, each with ${list}` : ""}`;
}

/**
 * Places — labs, workshops, studios and stores. Static, managed from above: a unit's
 * head (a college's dean and ADAA for the college, Property Administration for the Main
 * Store) creates them, keeps their details and assigns their custodian; the custodian
 * runs what is inside (lib/server/resources/places.ts).
 */
import { z } from "zod";
import { LabVersionStatusSchema } from "./enums";
import { ItemProps } from "./item";

export const PlaceDto = z.object({
  id: z.string(),
  name: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  categoryIconKey: z.string(),
  /** A store: the store keeper works it directly; a lab's changes are drafted. */
  isStore: z.boolean(),
  /** Can be booked as a room (its category's booking mode). */
  bookable: z.boolean(),
  ownerOrgNodeId: z.string(),
  ownerOrgNodeName: z.string(),
  custodianId: z.string(),
  custodianName: z.string(),
  /** The place's own details: block, room, seats, purpose… */
  props: ItemProps,
  /** Everything inside it, at any depth. */
  itemCount: z.number().int(),
  /** Inside it and broken, under maintenance or lost. */
  needsAttention: z.number().int(),
  /** The custodian's changes: not sent yet (EDITING), or waiting for the head. */
  draftStatus: LabVersionStatusSchema.nullable(),
  /** The caller manages this place (its details, its custodian). */
  canManage: z.boolean(),
  /** May change who runs it (the place's managers, and the college's ADAA). */
  canAssign: z.boolean(),
  /** The caller runs this place (they are its custodian). */
  isMine: z.boolean(),
  version: z.number().int(),
});
export type PlaceDto = z.infer<typeof PlaceDto>;

const placeName = z.string().trim().min(1, "Name the place").max(160);

export const CreatePlaceInput = z.object({
  categoryId: z.string().min(1),
  name: placeName,
  ownerOrgNodeId: z.string().min(1),
  custodianId: z.string().min(1, "Choose who runs it"),
  props: ItemProps.default({}),
});
export type CreatePlaceInput = z.infer<typeof CreatePlaceInput>;

export const UpdatePlaceInput = z.object({
  name: placeName.optional(),
  props: ItemProps.optional(),
  custodianId: z.string().min(1).optional(),
  /** Why the custodian changes — kept in History and told to both people. */
  note: z.string().trim().max(500).optional(),
});
export type UpdatePlaceInput = z.infer<typeof UpdatePlaceInput>;

/** What the "Add a lab or store" form offers this person. */
export const PlaceOptionsDto = z.object({
  /** The kinds of place (Lab, Workshop, Studio, Store) with their details to fill. */
  kinds: z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), iconKey: z.string() })),
  /** The units whose places this person manages — `storesOnly` where they may add
   *  stores but not labs (the ADAA's college). */
  units: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string(), storesOnly: z.boolean() })),
});
export type PlaceOptionsDto = z.infer<typeof PlaceOptionsDto>;

/** Who can run a place of a unit: active custodians (and store keepers) who work there;
 *  for a store, anyone who works there — `becomesCustodian` when choosing them makes them
 *  one (they hold no custodian role yet). */
export const PlaceCustodianDto = z.object({ id: z.string(), name: z.string(), title: z.string().nullable(), runs: z.number().int(), becomesCustodian: z.boolean() });
export type PlaceCustodianDto = z.infer<typeof PlaceCustodianDto>;

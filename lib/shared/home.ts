import { z } from "zod";

/** One notice under the bell and on Home (lib/server/mail/notify.ts writes them). */
export const NotificationDto = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  path: z.string(),
  actorName: z.string().nullable(),
  read: z.boolean(),
  /** Bad news: declined, rejected, sent back or cancelled. */
  declined: z.boolean(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

export const NotificationsDto = z.object({ items: z.array(NotificationDto), unread: z.number().int() });
export type NotificationsDto = z.infer<typeof NotificationsDto>;

/** Mark some notices read — or all of them. */
export const MarkNotificationsReadInput = z.object({
  ids: z.array(z.string()).max(200).optional(),
  all: z.boolean().optional(),
  /** Opening an area of the app reads its bad-news notices, which clears its red badge. */
  declinedInArea: z.enum(["approvals", "purchasing", "places", "outside", "bookings"]).optional(),
});
export type MarkNotificationsReadInput = z.infer<typeof MarkNotificationsReadInput>;

export const waitingKinds = ["transfer", "lab-commit", "purchase", "booking", "category-change", "needs", "procure", "arrivals", "loads", "external"] as const;
export type WaitingKind = (typeof waitingKinds)[number];

/** A kind of thing waiting for this person, counted, with where to act on it. */
export const WaitingDto = z.object({ kind: z.enum(waitingKinds), label: z.string(), count: z.number().int(), path: z.string() });
export type WaitingDto = z.infer<typeof WaitingDto>;

/** Something this person asked for, and where it stands. */
export const MyRequestDto = z.object({ kind: z.string(), label: z.string(), status: z.string(), detail: z.string().nullable(), path: z.string(), at: z.string() });
export type MyRequestDto = z.infer<typeof MyRequestDto>;

/** A date detail falling due — calibration, expiry. */
export const DueSoonDto = z.object({ itemId: z.string(), itemName: z.string(), what: z.string(), date: z.string(), days: z.number().int(), path: z.string() });
export type DueSoonDto = z.infer<typeof DueSoonDto>;

export const NextStepDto = z.object({ title: z.string(), body: z.string().nullable(), path: z.string(), action: z.string() });
export type NextStepDto = z.infer<typeof NextStepDto>;

export const UnfinishedDto = z.object({ label: z.string(), detail: z.string(), path: z.string() });
export type UnfinishedDto = z.infer<typeof UnfinishedDto>;

/** Home: the one next step, what waits, what is unfinished, what is yours, what is new. */
export const HomeDto = z.object({
  name: z.string(),
  nextStep: NextStepDto.nullable(),
  waiting: z.array(WaitingDto),
  unfinished: z.array(UnfinishedDto),
  mine: z.array(MyRequestDto),
  dueSoon: z.array(DueSoonDto),
  recent: z.array(NotificationDto),
  glance: z
    .object({ scopeName: z.string(), places: z.number().int(), items: z.number().int(), working: z.number().int(), attention: z.number().int() })
    .nullable(),
  admin: z.object({ vacantPosts: z.number().int(), placesWithoutCustodian: z.number().int(), peopleWithoutRole: z.number().int(), invitationsPending: z.number().int() }).nullable(),
});
export type HomeDto = z.infer<typeof HomeDto>;

/** One area's live counts: what waits for this person's action, and what they started
 *  or take part in that is still moving (it stops counting once it reaches its end,
 *  and at once when it fails: rejected, cancelled, declined). */
/** `action`: waiting for this person. `following`: theirs, still in progress. `declined`:
 *  bad news about something of theirs (declined, rejected, sent back) they haven't read. */
export const AreaCountDto = z.object({ action: z.number().int(), following: z.number().int(), declined: z.number().int().default(0) });
export type AreaCountDto = z.infer<typeof AreaCountDto>;

export const countAreas = ["approvals", "purchasing", "places", "outside", "bookings"] as const;
export type CountArea = (typeof countAreas)[number];

/** The sidebar's badges, the tabs' counts and the bell's — refreshed every minute.
 *  `tabs` breaks an area down by the tabs of its screen ("approvals.inbox",
 *  "purchasing.needs", …). */
export const HomeCountsDto = z.object({
  areas: z.object({ approvals: AreaCountDto, purchasing: AreaCountDto, places: AreaCountDto, outside: AreaCountDto, bookings: AreaCountDto }),
  tabs: z.record(z.string(), AreaCountDto),
  unread: z.number().int(),
});
export type HomeCountsDto = z.infer<typeof HomeCountsDto>;

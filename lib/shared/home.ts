import { z } from "zod";

/** One notice under the bell and on Home (lib/server/mail/notify.ts writes them). */
export const NotificationDto = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  path: z.string(),
  actorName: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type NotificationDto = z.infer<typeof NotificationDto>;

export const NotificationsDto = z.object({ items: z.array(NotificationDto), unread: z.number().int() });
export type NotificationsDto = z.infer<typeof NotificationsDto>;

/** Mark some notices read — or all of them. */
export const MarkNotificationsReadInput = z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() });
export type MarkNotificationsReadInput = z.infer<typeof MarkNotificationsReadInput>;

export const waitingKinds = ["transfer", "lab-commit", "purchase", "booking", "category-change", "needs", "arrivals", "loads", "external"] as const;
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

/** The sidebar's badges and the bell's count — refreshed every minute. */
export const HomeCountsDto = z.object({ approvals: z.number().int(), purchasing: z.number().int(), places: z.number().int(), outside: z.number().int(), unread: z.number().int() });
export type HomeCountsDto = z.infer<typeof HomeCountsDto>;

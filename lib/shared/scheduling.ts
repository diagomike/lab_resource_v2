/**
 * Scheduling wire contracts — Track 6 of
 * ~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md.
 *
 * No input here ever carries a bare datetime-local string: a time a person chose is a
 * civil date + "HH:mm" in the venue's zone (lib/domain/civil-time.ts), converted
 * server-side. Output instants are ISO strings (UTC) alongside the civil statement they
 * came from, so a client never has to re-derive either.
 */
import { z } from "zod";
import { BookingModeSchema } from "./resources/enums";

export const reservationSources = ["CLASS", "STAFF", "EXTERNAL", "MAINTENANCE"] as const;
export const ReservationSourceSchema = z.enum(reservationSources);
export type ReservationSource = (typeof reservationSources)[number];

export const reservationStates = ["REQUESTED", "HELD", "CONFIRMED", "DECLINED", "CANCELLED", "EXPIRED"] as const;
export const ReservationStateSchema = z.enum(reservationStates);
export type ReservationState = (typeof reservationStates)[number];

const CivilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-14.");
const CivilTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00.");

// ── Inputs ───────────────────────────────────────────────────────────────

export const BookingInput = z.object({
  /** The room, or specific machines — all within one room's tree. */
  itemIds: z.array(z.string()).min(1).max(100),
  date: CivilDate,
  start: CivilTime,
  end: CivilTime,
  title: z.string().trim().min(1, "Say what the booking is for.").max(160),
  participantCount: z.number().int().min(1).max(10_000).optional(),
  /** Staff booking for advisees — students never book themselves. */
  onBehalfOfNote: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type BookingInput = z.infer<typeof BookingInput>;

export const DecideBookingInput = z.object({
  decision: z.enum(["APPROVE", "DECLINE"]),
  note: z.string().trim().max(1000).optional(),
});
export type DecideBookingInput = z.infer<typeof DecideBookingInput>;

export const CancelBookingInput = z.object({ note: z.string().trim().max(1000).optional() });
export type CancelBookingInput = z.infer<typeof CancelBookingInput>;

export const SeriesInput = z.object({
  labItemId: z.string(),
  title: z.string().trim().min(1, "Name the course or session.").max(160),
  section: z.string().trim().max(60).optional(),
  instructorName: z.string().trim().max(160).optional(),
  participantCount: z.number().int().min(1).max(10_000).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one weekday."),
  startTimeLocal: CivilTime,
  endTimeLocal: CivilTime,
  startDate: CivilDate,
  endDate: CivilDate,
  /** Machines every session also claims, beyond the room itself. */
  equipmentItemIds: z.array(z.string()).max(200).default([]),
});
export type SeriesInput = z.infer<typeof SeriesInput>;

export const UpdateSeriesInput = SeriesInput.omit({ labItemId: true }).partial();
export type UpdateSeriesInput = z.infer<typeof UpdateSeriesInput>;

export const SeriesExceptionInput = z.object({
  date: CivilDate,
  reason: z.string().trim().max(500).optional(),
});
export type SeriesExceptionInput = z.infer<typeof SeriesExceptionInput>;

// ── Outputs ──────────────────────────────────────────────────────────────

export const ReservationResourceDto = z.object({
  itemId: z.string(),
  name: z.string(),
  categoryName: z.string(),
});
export type ReservationResourceDto = z.infer<typeof ReservationResourceDto>;

export const ReservationDto = z.object({
  id: z.string(),
  source: ReservationSourceSchema,
  state: ReservationStateSchema,
  title: z.string(),
  labItemId: z.string(),
  labName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  /** Civil statement in the venue's zone. */
  date: z.string(),
  start: z.string(),
  end: z.string(),
  seriesId: z.string().nullable(),
  requestedById: z.string().nullable(),
  requestedByName: z.string().nullable(),
  onBehalfOfNote: z.string().nullable(),
  participantCount: z.number().int().nullable(),
  holdExpiresAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  note: z.string().nullable(),
  resources: z.array(ReservationResourceDto),
  /** What the viewer may do with it — the server re-checks on every call. */
  canDecide: z.boolean(),
  canCancel: z.boolean(),
});
export type ReservationDto = z.infer<typeof ReservationDto>;

export const ClashDto = z.object({
  reservationId: z.string(),
  title: z.string(),
  source: ReservationSourceSchema,
  state: ReservationStateSchema,
  itemName: z.string(),
  claimedItemName: z.string(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
  blocking: z.boolean(),
});
export type ClashDto = z.infer<typeof ClashDto>;

export const BookingPreviewDto = z.object({
  labItemId: z.string(),
  labName: z.string(),
  custodianName: z.string(),
  /** True when the viewer decides for this room, so it confirms immediately. */
  autoConfirm: z.boolean(),
  /** HELD/CONFIRMED claims that make this booking impossible. */
  blocking: z.array(ClashDto),
  /** Other pending requests for the same slot — worth knowing, not a refusal. */
  contending: z.array(ClashDto),
});
export type BookingPreviewDto = z.infer<typeof BookingPreviewDto>;

export const BookableDto = z.object({
  id: z.string(),
  name: z.string(),
  bookingMode: BookingModeSchema,
  categoryName: z.string(),
  /** The room it is booked through (itself, for a room). */
  labItemId: z.string(),
  labName: z.string(),
  orgNodeName: z.string(),
  custodianName: z.string(),
  path: z.array(z.string()),
});
export type BookableDto = z.infer<typeof BookableDto>;

export const SchedulingLabDto = z.object({
  id: z.string(),
  name: z.string(),
  orgNodeName: z.string(),
  custodianName: z.string(),
  /** Staff requests waiting on this room's custodian. */
  pendingCount: z.number().int(),
  /** Bookable machines inside it, for the series/booking forms. */
  equipment: z.array(z.object({ id: z.string(), name: z.string(), categoryName: z.string() })),
});
export type SchedulingLabDto = z.infer<typeof SchedulingLabDto>;

export const ScheduleSeriesDto = z.object({
  id: z.string(),
  labItemId: z.string(),
  labName: z.string(),
  title: z.string(),
  section: z.string().nullable(),
  instructorName: z.string().nullable(),
  participantCount: z.number().int().nullable(),
  weekdays: z.array(z.number().int()),
  startTimeLocal: z.string(),
  endTimeLocal: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  timeZone: z.string(),
  active: z.boolean(),
  generation: z.number().int(),
  equipment: z.array(ReservationResourceDto),
  exceptions: z.array(z.object({ date: z.string(), reason: z.string().nullable() })),
  upcomingCount: z.number().int(),
});
export type ScheduleSeriesDto = z.infer<typeof ScheduleSeriesDto>;

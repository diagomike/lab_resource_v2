/**
 * Enums for the resource register — the domain settled in a sandbox
 * (D:/py_yaddessa/temp_works) before being carried across. See that sandbox's
 * src/lib/types.ts and status.ts for the original rationale; this file mirrors the
 * decisions, not the code.
 *
 * These are duplicated as Prisma enums in apps/api/prisma/schema.prisma, same
 * convention as ../enums.ts — Prisma cannot generate zod schemas, and importing
 * @prisma/client into the browser bundle is not an option.
 */
import { z } from "zod";

/** SERIALIZED = one row per physical unit, qty always 1. BULK = a quantity at a place. */
export const countingModes = ["SERIALIZED", "BULK"] as const;
export const CountingModeSchema = z.enum(countingModes);
export type CountingMode = (typeof countingModes)[number];

export const categoryFieldTypes = ["TEXT", "NUMBER", "ENUM", "BOOLEAN"] as const;
export const CategoryFieldTypeSchema = z.enum(categoryFieldTypes);
export type CategoryFieldType = (typeof categoryFieldTypes)[number];

/**
 * How a parent reacts to broken critical children.
 *  · ANY_CRITICAL — one critical child down impairs the parent (a Computer's Monitor).
 *  · ALL_CRITICAL — only impaired when EVERY critical child is down (redundant switches).
 *  · NEVER — never impaired by children, unconditionally, regardless of criticality (a
 *    Store is not "broken" because one reagent ran out). This is NOT "ignore ordinary
 *    contents but fail on a critical one" — that shape is ANY_CRITICAL with ordinary
 *    contents marked non-critical instead. See derived-status.ts.
 */
export const impairRules = ["ANY_CRITICAL", "ALL_CRITICAL", "NEVER"] as const;
export const ImpairRuleSchema = z.enum(impairRules);
export type ImpairRule = (typeof impairRules)[number];

/** STORED status only. IMPAIRED is DERIVED — see derived-status.ts — and is never a
 *  value of this enum; it is added on top as EffectiveStatus below. */
export const itemStatuses = ["WORKING", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"] as const;
export const ItemStatusSchema = z.enum(itemStatuses);
export type ItemStatus = (typeof itemStatuses)[number];

/** What a row actually shows, after derivation. Never stored. */
export const effectiveStatuses = [...itemStatuses, "IMPAIRED"] as const;
export const EffectiveStatusSchema = z.enum(effectiveStatuses);
export type EffectiveStatus = (typeof effectiveStatuses)[number];

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  WORKING: "Working",
  IMPAIRED: "Impaired",
  BROKEN: "Broken",
  UNDER_MAINTENANCE: "Maintenance",
  LOST: "Lost",
  CONSUMED: "Consumed",
};

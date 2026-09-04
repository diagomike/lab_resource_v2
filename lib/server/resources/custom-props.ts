import { z } from "zod";
import { CUSTOM_PROP_KEY_PATTERN, type CustomPropType, type ItemPropValue } from "@/lib/shared";
import { HttpError } from "../http-error";

/**
 * Item-specific properties — a supplement to a category's own typed schema, never a
 * substitute for it. A category's declared fields remain the standard structure every
 * item of that category shares (category-props.ts's own job, unchanged by this file);
 * this is the escape hatch for the one-off fact a single resource needs recorded
 * without an admin first changing the category definition for everyone.
 *
 * Deliberately NOT a relaxation of `validatePropWrite` to accept any unknown key as
 * text — that would blur the line this whole feature exists to keep sharp. A custom
 * property is validated by its OWN rules here: a safe key, no collision with the
 * item's category fields or its own other custom properties, and a value typed
 * against the type it was declared with (chosen once, at creation, never re-guessed).
 * No "server-only": pure, operating on already-loaded data, same discipline as
 * category-props.ts.
 */

function baseSchemaFor(type: CustomPropType): z.ZodType<Exclude<ItemPropValue, null>> {
  switch (type) {
    case "NUMBER":
      return z.number().finite();
    case "BOOLEAN":
      return z.boolean();
    case "TEXT":
    default:
      return z.string();
  }
}

const TYPE_MESSAGE: Record<CustomPropType, string> = {
  NUMBER: "This property is numeric.",
  BOOLEAN: "This property is yes/no.",
  TEXT: "This property is text.",
};

/** Case- and punctuation-insensitive — "Serial Number" and "serial_number" read as
 *  the SAME key for collision purposes, even though the exact text a person typed is
 *  what gets stored and displayed. Prevents the confusing case where two properties
 *  differing only in spacing/casing both claim to mean the same fact. */
export function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Trimmed, pattern-checked, non-empty after normalization (so "   " or "---" cannot
 *  slip through the regex's own leniency on internal characters). */
export function assertValidCustomKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) throw new HttpError(400, "Give this property a name.");
  if (!CUSTOM_PROP_KEY_PATTERN.test(trimmed)) {
    throw new HttpError(400, "Use letters, numbers, spaces, - or _, starting with a letter.");
  }
  if (!normalizeKey(trimmed)) throw new HttpError(400, "Give this property a name.");
  return trimmed;
}

/** A new custom property's key must not collide with this item's category fields
 *  (which stay the typed standard — a custom property pretending to BE "brand" would
 *  make two things mean the same fact) or with a custom property this item already
 *  has (the actual duplicate-key case). Both compared normalized, per `normalizeKey`. */
export function assertNoCollision(key: string, categoryFieldKeys: string[], existingCustomKeys: string[]): void {
  const norm = normalizeKey(key);
  const categoryHit = categoryFieldKeys.find((k) => normalizeKey(k) === norm);
  if (categoryHit) {
    throw new HttpError(400, `"${key}" collides with this category's own "${categoryHit}" field — use a different name, or edit that field's value instead.`);
  }
  const dupHit = existingCustomKeys.find((k) => normalizeKey(k) === norm);
  if (dupHit) {
    throw new HttpError(400, `This item already has a property named "${dupHit}".`);
  }
}

/** Validates a value against the type a custom property was declared with. Throws 400
 *  with a type-specific message; returns the value coerced to its stored type. */
export function validateCustomPropValue(type: CustomPropType, value: ItemPropValue): ItemPropValue {
  if (value === null) return null;
  const result = baseSchemaFor(type).safeParse(value);
  if (!result.success) throw new HttpError(400, TYPE_MESSAGE[type]);
  return result.data;
}

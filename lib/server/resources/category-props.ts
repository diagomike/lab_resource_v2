import { z } from "zod";
import type { CategoryFieldType, ItemPropValue } from "@/lib/shared";
import { HttpError } from "../http-error";

/**
 * Compiles CategoryField rows into a Zod schema on every write, so `Item.props` is
 * never written unvalidated and values are stored TYPED — a NUMBER field holds a JSON
 * number, never the string a form field might otherwise hand over. No "server-only":
 * pure compilation over already-loaded rows (the caller — mutate.ts — loads them from
 * Prisma), so it is directly unit-testable, same discipline as item-scope.logic.ts.
 *
 * Mirrors temp_works/src/lib/store.ts's `validate()` setProperty branch, but as a
 * reusable compiler rather than an inline switch, and returning the typed value
 * instead of only a yes/no.
 */
export interface CategoryFieldRow {
  key: string;
  label: string;
  type: CategoryFieldType;
  options: string[];
}

function baseSchemaFor(field: CategoryFieldRow): z.ZodType<Exclude<ItemPropValue, null>> {
  switch (field.type) {
    case "NUMBER":
      return z.number().finite();
    case "BOOLEAN":
      return z.boolean();
    case "ENUM":
      // An ENUM field with no options defined is a misconfigured category — categories.ts
      // requires at least one option before such a field can be saved, so this only
      // guards a value that somehow predates that rule; it must fail closed, not accept
      // anything.
      return field.options.length ? z.enum(field.options as [string, ...string[]]) : z.never();
    case "TEXT":
    default:
      return z.string();
  }
}

/** The full schema for one field, `null` (unset) always allowed regardless of type —
 *  clearing a value is never itself invalid. */
export function zodSchemaFor(field: CategoryFieldRow): z.ZodType<ItemPropValue> {
  return baseSchemaFor(field).nullable();
}

/** The whole-object schema for a category's `props` — every field optional (a fresh
 *  item starts with every value null; see lib/domain/instantiate.ts), used wherever a
 *  full props object is validated at once rather than one key at a time. */
export function buildCategoryPropsSchema(fields: CategoryFieldRow[]): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) shape[f.key] = zodSchemaFor(f).optional();
  return z.object(shape);
}

const TYPE_MESSAGE: Record<CategoryFieldType, (label: string) => string> = {
  NUMBER: (label) => `${label} must be numeric.`,
  BOOLEAN: (label) => `${label} must be yes or no.`,
  ENUM: (label) => `Choose a valid ${label.toLowerCase()} value.`,
  TEXT: (label) => `${label} is not valid.`,
};

/**
 * Validates ONE property write (the `setProperty` change kind) against its field
 * definition. `field` is `undefined` when the selected item's category does not
 * define the key at all — a bulk edit spanning two categories that happen to share a
 * key must not silently write a value one of them cannot hold. Throws 400 with a
 * field-specific message; returns the value coerced to its stored type.
 */
export function validatePropWrite(field: CategoryFieldRow | undefined, value: ItemPropValue): ItemPropValue {
  if (!field) throw new HttpError(400, "Choose a property defined by this category.");
  if (value === null) return null;
  const result = baseSchemaFor(field).safeParse(value);
  if (!result.success) throw new HttpError(400, TYPE_MESSAGE[field.type](field.label));
  return result.data;
}

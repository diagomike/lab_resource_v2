/**
 * Who decides a category edit. Categories belong to the department that made them
 * (custodians and heads know their machines), so:
 *
 *  - An edit that only ADDS — a new detail, an option, a part, a name, an icon, a
 *    description, or anything on a category no item uses yet — applies at once; the
 *    department's head is told and can adjust or undo it.
 *  - An edit that CHANGES data items already hold — removing or retyping a detail
 *    with values, renaming it, dropping a choice in use, making a detail required,
 *    changing how items count, fail, book or show publicly — waits for the head.
 *  - When it reaches items other departments own, it also passes the admin (who checks
 *    it is needed, or suggests a separate category) and Property Administration.
 *
 * The admin and Property Administration apply directly: they are the end of the chain.
 * Pure: lib/server/resources/category-governance.ts gathers the facts.
 */
import { filled } from "./field-migration";
import type { Category, FieldDef, Item } from "./types";

export type EditClass = "ADDITIVE" | "CHANGING";
export type ChangeStage = "HEAD" | "ADMIN" | "PROPERTY_ADMIN";

/** A category with the row-only settings that matter here. */
export type GovernedCategory = Category & { bookingMode?: string; publicListed?: boolean; description?: string | null };

const TYPE_WORD: Record<FieldDef["type"], string> = { text: "text", number: "a number", enum: "a choice", boolean: "yes/no", date: "a date" };
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Every way an edit changes data items already hold, in plain words. Empty: additive. */
export function changingReasons(before: GovernedCategory, after: GovernedCategory, items: Item[], fills: Record<string, unknown> = {}): string[] {
  const mine = items.filter((i) => i.categoryId === before.id);
  const out: string[] = [];
  if (!mine.length) return out;
  const valuesOf = (key: string) => mine.filter((i) => filled(i.props[key])).length;
  const nextByKey = new Map(after.fields.map((f) => [f.key, f]));

  for (const prev of before.fields) {
    const next = nextByKey.get(prev.key);
    const values = valuesOf(prev.key);
    if (!next) {
      if (values) out.push(`Removes “${prev.label}”, filled in on ${n(values, "item")}`);
      continue;
    }
    if (!values) continue;
    if (prev.type !== next.type) out.push(`Changes “${prev.label}” from ${TYPE_WORD[prev.type]} to ${TYPE_WORD[next.type]} (${n(values, "value")})`);
    if (prev.label.trim() !== next.label.trim()) out.push(`Renames “${prev.label}” to “${next.label}” (${n(values, "item")} ${values === 1 ? "has" : "have"} a value)`);
    if (prev.type === "number" && next.type === "number" && (prev.unit ?? "") !== (next.unit ?? "")) {
      out.push(`Changes the unit of “${prev.label}” from ${prev.unit || "none"} to ${next.unit || "none"} (${n(values, "value")} are not converted)`);
    }
    if (prev.type === "enum" && next.type === "enum") {
      const gone = (prev.options ?? []).filter((o) => !(next.options ?? []).includes(o) && mine.some((i) => i.props[prev.key] === o));
      if (gone.length) out.push(`Drops ${gone.map((o) => `“${o}”`).join(", ")} from “${prev.label}”, which items are set to`);
    }
  }
  for (const next of after.fields) {
    const prev = before.fields.find((f) => f.key === next.key);
    if (!next.required || prev?.required) continue;
    const lacking = mine.length - valuesOf(next.key);
    if (lacking) out.push(`Makes “${next.label}” required; ${n(lacking, "item")} ${lacking === 1 ? "has" : "have"} none${filled(fills[next.key] as never) ? " and will be filled in" : ""}`);
  }
  if (before.countingMode !== after.countingMode) out.push(`Counts ${n(mine.length, "item")} as ${after.countingMode === "BULK" ? "a quantity" : "individual units"} instead`);
  if (before.impairRule !== after.impairRule) out.push(`Changes when ${n(mine.length, "item")} count as impaired`);
  if ((before.isPlace ?? false) !== (after.isPlace ?? false)) out.push(`Turns ${n(mine.length, "item")} into ${after.isPlace ? "places" : "things"}`);
  if ((before.bookingMode ?? "NOT_BOOKABLE") !== (after.bookingMode ?? "NOT_BOOKABLE")) out.push(`Changes whether ${n(mine.length, "item")} can be booked`);
  if ((before.publicListed ?? false) !== (after.publicListed ?? false)) out.push(after.publicListed ? "Shows its count on the public portal" : "Takes its count off the public portal");
  return out;
}

export function classifyEdit(before: GovernedCategory, after: GovernedCategory, items: Item[], fills: Record<string, unknown> = {}): { cls: EditClass; reasons: string[] } {
  const reasons = changingReasons(before, after, items, fills);
  return { cls: reasons.length ? "CHANGING" : "ADDITIVE", reasons };
}

export interface EditActor {
  /** SYS_ADMIN or PROPERTY_ADMIN: the end of the chain. */
  isTop: boolean;
  /** Heads (or is the ADAA/dean of) the unit the change sits in. */
  headsOwnUnit: boolean;
}

export type EditRoute = { kind: "APPLY" } | { kind: "PROPOSE"; stages: ChangeStage[] };

/**
 * Additive edits apply. A changing edit applies for the head of the only unit it touches;
 * otherwise it waits — for the proposer's head, then (reaching other units) the admin
 * and Property Administration.
 */
export function routeEdit(cls: EditClass, actor: EditActor, crossUnit: boolean): EditRoute {
  if (actor.isTop || cls === "ADDITIVE") return { kind: "APPLY" };
  const stages: ChangeStage[] = [];
  if (!actor.headsOwnUnit) stages.push("HEAD");
  if (crossUnit) stages.push("ADMIN", "PROPERTY_ADMIN");
  return stages.length ? { kind: "PROPOSE", stages } : { kind: "APPLY" };
}

/** The stage after `stage` in a change's own chain, or null when it was the last. */
export function nextStage(stages: ChangeStage[], stage: ChangeStage): ChangeStage | null {
  const i = stages.indexOf(stage);
  return i >= 0 && i < stages.length - 1 ? stages[i + 1] : null;
}

export const STAGE_LABEL: Record<ChangeStage, string> = { HEAD: "the head", ADMIN: "the admin", PROPERTY_ADMIN: "Property Administration" };

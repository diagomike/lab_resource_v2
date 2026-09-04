/**
 * Every enum the resource-management module needs to name, mirroring the Prisma enums
 * in prisma/schema.prisma the same way lib/shared/enums.ts does for identity/org.
 *
 * ItemChangeKind is deliberately kept in temp_works' own camelCase (createItem,
 * setStatus, ...) rather than this file's usual UPPER_SNAKE_CASE — the pure domain
 * logic ported from temp_works (lib/domain/**, a later phase) switches on these
 * strings directly (needsConfirm, CONFIRMED_CHANGES, validate), and porting it
 * "essentially verbatim" means the vocabulary travels unchanged too. Every other enum
 * here was already UPPER_SNAKE_CASE in temp_works' own source, so there is no such
 * tension for them.
 */
import { z } from "zod";

// ── Categories ───────────────────────────────────────────────────────────
export const countingModes = ["SERIALIZED", "BULK"] as const;
export const CountingModeSchema = z.enum(countingModes);
export type CountingMode = (typeof countingModes)[number];

export const categoryFieldTypes = ["TEXT", "NUMBER", "ENUM", "BOOLEAN"] as const;
export const CategoryFieldTypeSchema = z.enum(categoryFieldTypes);
export type CategoryFieldType = (typeof categoryFieldTypes)[number];

/** The scalar types an item-specific CUSTOM property may take — deliberately a subset
 *  of CategoryFieldType (no ENUM: a custom property is a one-off fact, not a schema
 *  with predefined options — see lib/server/resources/custom-props.ts). */
export const customPropTypes = ["TEXT", "NUMBER", "BOOLEAN"] as const;
export const CustomPropTypeSchema = z.enum(customPropTypes);
export type CustomPropType = (typeof customPropTypes)[number];

/**
 * How a parent reacts to broken critical children.
 *  · ANY_CRITICAL — one critical child down impairs the parent (a Computer's Monitor)
 *  · ALL_CRITICAL — only impaired when EVERY critical child is down (redundant switches)
 *  · NEVER — never impaired by children, unconditionally, regardless of criticality (a
 *    Store is not "broken" because one reagent ran out). NOT "ignore ordinary contents
 *    but fail on a critical one" — that shape is ANY_CRITICAL with ordinary contents
 *    marked non-critical instead.
 */
export const impairRules = ["ANY_CRITICAL", "ALL_CRITICAL", "NEVER"] as const;
export const ImpairRuleSchema = z.enum(impairRules);
export type ImpairRule = (typeof impairRules)[number];

// ── Items ────────────────────────────────────────────────────────────────
/** STORED status only. IMPAIRED is DERIVED (lib/domain/status.ts) and never appears here. */
export const itemStatuses = ["WORKING", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"] as const;
export const ItemStatusSchema = z.enum(itemStatuses);
export type ItemStatus = (typeof itemStatuses)[number];

/** IMPAIRED is derived and never stored — this is the client-facing status vocabulary,
 *  a superset of ItemStatusSchema by exactly that one computed value. */
export const effectiveStatuses = [...itemStatuses, "IMPAIRED"] as const;
export const EffectiveStatusSchema = z.enum(effectiveStatuses);
export type EffectiveStatus = (typeof effectiveStatuses)[number];

export const itemChangeKinds = [
  "createItem",
  "deleteItem",
  "setName",
  "setStatus",
  "setProperty",
  "setQuantity",
  "setCustodian",
  "setOwnerOrg",
  "setCurrentOrg",
  "moveInTree",
  "transferItem",
  "addImage",
  "removeImage",
  "editCategory",
  /** Item-specific properties NOT defined by the category — see
   *  lib/server/resources/custom-props.ts and mutate.ts's own three handlers. */
  "addCustomProperty",
  "setCustomProperty",
  "removeCustomProperty",
] as const;
export const ItemChangeKindSchema = z.enum(itemChangeKinds);
export type ItemChangeKind = (typeof itemChangeKinds)[number];

export const itemChangeTargets = ["ITEM", "CATEGORY"] as const;
export const ItemChangeTargetSchema = z.enum(itemChangeTargets);
export type ItemChangeTarget = (typeof itemChangeTargets)[number];

// ── Access views ─────────────────────────────────────────────────────────
export const scopeModes = ["UNIVERSITY", "ORG_SUBTREE", "MY_CUSTODY", "EXPLICIT_NODES"] as const;
export const ScopeModeSchema = z.enum(scopeModes);
export type ScopeMode = (typeof scopeModes)[number];

export const viewAudienceTypes = ["EVERYONE", "ROLE", "PERSON"] as const;
export const ViewAudienceTypeSchema = z.enum(viewAudienceTypes);
export type ViewAudienceType = (typeof viewAudienceTypes)[number];

// ── Approvals ────────────────────────────────────────────────────────────
export const policyOutcomes = ["AUTO", "CHAIN", "DENY"] as const;
export const PolicyOutcomeSchema = z.enum(policyOutcomes);
export type PolicyOutcome = (typeof policyOutcomes)[number];

export const requestStatuses = ["PENDING", "APPLIED", "REJECTED", "CANCELLED", "STALE"] as const;
export const RequestStatusSchema = z.enum(requestStatuses);
export type RequestStatus = (typeof requestStatuses)[number];

export const stepStatuses = ["PENDING", "WAITING", "APPROVED", "REJECTED", "SKIPPED"] as const;
export const StepStatusSchema = z.enum(stepStatuses);
export type StepStatus = (typeof stepStatuses)[number];

/** Which selector produced a ChainStep, so it can say how to re-resolve itself.
 *  Authorization must not hang off display text. */
export const stepSelectorTypes = [
  "HIERARCHY",
  "NODE_OCCUPANT",
  "OWNER_ANCESTOR",
  "OWNER_HEAD",
  "TARGET_HEAD",
  "ITEM_CUSTODIAN",
  "TARGET_CUSTODIAN",
  "REQUESTER_RECEIPT",
] as const;
export const StepSelectorTypeSchema = z.enum(stepSelectorTypes);
export type StepSelectorType = (typeof stepSelectorTypes)[number];

export const objectSelectorTypes = ["ANY", "GROUP", "CATEGORY", "COUNTING_MODE"] as const;
export const ObjectSelectorTypeSchema = z.enum(objectSelectorTypes);
export type ObjectSelectorType = (typeof objectSelectorTypes)[number];

// ── Procurement ──────────────────────────────────────────────────────────
export const needStatuses = ["OPEN", "CARRIED", "DECLINED"] as const;
export const NeedStatusSchema = z.enum(needStatuses);
export type NeedStatus = (typeof needStatuses)[number];

export const purchaseStages = [
  "DRAFT",
  "APPROVING",
  "REVISING",
  "ORDER_PLACED",
  "BUYER_FOUND",
  "ON_DELIVERY",
  "IN_STORE",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;
export const PurchaseStageSchema = z.enum(purchaseStages);
export type PurchaseStage = (typeof purchaseStages)[number];

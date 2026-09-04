/**
 * The internal working types every pure lib/domain/** module shares — ported from
 * temp_works/src/lib/types.ts, essentially verbatim. Deliberately NOT the same as
 * lib/shared's Zod DTOs (API-facing, resolved names, no defaultChildren/props inline
 * shape) and NOT the Prisma models (categoryId/groupId foreign keys, not embedded
 * objects). This is the vocabulary the pure algorithms (status, tree, filters,
 * approvals, ...) are written against; the server layer (a later phase) translates
 * Prisma rows into these shapes before calling in, and translates results back out
 * into lib/shared DTOs. lib/server/org/closure-algorithm.ts already has its own
 * ClosureEdge/ClosureRow pair for the identical reason — this is the same pattern.
 *
 * `RoleKind` and `OrgNodeKind` are NOT redefined here — they are reused directly from
 * lib/shared, since the vocabulary is identical (temp_works' own ROLE_KINDS was
 * written to match lab_resource_v2's RoleKind field-for-field, and now that
 * STORE_KEEPER/EXTERNAL have landed there too, the two sets are exactly equal).
 */
import type { OrgNodeKind, RoleKind } from "@/lib/shared";

// ── Categories ───────────────────────────────────────────────────────────

export type CountingMode = "SERIALIZED" | "BULK";
export type FieldType = "text" | "number" | "enum" | "boolean";

/** One "defined metric" on a category: Computer has model, serial, brand, type. */
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[]; // enum only
  unit?: string; // number only
  /** Show in the table's compact "Specs" cell. Everything shows in the inspector. */
  summary?: boolean;
  /** Render as a multi-line block in the inspector — descriptions, procedures. */
  long?: boolean;
}

/** A slot in a category's default subtree: Computer contains 1 Motherboard, 2 Speakers. */
export interface TemplateChild {
  categoryId: string;
  qty: number;
  /** Does this child breaking break its parent? Monitor yes, Speaker no. */
  critical: boolean;
}

/**
 * How a parent reacts to broken critical children.
 *  · ANY_CRITICAL — one critical child down impairs the parent (a Computer's Monitor)
 *  · ALL_CRITICAL — only impaired when EVERY critical child is down (redundant switches)
 *  · NEVER — never impaired by children (a Store is not "broken" because one reagent
 *    ran out) — unconditionally, regardless of criticality; NOT "ignore ordinary
 *    contents but fail on a critical one", which is ANY_CRITICAL with the ordinary
 *    contents marked non-critical instead.
 */
export type ImpairRule = "ANY_CRITICAL" | "ALL_CRITICAL" | "NEVER";

/** Placement — see lib/domain/placement.ts's own header for the full contract. */
export type CategoryPlacementMode = "ANYWHERE" | "ONLY_LISTED";

export interface Category {
  id: string;
  name: string;
  /** Stable key into the curated icon registry (lib/domain/icons.ts). */
  iconKey: string;
  countingMode: CountingMode;
  unit?: string; // BULK only: ml, g, pcs
  fields: FieldDef[];
  defaultChildren: TemplateChild[];
  impairRule: ImpairRule;
  /** Cosmetic grouping in pickers: "IT", "Furniture", "Chemical"... */
  group: string;
  /** Stand-in picture for every item of this category that has none of its own. */
  defaultImage?: string;
  /** Bumped on every edit — the stale-write guard for a whole-object category write. */
  version: number;
  /** May an item of this category be a top-level resource (a Lab, a Store)? Optional
   *  (not defaulted here) for the same reason Item.customProps is: every existing
   *  fixture/adapter that builds a Category without placement in mind keeps compiling.
   *  `canPlace` treats an absent value as `false` — the permissive-except-rootedness
   *  posture this module's own header describes. */
  canBeRoot?: boolean;
  /** ANYWHERE (default) or ONLY_LISTED — see lib/domain/placement.ts. Absent is treated
   *  as ANYWHERE by `canPlace`, same rationale as canBeRoot above. */
  placement?: CategoryPlacementMode;
  /** This category's own allow-list — category ids it may be placed directly inside.
   *  Only consulted when `placement` is ONLY_LISTED; dormant otherwise. Absent is
   *  treated as `[]` by `canPlace`, same rationale as canBeRoot above. */
  allowedParentCategoryIds?: string[];
}

// ── Items ────────────────────────────────────────────────────────────────

export const ITEM_STATUSES = ["WORKING", "BROKEN", "UNDER_MAINTENANCE", "LOST", "CONSUMED"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** IMPAIRED is DERIVED and never stored — that is the point. */
export type EffectiveStatus = ItemStatus | "IMPAIRED";

export type PropValue = string | number | boolean | null;

export type CustomPropType = "TEXT" | "NUMBER" | "BOOLEAN";

/** One item-specific property NOT defined by its category — see
 *  lib/server/resources/custom-props.ts's own header. */
export interface CustomProp {
  type: CustomPropType;
  value: PropValue;
}

/** A reference, never bytes — object storage owns the actual file. */
export interface ItemImage {
  id: string;
  src: string;
  caption?: string;
}

export interface Item {
  id: string;
  /** null = a root (a Lab, a Store). Otherwise: what physically contains it. */
  parentId: string | null;
  categoryId: string;
  name: string;
  /** BULK only. SERIALIZED items are always 1. */
  qty: number;
  /** This item's OWN status. Never the rolled-up one. */
  status: ItemStatus;
  /** Is this item critical to its parent? Seeded from the template, overridable. */
  critical: boolean;
  props: Record<string, PropValue>;
  /** Item-specific properties this ONE item carries beyond what its category defines
   *  — a supplement to `props`, stored separately (Item.customProps, its own Prisma
   *  column) so nothing that reads `props` (search, prop:/desc: filters, a category's
   *  own purgeKeys) needs to know this exists unless explicitly taught to look.
   *  Optional (not `{}`-defaulted here) so every existing fixture/adapter that builds
   *  an `Item` without this concept in mind — the register's client-side
   *  ItemRowDto→Item adapter chief among them, since the row DTO deliberately does not
   *  carry it — keeps compiling; every reader treats an absent value as `{}`. */
  customProps?: Record<string, CustomProp>;
  images: ItemImage[];
  /** Accountability, which deliberately does NOT move when the item moves. */
  ownerOrgNodeId: string;
  /** The unit physically holding it right now. NOT NULL — "on loan" is
   *  currentOrgNodeId !== ownerOrgNodeId. Stronger than temp_works' own nullable
   *  pair (see ~/.claude/plans/wait-i-want-gentle-haven.md §1's "calls made" note). */
  currentOrgNodeId: string;
  /** Who is answerable. NEVER null: custody hands off, it never lapses. */
  custodianId: string;
  /** Bumped on every applied change — the approval layer's stale-write guard. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Changes ──────────────────────────────────────────────────────────────

/** Reused from lib/shared rather than redefined — temp_works' own CHANGE_KINDS is
 *  what lib/shared/resources/enums.ts's itemChangeKinds was ported from verbatim. */
export type { ItemChangeKind as ChangeKind } from "@/lib/shared";
import type { ItemChangeKind as ChangeKind } from "@/lib/shared";

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  createItem: "Add resource",
  deleteItem: "Delete resource",
  setName: "Rename",
  setStatus: "Status change",
  setProperty: "Property correction",
  setQuantity: "Quantity update",
  setCustodian: "Custody transfer",
  setOwnerOrg: "Ownership transfer",
  setCurrentOrg: "Current unit change",
  moveInTree: "Relocation",
  transferItem: "Transfer between units",
  addImage: "Add photo",
  removeImage: "Remove photo",
  editCategory: "Category definition",
  addCustomProperty: "Add optional property",
  setCustomProperty: "Optional property correction",
  removeCustomProperty: "Remove optional property",
};

/**
 * Which changes stop and ask first. Correcting a fact (a model number, a RAM size, a
 * name typo) is not a decision and must not feel like one. Every bulk edit confirms
 * regardless of kind — the risk there is the size of the selection, not the field —
 * which is why that rule lives at the call site, not this table.
 */
export const CONFIRMED_CHANGES: Record<ChangeKind, boolean> = {
  createItem: true,
  deleteItem: true,
  setName: false,
  setStatus: true,
  setProperty: false,
  setQuantity: false,
  setCustodian: true,
  setOwnerOrg: true,
  setCurrentOrg: true,
  moveInTree: true,
  transferItem: true,
  addImage: false,
  removeImage: true,
  editCategory: true,
  // Same treatment as setProperty: creating or correcting a one-off fact about a
  // single item is a correction, not a decision. Removing one is a deletion, same
  // treatment as removeImage.
  addCustomProperty: false,
  setCustomProperty: false,
  removeCustomProperty: true,
};

/** Does this change stop and ask first? */
export function needsConfirm(kind: ChangeKind, itemCount: number): boolean {
  return CONFIRMED_CHANGES[kind] || itemCount > 1;
}

/** Append-only. `actorId` only — the name is resolved at render. */
export interface ChangeLogEntry {
  id: string;
  at: string;
  actorId: string;
  kind: ChangeKind;
  /** What `itemId` points at. Category edits are not item changes. */
  targetKind?: "item" | "category";
  itemId: string;
  /** Snapshot: a deleted item's log line still has to read sensibly. */
  itemName: string;
  /** Property key for setProperty, otherwise the Item field that changed. */
  field?: string;
  before?: unknown;
  after?: unknown;
  /** Groups the N entries produced by one bulk operation. */
  batchId?: string;
  note?: string;
}

// ── Org chart (a domain-local ancestor-chain node — see org-chain.ts) ─────

/**
 * A unit that can own or hold resources, and approve changes to them — the pure
 * domain-logic shape the approval chain builder walks. `occupantId` mirrors the
 * production OrgNode.userId cache; a server module resolves it from Prisma before
 * calling in. This is NOT how visibility/reach is computed (that stays
 * lib/server/org/scope.ts's job, never re-derived here) — only how an approval
 * CHAIN is built once a request already knows its owning/target unit.
 */
export interface OrgNode {
  id: string;
  name: string;
  kind: OrgNodeKind;
  level: number;
  /** Adjacent-level parents. More than one = genuinely co-owned. */
  parentIds: string[];
  /** null = headless. */
  occupantId: string | null;
  active: boolean;
}

/**
 * What someone is, independent of where they sit — the pure domain-logic shape.
 * Mirrors production User+UserRole+homeNodeId; a server module resolves it from
 * Prisma before calling in.
 */
export interface Person {
  id: string;
  name: string;
  /** The unit someone works in WITHOUT necessarily heading it (User.homeNodeId).
   *  null for an external person, who belongs to no unit. */
  homeOrgNodeId: string | null;
  roles: RoleKind[];
  email?: string;
  phone?: string;
  /** Source role/title, e.g. ARA/SARA or laboratory responsible person. */
  title?: string;
  /** EXTERNAL only — which body they are here on behalf of. */
  organisation?: string;
}

/**
 * Loads a representative subset of temp_works' resource seed (categories, templates,
 * nested items, critical/non-critical children, statuses, properties, a loan, and
 * custodians) into the development database — mapped onto THIS app's real seeded
 * users and organization nodes (prisma/seed.ts), never onto temp_works' own mock
 * Person/OrgNode fixtures. Run after `npm run prisma:seed` (or any bootstrap that has
 * already created the SE/ChemE department fixture that script seeds), via:
 *
 *   npx tsx prisma/resource-seed.ts
 *
 * Item construction reuses lib/domain/instantiate.ts's buildSubtree/instantiateMany —
 * the exact function the "Add N × category" write path (lib/server/resources/mutate.ts)
 * calls — so a dev-seeded Computer has the identical shape one created through the app
 * would have. mutate.ts itself cannot be imported here (it starts `import "server-only"`,
 * which throws under plain Node/tsx outside a bundler's server-condition aliasing), so
 * the small Prisma-row mapping it does after instantiation is duplicated locally below.
 *
 * Idempotent by wipe-and-rebuild, matching prisma/seed.ts's own discipline: every run
 * clears the resource tables (categories, items, and their audit trail) and rebuilds
 * them from scratch. Refuses to run under NODE_ENV=production — this is dev fixture
 * data, not the real ASTU import (that importer is a later phase, keyed by
 * (sourceSystem, sourceKey) rather than wiped and rebuilt).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { buildSubtree, instantiateMany, newId, type InstantiateCtx } from "../lib/domain/instantiate";
import type { Category, Item as DomainItem } from "../lib/domain/types";
import { toDomainCategoryMap } from "../lib/server/resources/adapt";
import { sniffImage } from "../lib/server/resources/image-sniff";
import { REAL_CATEGORY_SPECS, REAL_GROUP_NAMES, loadOrCreateRealPeople, buildRealDataItems } from "./real-data-seed";
import { CATALOGUE_GROUPS, CATALOGUE_SPECS, CHEMICAL_FIELDS } from "./catalogue-data";
import { buildCseLabItems, loadOrCreateCseAras } from "./cse-lab-data";

const prisma = new PrismaClient();

if (process.env.NODE_ENV === "production") {
  console.error("prisma/resource-seed.ts refuses to run with NODE_ENV=production — this is dev fixture data.");
  process.exit(1);
}

/**
 * Rebuilding categories mints fresh ids every run. `NeedLine.categoryId` is a real FK
 * (onDelete: SetNull), so it survives a rebuild unharmed — but `ChangeRequest.payload`
 * and `ChainStep.receipt` are Json blobs that CAN embed a categoryId with no FK behind
 * it. Once any exist, a reset silently orphans whatever they point at, so the reset
 * stops instead — reset the whole database (`prisma migrate reset`) to start over.
 */
async function assertSafeToReset(): Promise<void> {
  const [requests, needs] = await Promise.all([prisma.changeRequest.count(), prisma.needLine.count()]);
  const found = [
    requests && `${requests} ChangeRequest row(s)`,
    needs && `${needs} NeedLine row(s)`,
  ].filter(Boolean);
  if (found.length) {
    console.error(
      `prisma/resource-seed.ts refuses to reset categories: ${found.join(", ")} may embed category ids in ` +
        `Json fields with no FK to protect them, and a rebuild mints new ids. Do not run this once that data ` +
        `is real — see the comment above assertSafeToReset() in this file.`,
    );
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Category vocabulary — the same shape as lib/domain/__fixtures__/seed.ts's
// SEED_CATEGORIES (that file is TEST-ONLY, for lib/domain/**'s specs; this is its own
// copy, written directly against Prisma's uppercase enums, for the real database).
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldSpec {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "ENUM" | "BOOLEAN" | "DATE";
  options?: string[];
  unit?: string;
  summary?: boolean;
  required?: boolean;
  longText?: boolean;
  /** A short example shown in the empty input. */
  hint?: string;
}

interface ChildSpec {
  key: string;
  qty: number;
  critical: boolean;
}

/** `group` is deliberately not a closed union — `real-data-seed.ts` adds four more
 *  (the Chemical Engineering department's own real category groupings) alongside the
 *  five synthetic ones below; `GROUP_NAMES`/`ALL_GROUP_NAMES` is the actual source of
 *  truth for what groups get created. */
export interface CategorySpec {
  key: string;
  name: string;
  iconKey: string;
  group: string;
  countingMode: "SERIALIZED" | "BULK";
  unit?: string;
  impairRule: "ANY_CRITICAL" | "ALL_CRITICAL" | "NEVER";
  fields?: FieldSpec[];
  defaultChildren?: ChildSpec[];
  /// A place (lab, store…): top level only — see lib/domain/placement.ts. Everything
  /// else is a thing, inside a place or a thing made of it.
  isPlace?: boolean;
  bookingMode?: "NOT_BOOKABLE" | "ROOM" | "EQUIPMENT";
  /// Its working count shows on the public portal (counts only).
  publicListed?: boolean;
  /// What it is for, in a sentence.
  description?: string;
  /// The org code of the department that looks after it; absent: university-wide
  /// (Property Administration).
  steward?: string;
}

const CATEGORY_SPECS: CategorySpec[] = [
  // ── Places: top level only, created by the unit's head (the ADAA for a college,
  //    Property Administration for the Main Store), run by an assigned custodian. ──
  {
    key: "lab", name: "Lab", iconKey: "FlaskConical", group: "Places", countingMode: "SERIALIZED", impairRule: "NEVER",
    isPlace: true, bookingMode: "ROOM", publicListed: true, description: "A teaching or research laboratory: a bookable room.",
    fields: [
      { key: "block", label: "Block", type: "TEXT", summary: true, required: true },
      { key: "room", label: "Room", type: "TEXT", summary: true, required: true },
      { key: "seats", label: "Seats", type: "NUMBER", summary: true },
      { key: "purpose", label: "Purpose", type: "TEXT", longText: true },
    ],
  },
  {
    key: "workshop", name: "Workshop", iconKey: "Hammer", group: "Places", countingMode: "SERIALIZED", impairRule: "NEVER",
    isPlace: true, bookingMode: "ROOM", description: "A machine shop or practical workshop: a bookable room.",
    fields: [
      { key: "block", label: "Block", type: "TEXT", summary: true, required: true },
      { key: "room", label: "Room", type: "TEXT", summary: true, required: true },
      { key: "seats", label: "Seats", type: "NUMBER", summary: true },
      { key: "purpose", label: "Purpose", type: "TEXT", longText: true },
    ],
  },
  {
    key: "studio", name: "Studio", iconKey: "PencilRuler", group: "Places", countingMode: "SERIALIZED", impairRule: "NEVER",
    isPlace: true, bookingMode: "ROOM", description: "A design studio (architecture, planning): a bookable room.",
    fields: [
      { key: "block", label: "Block", type: "TEXT", summary: true, required: true },
      { key: "room", label: "Room", type: "TEXT", summary: true, required: true },
      { key: "seats", label: "Seats", type: "NUMBER", summary: true },
      { key: "purpose", label: "Purpose", type: "TEXT", longText: true },
    ],
  },
  {
    key: "store", name: "Store", iconKey: "Warehouse", group: "Places", countingMode: "SERIALIZED", impairRule: "NEVER",
    isPlace: true, description: "Where stock and spares are kept: the Main Store, a college store or a department's.",
    fields: [
      { key: "level", label: "Level", type: "ENUM", options: ["Main store", "College store", "Department store"], summary: true, required: true },
      { key: "block", label: "Block", type: "TEXT", summary: true },
      { key: "room", label: "Room", type: "TEXT", summary: true },
    ],
  },
  {
    key: "setup", name: "Workstation Setup", iconKey: "Boxes", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    defaultChildren: [
      { key: "computer", qty: 1, critical: true },
      { key: "table", qty: 1, critical: false },
      { key: "chair", qty: 1, critical: false },
    ],
  },
  {
    key: "computer", name: "Computer", iconKey: "Laptop", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "brand", label: "Brand", type: "ENUM", options: ["Dell", "HP", "Lenovo", "Custom build"], summary: true },
      { key: "model", label: "Model", type: "TEXT", summary: true },
      { key: "serial", label: "Serial no.", type: "TEXT" },
      { key: "type", label: "Type", type: "ENUM", options: ["Desktop", "Laptop"], summary: true },
    ],
    defaultChildren: [
      { key: "motherboard", qty: 1, critical: true },
      { key: "monitor", qty: 1, critical: true },
      { key: "keyboard", qty: 1, critical: false },
      { key: "mouse", qty: 1, critical: false },
      { key: "speaker", qty: 2, critical: false },
      { key: "cable", qty: 2, critical: false },
    ],
  },
  {
    key: "motherboard", name: "Motherboard", iconKey: "Cpu", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [{ key: "model", label: "Model", type: "TEXT", summary: true }],
    defaultChildren: [
      { key: "ram", qty: 1, critical: true },
      { key: "storage", qty: 1, critical: true },
      // No GPU by default — ASTU's lab PCs have none (a GPU can still be added to one).
    ],
  },
  {
    key: "ram", name: "RAM", iconKey: "MemoryStick", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "ddrType", label: "DDR type", type: "ENUM", options: ["DDR3", "DDR4", "DDR5"], summary: true },
      { key: "sizeGB", label: "Size", type: "NUMBER", unit: "GB", summary: true },
    ],
  },
  {
    key: "storage", name: "Storage", iconKey: "HardDrive", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "kind", label: "Kind", type: "ENUM", options: ["SSD", "HDD"], summary: true },
      { key: "sizeGB", label: "Size", type: "NUMBER", unit: "GB", summary: true },
    ],
  },
  {
    key: "gpu", name: "GPU", iconKey: "CircuitBoard", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "model", label: "Model", type: "TEXT", summary: true },
      { key: "memGB", label: "Memory", type: "NUMBER", unit: "GB", summary: true },
    ],
  },
  {
    key: "monitor", name: "Monitor", iconKey: "Monitor", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "brand", label: "Brand", type: "ENUM", options: ["Dell", "HP", "Samsung", "LG"], summary: true },
      { key: "sizeIn", label: "Size", type: "NUMBER", unit: '"', summary: true },
    ],
  },
  { key: "keyboard", name: "Keyboard", iconKey: "Keyboard", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "mouse", name: "Mouse", iconKey: "Mouse", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "speaker", name: "Speaker", iconKey: "Speaker", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  {
    key: "cable", name: "Cable", iconKey: "Cable", group: "Computing & AV", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [{ key: "kind", label: "Kind", type: "ENUM", options: ["Power", "HDMI", "VGA", "Ethernet"], summary: true }],
  },
  {
    key: "switchrack", name: "Switch Rack", iconKey: "Server", group: "Network", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    defaultChildren: [
      { key: "netswitch", qty: 2, critical: true },
      { key: "outlet", qty: 6, critical: false },
    ],
  },
  {
    key: "netswitch", name: "Network Switch", iconKey: "Network", group: "Network", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "model", label: "Model", type: "TEXT", summary: true },
      { key: "ports", label: "Ports", type: "NUMBER", summary: true },
    ],
  },
  { key: "outlet", name: "Network Outlet", iconKey: "Link2", group: "Network", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "table", name: "Table", iconKey: "Table2", group: "Furniture & safety", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "chair", name: "Chair", iconKey: "Armchair", group: "Furniture & safety", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "whiteboard", name: "Whiteboard", iconKey: "Presentation", group: "Furniture & safety", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  {
    key: "chemical", name: "Chemical or reagent", iconKey: "FlaskConical", group: "Chemicals & consumables", countingMode: "BULK", unit: "ml", impairRule: "ANY_CRITICAL",
    description: "A chemical or reagent, counted by quantity, with its hazard, grade, storage and expiry.",
    fields: CHEMICAL_FIELDS,
  },
  {
    key: "glassware", name: "Glassware", iconKey: "Beaker", group: "Chemicals & consumables", countingMode: "BULK", unit: "pcs", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "type", label: "Type", type: "ENUM", options: ["Beaker", "Flask", "Pipette", "Burette", "Measuring cylinder", "Test tube", "Petri dish", "Funnel", "Other"], summary: true },
      { key: "volumeMl", label: "Volume", type: "NUMBER", unit: "ml", summary: true },
    ],
  },
];

const GROUP_NAMES = ["Places", "Computing & AV", "Network", "Furniture & safety", "Chemicals & consumables"] as const;
/** The synthetic fixture's own groups plus the Chemical Engineering department's
 *  real category groupings (real-data-seed.ts) — one combined category vocabulary,
 *  created together so both sit in the same category picker. */
const ALL_GROUP_NAMES = [...GROUP_NAMES, ...CATALOGUE_GROUPS, ...REAL_GROUP_NAMES];
/** The fixture's categories, the ASTU catalogue (prisma/catalogue-data.ts), and
 *  Chemical Engineering's own — looked after by that department. */
const ALL_CATEGORY_SPECS: CategorySpec[] = [...CATEGORY_SPECS, ...CATALOGUE_SPECS, ...REAL_CATEGORY_SPECS.map((spec) => ({ ...spec, steward: "CHEM" }))];

// ─────────────────────────────────────────────────────────────────────────────
// Wipe — leaves-first for Item (self-referential onDelete: Restrict means an
// unordered bulk delete can fail), then the category tree, matching
// prisma/seed.ts's own "idempotent by wipe-and-rebuild" discipline.
// ─────────────────────────────────────────────────────────────────────────────

async function wipe(): Promise<void> {
  await prisma.itemChange.deleteMany({});
  for (;;) {
    const leaves = await prisma.item.findMany({ where: { children: { none: {} } }, select: { id: true }, take: 500 });
    if (leaves.length === 0) break;
    await prisma.item.deleteMany({ where: { id: { in: leaves.map((l) => l.id) } } });
  }
  await prisma.resourceCategory.deleteMany({}); // cascades CategoryField/CategoryTemplateChild
  await prisma.categoryGroup.deleteMany({});
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories — create groups, then categories+fields, then template-child edges
// (need every category's real id first), then reload into lib/domain's Category
// shape keyed by REAL Prisma id, exactly as lib/server/resources/mutate.ts's
// loadAllCategoriesDomain() does for the live write path.
// ─────────────────────────────────────────────────────────────────────────────

async function createCategories(): Promise<{ categories: Record<string, Category>; idByKey: Map<string, string> }> {
  const groupId = new Map<string, string>();
  for (let i = 0; i < ALL_GROUP_NAMES.length; i++) {
    const row = await prisma.categoryGroup.create({ data: { name: ALL_GROUP_NAMES[i], sortOrder: i } });
    groupId.set(ALL_GROUP_NAMES[i], row.id);
  }

  const stewards = new Map((await prisma.orgNode.findMany({ where: { code: { not: null } }, select: { id: true, code: true } })).map((n) => [n.code!, n.id]));
  const idByKey = new Map<string, string>();
  for (const spec of ALL_CATEGORY_SPECS) {
    const row = await prisma.resourceCategory.create({
      data: {
        key: spec.key,
        name: spec.name,
        iconKey: spec.iconKey,
        groupId: groupId.get(spec.group)!,
        countingMode: spec.countingMode,
        unit: spec.unit ?? null,
        impairRule: spec.impairRule,
        isPlace: spec.isPlace ?? false,
        bookingMode: spec.bookingMode ?? "NOT_BOOKABLE",
        publicListed: spec.publicListed ?? false,
        description: spec.description ?? null,
        stewardNodeId: spec.steward ? (stewards.get(spec.steward) ?? null) : null,
        fields: spec.fields?.length
          ? {
              create: spec.fields.map((f, i) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                options: f.options ?? [],
                unit: f.unit ?? null,
                summary: f.summary ?? false,
                required: f.required ?? false,
                longText: f.longText ?? false,
                hint: f.hint ?? null,
                sortOrder: i,
              })),
            }
          : undefined,
      },
    });
    idByKey.set(spec.key, row.id);
  }

  for (const spec of ALL_CATEGORY_SPECS) {
    if (!spec.defaultChildren?.length) continue;
    await prisma.categoryTemplateChild.createMany({
      data: spec.defaultChildren.map((c) => ({
        parentCategoryId: idByKey.get(spec.key)!,
        childCategoryId: idByKey.get(c.key)!,
        qty: c.qty,
        critical: c.critical,
      })),
    });
  }

  const rows = await prisma.resourceCategory.findMany({
    include: { group: { select: { name: true } }, fields: true, templateAsParent: true },
  });
  return { categories: toDomainCategoryMap(rows), idByKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// Items — built with lib/domain/instantiate.ts, the same function the live
// createItem write path calls, then hand-detailed the way temp_works/src/lib/
// seed.ts's own fixture is (realistic props, a handful of seeded status stories so
// derived impairment is visible the moment the register is opened, and one loan).
// ─────────────────────────────────────────────────────────────────────────────

interface SeedIds {
  university: string;
  cse: string;
  chem: string;
  adminId: string;
  storeKeeperId: string;
  chemCustodianId: string;
}

async function loadSeedIds(): Promise<SeedIds> {
  const [university, cse, chem, admin, storeKeeper, chemCustodian] = await Promise.all([
    prisma.orgNode.findUnique({ where: { code: "ASTU" } }),
    prisma.orgNode.findUnique({ where: { code: "CSE" } }),
    prisma.orgNode.findUnique({ where: { code: "CHEM" } }),
    prisma.user.findUnique({ where: { emailLower: "admin@astu.edu.et" } }),
    prisma.user.findUnique({ where: { emailLower: "store.keeper@astu.edu.et" } }),
    prisma.user.findUnique({ where: { emailLower: "custodian.chem@astu.edu.et" } }),
  ]);
  const missing = [
    !university && "OrgNode(code=ASTU)",
    !cse && "OrgNode(code=CSE)",
    !chem && "OrgNode(code=CHEM)",
    !admin && "User(admin@astu.edu.et)",
    !storeKeeper && "User(store.keeper@astu.edu.et)",
    !chemCustodian && "User(custodian.chem@astu.edu.et)",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`resource-seed.ts needs the org/people seed first — missing: ${missing.join(", ")}. Run "npm run prisma:seed" before this script.`);
  }
  return {
    university: university!.id,
    cse: cse!.id,
    chem: chem!.id,
    adminId: admin!.id,
    storeKeeperId: storeKeeper!.id,
    chemCustodianId: chemCustodian!.id,
  };
}

function buildItems(categories: Record<string, Category>, ids: SeedIds, idByKey: Map<string, string>): DomainItem[] {
  const now = new Date("2026-09-03T09:00:00Z").toISOString();
  const items: DomainItem[] = [];
  const catId = (key: string): string => {
    const id = idByKey.get(key);
    if (!id) throw new Error(`Unknown seeded category key "${key}"`);
    return id;
  };

  const child = (parentId: string, key: string): DomainItem | undefined => items.find((i) => i.parentId === parentId && i.categoryId === catId(key));
  const childrenOfCat = (parentId: string, key: string): DomainItem[] => items.filter((i) => i.parentId === parentId && i.categoryId === catId(key));

  function add(key: string, parentId: string | null, name: string, ctx: InstantiateCtx, critical = false): DomainItem {
    const created = buildSubtree(categories, catId(key), parentId, name, critical, ctx);
    items.push(...created);
    return created[0];
  }

  // ── ASTU Main Store — university-owned, held by the store keeper; purchased stock
  //    is received here before it is handed over to a lab. ─────────────────────
  const mainStore = add("store", null, "ASTU Main Store", { ownerOrgNodeId: ids.university, custodianId: ids.storeKeeperId, now });
  mainStore.props.level = "Main store";
  mainStore.props.block = "Central stores building";
  const stockCtx: InstantiateCtx = { ownerOrgNodeId: ids.university, custodianId: ids.storeKeeperId, now };
  instantiateMany(categories, catId("table"), mainStore.id, 3, stockCtx).forEach((i) => items.push(i));
  instantiateMany(categories, catId("chair"), mainStore.id, 3, stockCtx).forEach((i) => items.push(i));

  // ── Chemical Engineering ────────────────────────────────────────────────
  const chemCtx: InstantiateCtx = { ownerOrgNodeId: ids.chem, custodianId: ids.chemCustodianId, now };
  const chemLab = add("lab", null, "Mechanical Unit Operations Laboratory", chemCtx);
  chemLab.props.block = "C";
  chemLab.props.room = "105";
  chemLab.props.seats = 20;
  chemLab.props.purpose = "Unit operations practicals";
  add("table", chemLab.id, "Table", chemCtx);
  add("chair", chemLab.id, "Chair", chemCtx);

  const store = add("store", null, "Chemistry Store — Room C-12", chemCtx);
  store.props.level = "Department store";
  store.props.block = "C";
  store.props.room = "12";

  const chemicals: Array<[string, string, string, number, number, boolean]> = [
    ["Acetone", "67-64-1", "Flammable", 2500, 99, false],
    ["Sulphuric acid 98%", "7664-93-9", "Corrosive", 1000, 98, false],
    ["Ethanol absolute", "64-17-5", "Flammable", 4000, 99, false],
    ["Sodium hydroxide soln.", "1310-73-2", "Corrosive", 1500, 50, false],
    // Marked critical AND fully consumed — the case that proves Store's NEVER rule
    // truly ignores every child unconditionally, not "unless critical" (see
    // ~/.claude/plans/wait-i-want-gentle-haven.md §5's two porting-rule corrections).
    ["Methanol", "67-56-1", "Toxic", 0, 99, true],
    ["Hydrogen peroxide 30%", "7722-84-1", "Oxidiser", 750, 30, false],
    ["Toluene", "108-88-3", "Flammable", 1200, 99, false],
    ["Acetic acid glacial", "64-19-7", "Corrosive", 900, 99, false],
  ];
  for (const [name, cas, hazard, qty, purity, critical] of chemicals) {
    const it = add("chemical", store.id, name, chemCtx, critical);
    it.props.casNumber = cas;
    it.props.hazard = hazard;
    it.props.purity = purity;
    it.qty = qty;
    if (qty === 0) it.status = "CONSUMED";
  }
  const glass: Array<[string, string, number, number]> = [
    ["Beakers 250 ml", "Beaker", 250, 40],
    ["Volumetric flasks 100 ml", "Flask", 100, 25],
    ["Graduated pipettes 10 ml", "Pipette", 10, 60],
    ["Burettes 50 ml", "Burette", 50, 12],
  ];
  for (const [name, type, vol, qty] of glass) {
    const it = add("glassware", store.id, name, chemCtx);
    it.props.type = type;
    it.props.volumeMl = vol;
    it.qty = qty;
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist — the same Prisma-row shape lib/server/resources/mutate.ts's
// itemCreateData() produces, duplicated here since that module cannot be imported
// (its "server-only" guard throws outside a bundler's server condition).
// ─────────────────────────────────────────────────────────────────────────────

function itemCreateData(item: DomainItem, categories: Record<string, Category>): Prisma.ItemCreateManyInput {
  return {
    id: item.id,
    parentId: item.parentId,
    categoryId: item.categoryId,
    name: item.name,
    countingMode: categories[item.categoryId]?.countingMode ?? "SERIALIZED",
    qty: item.qty,
    status: item.status,
    critical: item.critical,
    props: item.props as Prisma.InputJsonValue,
    ownerOrgNodeId: item.ownerOrgNodeId,
    currentOrgNodeId: item.currentOrgNodeId,
    custodianId: item.custodianId,
    version: item.version,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Real equipment photographs — a minimal, local-fs-driver-compatible write, not an
// import of lib/server/resources/storage/** (that module starts `import
// "server-only"`, which throws outside a bundler's server condition — the same
// reason mutate.ts/itemCreateData() above is duplicated rather than imported).
// Mirrors local-fs-driver.ts's own IMAGE_STORAGE_DIR resolution exactly, so a
// seeded photo is genuinely servable through the real `/api/resources/images/…`
// route afterward, not just a row with no bytes behind it.
// ─────────────────────────────────────────────────────────────────────────────

const ASSET_ROOT = path.resolve(process.cwd(), "prisma", "seed-assets", "equipment");
const IMAGE_STORAGE_ROOT = process.env.IMAGE_STORAGE_DIR ? path.resolve(process.env.IMAGE_STORAGE_DIR) : path.resolve(process.cwd(), ".local-storage", "images");

/** A stable, deterministic key derived from the source filename (its extension
 *  stripped — local-fs-driver's own key charset rejects the dot) rather than a
 *  fresh `crypto.randomUUID()` per run: re-running this script overwrites the same
 *  on-disk file instead of piling up an orphaned one per re-seed. Prefixed so it
 *  can never collide with a real upload's own randomUUID()-shaped key. */
function storageKeyFor(srcFilename: string): string {
  return `seed-chem-${path.basename(srcFilename, path.extname(srcFilename))}`;
}

/** Writes to whichever backend the app will read from (storage/index.ts's selector).
 *  Seeding production with the default local write put the photos on this machine's
 *  disk only, so every seeded photo was a 404 on Vercel. Same `images/` pathname as
 *  vercel-blob-driver.ts. */
async function writeSeedImage(key: string, bytes: Buffer): Promise<void> {
  if (process.env.IMAGE_STORAGE_DRIVER === "vercel-blob") {
    const { put } = await import("@vercel/blob");
    await put(`images/${key}`, bytes, { access: "private", addRandomSuffix: false, allowOverwrite: true });
  } else {
    await writeFile(path.join(IMAGE_STORAGE_ROOT, key), bytes);
  }
}

/** Reads each equipment item's source photograph(s) (`item.images[].src`, a bare
 *  filename — see real-data-seed.ts's own note on why), sniffs the real format/
 *  dimensions from the bytes exactly as a genuine upload does
 *  (`lib/server/resources/images.ts`'s `receiveUpload`), writes them to local
 *  storage, and inserts the real `ItemImage` rows. Only runs against items that
 *  actually persisted (called after `item.createMany`) since `ItemImage.itemId` is
 *  a real FK. */
async function persistRealImages(items: DomainItem[]): Promise<number> {
  const withImages = items.filter((i) => i.images.length > 0);
  if (!withImages.length) return 0;

  if (process.env.IMAGE_STORAGE_DRIVER !== "vercel-blob") await mkdir(IMAGE_STORAGE_ROOT, { recursive: true });
  const rows: Prisma.ItemImageCreateManyInput[] = [];
  for (const item of withImages) {
    for (const [index, img] of item.images.entries()) {
      const bytes = await readFile(path.join(ASSET_ROOT, img.src));
      const sniffed = sniffImage(bytes);
      if (!sniffed) {
        console.warn(`  skipping ${img.src}: not a recognizable PNG/JPEG/WEBP`);
        continue;
      }
      const key = storageKeyFor(img.src);
      await writeSeedImage(key, bytes);
      rows.push({
        itemId: item.id,
        storageKey: key,
        caption: img.caption ?? null,
        contentType: sniffed.mimeType,
        byteSize: bytes.length,
        width: sniffed.width,
        height: sniffed.height,
        sortOrder: index,
        sourceSystem: "temp_works-chem-lab",
        sourceKey: img.src,
      });
    }
  }
  if (rows.length) await prisma.itemImage.createMany({ data: rows });
  return rows.length;
}

async function main(): Promise<void> {
  console.log("Seeding lab_resource_v2's resource module (dev fixture)…");

  const ids = await loadSeedIds();
  await assertSafeToReset();
  await wipe();

  const { categories, idByKey } = await createCategories();
  const items = buildItems(categories, ids, idByKey);

  const peopleIdByEmail = await loadOrCreateRealPeople(prisma, { chem: ids.chem });
  const realItems = buildRealDataItems(categories, { chem: ids.chem, peopleIdByEmail }, idByKey);
  items.push(...realItems);

  // Computer Science and Engineering — the 31 real labs of docs/cse_labs.md.
  const araIdByEmail = await loadOrCreateCseAras(prisma, ids.cse);
  const cse = buildCseLabItems(categories, (key) => {
    const id = idByKey.get(key);
    if (!id) throw new Error(`Unknown seeded category key "${key}"`);
    return id;
  }, ids.cse, araIdByEmail);
  items.push(...cse.items);

  await prisma.item.createMany({ data: items.map((i) => itemCreateData(i, categories)) });
  const imageCount = await persistRealImages(items);

  const batchId = newId("b");
  await prisma.itemChange.createMany({
    data: items
      .filter((i) => i.parentId === null)
      .map((item) => ({
        actorId: ids.adminId,
        kind: "createItem" as const,
        targetKind: "ITEM" as const,
        itemId: item.id,
        itemName: item.name,
        categoryId: item.categoryId,
        batchId,
        note: "Development resource seed",
      })),
  });

  const roots = items.filter((i) => i.parentId === null).length;
  console.log(`  ${ALL_CATEGORY_SPECS.length} categories across ${ALL_GROUP_NAMES.length} groups`);
  console.log(`  ${items.length} items (${roots} roots), ${imageCount} real equipment photographs`);
  console.log(`  ${Object.keys(peopleIdByEmail).length} Chemical Engineering lab custodians; ${Object.keys(araIdByEmail).length} CSE lab custodians (ARAs)`);
  console.log(`  Chemical Engineering: 4 named labs with real equipment, 1 expired-chemical store; ASTU Main Store (store keeper)`);
  console.log(`  Computer Science and Engineering: ${cse.summary.length} labs`);
  const pcs = cse.summary.reduce((a, l) => a + l.present, 0);
  const broken = cse.summary.reduce((a, l) => a + l.brokenPcs.length, 0);
  console.log(`    ${pcs} workstations, ${broken} broken PCs, ${cse.summary.reduce((a, l) => a + l.brokenChairs, 0)} broken chairs, ${cse.summary.length * 20} outlets`);
  for (const l of cse.summary) {
    console.log(`    ${l.name.padEnd(38)} ${l.custodian.padEnd(30)} need ${String(l.required).padStart(2)}: ${l.present} PCs, ${l.brokenPcs.length} broken${l.brokenPcs.length ? ` (${l.brokenPcs.map((b) => `${b.workstation.slice(-2)}:${b.cause}`).join(" ")})` : ""}, ${l.brokenChairs} chairs broken, ${l.outlets} outlets`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

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
import { PrismaClient, Prisma } from "@prisma/client";
import { buildSubtree, instantiateMany, newId, type InstantiateCtx } from "../lib/domain/instantiate";
import type { Category, Item as DomainItem } from "../lib/domain/types";
import { toDomainCategoryMap } from "../lib/server/resources/adapt";

const prisma = new PrismaClient();

if (process.env.NODE_ENV === "production") {
  console.error("prisma/resource-seed.ts refuses to run with NODE_ENV=production — this is dev fixture data.");
  process.exit(1);
}

/**
 * Rebuilding categories mints fresh ids every run. `NeedLine.categoryId` is a real FK
 * (onDelete: SetNull), so it survives a rebuild unharmed — but `AccessView.extraFilters`
 * and `ApprovalPolicy.appliesTo` are plain Json blobs that CAN embed a categoryId with no
 * FK behind it, and `ChangeRequest.payload`/`ChainStep.receipt` can too. Once any of those
 * exist, a reset silently orphans whatever they were pointing at. None of Phase 11/12/14
 * (access views / approvals / procurement) has landed yet, so these tables are empty in
 * dev today — this guard is here so that stays true, or the reset stops instead of
 * quietly corrupting real records. See ~/.claude/plans/wait-i-want-gentle-haven.md's note
 * on this exact risk.
 */
async function assertSafeToReset(): Promise<void> {
  const [accessViews, policies, requests, needs] = await Promise.all([
    prisma.accessView.count(),
    prisma.approvalPolicy.count(),
    prisma.changeRequest.count(),
    prisma.needLine.count(),
  ]);
  const found = [
    accessViews && `${accessViews} AccessView row(s)`,
    policies && `${policies} ApprovalPolicy row(s)`,
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

interface FieldSpec {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "ENUM" | "BOOLEAN";
  options?: string[];
  unit?: string;
  summary?: boolean;
}

interface ChildSpec {
  key: string;
  qty: number;
  critical: boolean;
}

interface CategorySpec {
  key: string;
  name: string;
  iconKey: string;
  group: "Places" | "IT" | "Network" | "Furniture" | "Chemical";
  countingMode: "SERIALIZED" | "BULK";
  unit?: string;
  impairRule: "ANY_CRITICAL" | "ALL_CRITICAL" | "NEVER";
  fields?: FieldSpec[];
  defaultChildren?: ChildSpec[];
  /// Placement — see lib/domain/placement.ts. Every spec here defaults to the
  /// schema's own default (canBeRoot: false, placement: ANYWHERE, must live inside
  /// something, may live inside anything) unless named explicitly.
  canBeRoot?: boolean;
  placement?: "ANYWHERE" | "ONLY_LISTED";
}

const CATEGORY_SPECS: CategorySpec[] = [
  {
    key: "lab", name: "Lab", iconKey: "Building2", group: "Places", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    // A root and nothing else — no lab inside a lab, no lab inside anything.
    canBeRoot: true, placement: "ONLY_LISTED",
    fields: [
      { key: "room", label: "Room", type: "TEXT", summary: true },
      { key: "seats", label: "Seats", type: "NUMBER", summary: true },
      { key: "purpose", label: "Purpose", type: "TEXT" },
      { key: "source", label: "Source", type: "TEXT" },
    ],
  },
  {
    key: "store", name: "Store", iconKey: "Warehouse", group: "Places", countingMode: "SERIALIZED", impairRule: "NEVER",
    canBeRoot: true, placement: "ONLY_LISTED",
    fields: [
      { key: "room", label: "Room", type: "TEXT", summary: true },
      { key: "level", label: "Store level", type: "ENUM", options: ["Central", "College sub-store", "Departmental"], summary: true },
    ],
  },
  {
    key: "setup", name: "Workstation Setup", iconKey: "Boxes", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    defaultChildren: [
      { key: "computer", qty: 1, critical: true },
      { key: "table", qty: 1, critical: false },
      { key: "chair", qty: 1, critical: false },
    ],
  },
  {
    key: "computer", name: "Computer", iconKey: "Laptop", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
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
    key: "motherboard", name: "Motherboard", iconKey: "Cpu", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [{ key: "model", label: "Model", type: "TEXT", summary: true }],
    defaultChildren: [
      { key: "ram", qty: 1, critical: true },
      { key: "storage", qty: 1, critical: true },
      { key: "gpu", qty: 1, critical: false },
    ],
  },
  {
    key: "ram", name: "RAM", iconKey: "MemoryStick", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "ddrType", label: "DDR type", type: "ENUM", options: ["DDR3", "DDR4", "DDR5"], summary: true },
      { key: "sizeGB", label: "Size", type: "NUMBER", unit: "GB", summary: true },
    ],
  },
  {
    key: "storage", name: "Storage", iconKey: "HardDrive", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "kind", label: "Kind", type: "ENUM", options: ["SSD", "HDD"], summary: true },
      { key: "sizeGB", label: "Size", type: "NUMBER", unit: "GB", summary: true },
    ],
  },
  {
    key: "gpu", name: "GPU", iconKey: "CircuitBoard", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "model", label: "Model", type: "TEXT", summary: true },
      { key: "memGB", label: "Memory", type: "NUMBER", unit: "GB", summary: true },
    ],
  },
  {
    key: "monitor", name: "Monitor", iconKey: "Monitor", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "brand", label: "Brand", type: "ENUM", options: ["Dell", "HP", "Samsung", "LG"], summary: true },
      { key: "sizeIn", label: "Size", type: "NUMBER", unit: '"', summary: true },
    ],
  },
  { key: "keyboard", name: "Keyboard", iconKey: "Keyboard", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "mouse", name: "Mouse", iconKey: "Mouse", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "speaker", name: "Speaker", iconKey: "Speaker", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  {
    key: "cable", name: "Cable", iconKey: "Cable", group: "IT", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL",
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
  { key: "table", name: "Table", iconKey: "Table2", group: "Furniture", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "chair", name: "Chair", iconKey: "Armchair", group: "Furniture", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  { key: "whiteboard", name: "Whiteboard", iconKey: "Presentation", group: "Furniture", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL" },
  {
    key: "chemical", name: "Chemical", iconKey: "FlaskConical", group: "Chemical", countingMode: "BULK", unit: "ml", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "casNumber", label: "CAS no.", type: "TEXT", summary: true },
      { key: "hazard", label: "Hazard", type: "ENUM", options: ["Corrosive", "Flammable", "Toxic", "Oxidiser", "Irritant", "None"], summary: true },
      { key: "purity", label: "Purity", type: "NUMBER", unit: "%" },
    ],
  },
  {
    key: "glassware", name: "Glassware", iconKey: "Beaker", group: "Chemical", countingMode: "BULK", unit: "pcs", impairRule: "ANY_CRITICAL",
    fields: [
      { key: "type", label: "Type", type: "ENUM", options: ["Beaker", "Flask", "Pipette", "Burette"], summary: true },
      { key: "volumeMl", label: "Volume", type: "NUMBER", unit: "ml", summary: true },
    ],
  },
];

const GROUP_NAMES = ["Places", "IT", "Network", "Furniture", "Chemical"] as const;

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

async function createCategories(): Promise<Record<string, Category>> {
  const groupId = new Map<string, string>();
  for (let i = 0; i < GROUP_NAMES.length; i++) {
    const row = await prisma.categoryGroup.create({ data: { name: GROUP_NAMES[i], sortOrder: i } });
    groupId.set(GROUP_NAMES[i], row.id);
  }

  const idByKey = new Map<string, string>();
  for (const spec of CATEGORY_SPECS) {
    const row = await prisma.resourceCategory.create({
      data: {
        key: spec.key,
        name: spec.name,
        iconKey: spec.iconKey,
        groupId: groupId.get(spec.group)!,
        countingMode: spec.countingMode,
        unit: spec.unit ?? null,
        impairRule: spec.impairRule,
        canBeRoot: spec.canBeRoot ?? false,
        placement: spec.placement ?? "ANYWHERE",
        fields: spec.fields?.length
          ? {
              create: spec.fields.map((f, i) => ({
                key: f.key,
                label: f.label,
                type: f.type,
                options: f.options ?? [],
                unit: f.unit ?? null,
                summary: f.summary ?? false,
                sortOrder: i,
              })),
            }
          : undefined,
      },
    });
    idByKey.set(spec.key, row.id);
  }

  for (const spec of CATEGORY_SPECS) {
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
  return toDomainCategoryMap(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// Items — built with lib/domain/instantiate.ts, the same function the live
// createItem write path calls, then hand-detailed the way temp_works/src/lib/
// seed.ts's own fixture is (realistic props, a handful of seeded status stories so
// derived impairment is visible the moment the register is opened, and one loan).
// ─────────────────────────────────────────────────────────────────────────────

interface SeedIds {
  university: string;
  se: string;
  chem: string;
  adminId: string;
  seCustodianId: string;
  chemCustodianId: string;
}

async function loadSeedIds(): Promise<SeedIds> {
  const [university, se, chem, admin, seCustodian, chemCustodian] = await Promise.all([
    prisma.orgNode.findUnique({ where: { code: "ASTU" } }),
    prisma.orgNode.findUnique({ where: { code: "SE" } }),
    prisma.orgNode.findUnique({ where: { code: "CHEM" } }),
    prisma.user.findUnique({ where: { emailLower: "admin@astu.edu.et" } }),
    prisma.user.findUnique({ where: { emailLower: "custodian.se@astu.edu.et" } }),
    prisma.user.findUnique({ where: { emailLower: "custodian.chem@astu.edu.et" } }),
  ]);
  const missing = [
    !university && "OrgNode(code=ASTU)",
    !se && "OrgNode(code=SE)",
    !chem && "OrgNode(code=CHEM)",
    !admin && "User(admin@astu.edu.et)",
    !seCustodian && "User(custodian.se@astu.edu.et)",
    !chemCustodian && "User(custodian.chem@astu.edu.et)",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`resource-seed.ts needs the org/auth fixture first — missing: ${missing.join(", ")}. Run "npm run prisma:seed" before this script.`);
  }
  return {
    university: university!.id,
    se: se!.id,
    chem: chem!.id,
    adminId: admin!.id,
    seCustodianId: seCustodian!.id,
    chemCustodianId: chemCustodian!.id,
  };
}

function buildItems(categories: Record<string, Category>, ids: SeedIds): DomainItem[] {
  const now = new Date("2026-09-03T09:00:00Z").toISOString();
  const items: DomainItem[] = [];
  const keyToId = new Map<string, string>();
  for (const spec of CATEGORY_SPECS) {
    const found = Object.entries(categories).find(([, c]) => c.name === spec.name && c.group === spec.group);
    if (found) keyToId.set(spec.key, found[0]);
  }
  const catId = (key: string): string => {
    const id = keyToId.get(key);
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

  // ── SE Lab ──────────────────────────────────────────────────────────────
  const seCtx: InstantiateCtx = { ownerOrgNodeId: ids.se, custodianId: ids.seCustodianId, now };
  const lab = add("lab", null, "SE Lab X — Software Lab 3", seCtx);
  lab.props.room = "IT-204";
  lab.props.seats = 7;
  lab.props.purpose = "Software Engineering instruction";
  lab.props.source = "ASTU capital budget 2019";

  const setups = instantiateMany(categories, catId("setup"), lab.id, 7, seCtx, false);
  items.push(...setups);

  const rack = add("switchrack", lab.id, "Switch Rack", seCtx, true);
  add("whiteboard", lab.id, "Whiteboard", seCtx);

  const brands = ["Dell", "HP", "Lenovo"] as const;
  const models: Record<string, string[]> = {
    Dell: ["OptiPlex 7090", "OptiPlex 5000", "Vostro 3710"],
    HP: ["ProDesk 400 G7", "EliteDesk 800 G6"],
    Lenovo: ["ThinkCentre M70q", "ThinkCentre M90t"],
  };

  const setupRoots = setups.filter((s) => s.categoryId === catId("setup"));
  const computers: DomainItem[] = [];
  setupRoots.forEach((setup, idx) => {
    const pc = child(setup.id, "computer");
    if (!pc) return;
    computers.push(pc);
    const brand = brands[idx % brands.length];
    pc.props.brand = brand;
    pc.props.model = models[brand][idx % models[brand].length];
    pc.props.serial = `ASTU-SE-${String(1001 + idx)}`;
    pc.name = `Computer ${String(idx + 1).padStart(2, "0")}`;

    const mb = child(pc.id, "motherboard");
    if (mb) {
      mb.props.model = ["B460M", "H510M", "A520M", "Q470"][idx % 4];
      const ram = child(mb.id, "ram");
      if (ram) {
        ram.props.ddrType = idx % 5 === 0 ? "DDR5" : "DDR4";
        ram.props.sizeGB = [8, 8, 16, 16, 32][idx % 5];
      }
      const st = child(mb.id, "storage");
      if (st) {
        st.props.kind = idx % 3 === 0 ? "HDD" : "SSD";
        st.props.sizeGB = [256, 512, 512, 1024][idx % 4];
      }
      // Only a couple of machines actually have a discrete GPU — the rest have the
      // template's GPU row stripped entirely, the same "remove a nested part that
      // doesn't apply" case temp_works' own seed exercises.
      const gpu = child(mb.id, "gpu");
      if (gpu) {
        if (idx === 0 || idx === 2) {
          gpu.props.model = ["GTX 1650", "RTX 3050"][idx % 2];
          gpu.props.memGB = idx === 0 ? 4 : 6;
        } else {
          const at = items.findIndex((i) => i.id === gpu.id);
          if (at >= 0) items.splice(at, 1);
        }
      }
    }

    const mon = child(pc.id, "monitor");
    if (mon) {
      mon.props.brand = ["Dell", "HP", "Samsung", "LG"][idx % 4];
      mon.props.sizeIn = [19, 21, 21, 24][idx % 4];
    }
    for (const c of childrenOfCat(pc.id, "cable")) {
      c.props.kind = c.name.endsWith("1") ? "Power" : "HDMI";
    }
  });

  childrenOfCat(rack.id, "netswitch").forEach((sw, i) => {
    sw.props.model = "Cisco SG350-28";
    sw.props.ports = 28;
    sw.name = `Network Switch ${i + 1}`;
  });
  childrenOfCat(rack.id, "outlet").forEach((o, i) => {
    o.name = `Outlet ${String(i + 1).padStart(2, "0")}`;
  });

  // ── Seeded stories, so derived impairment is visible the moment the register
  //    opens — one per level of the containment chain, plus a non-critical control.
  const pcOf = (n: number) => child(setupRoots[n - 1].id, "computer")!;

  // 1. Setup 1 stays fully healthy — the control most rows should look like.
  // 2. A cracked monitor — Monitor is CRITICAL, so its Computer and Setup impair.
  const mon2 = child(pcOf(2).id, "monitor");
  if (mon2) mon2.status = "BROKEN";
  // 3. Three levels deep: broken RAM impairs its Motherboard, which impairs the PC,
  //    which impairs the Setup — the multi-level chain lib/domain/status.ts computes.
  const ram3 = child(child(pcOf(3).id, "motherboard")!.id, "ram");
  if (ram3) ram3.status = "BROKEN";
  // 4. A broken MOUSE — NOT critical, so its Computer stays perfectly working. The
  //    control case proving ANY_CRITICAL is actually discriminating, not blanket.
  const mouse4 = child(pcOf(4).id, "mouse");
  if (mouse4) mouse4.status = "BROKEN";
  // 5. A machine with its own stored status set directly (not derived).
  pcOf(5).status = "UNDER_MAINTENANCE";
  // 6 & 7 stay healthy.
  // One switch down → rack impaired → the whole Lab impaired — the seed's own
  // authoritative "Lab is ANY_CRITICAL with a critical switch rack" story (see
  // PROGRESS.md's replatforming-Phase-3 note on the sandbox README's superseded claim).
  const sw1 = childrenOfCat(rack.id, "netswitch")[0];
  if (sw1) sw1.status = "BROKEN";

  // ── ASTU Main Store — university-owned stock, outside either department, for
  //    testing SYS_ADMIN-only (university-wide) visibility. ────────────────────
  const mainStore = add("store", null, "ASTU Main Store", { ownerOrgNodeId: ids.university, custodianId: ids.adminId, now });
  mainStore.props.room = "Central stores building";
  mainStore.props.level = "Central";
  const stockCtx: InstantiateCtx = { ownerOrgNodeId: ids.university, custodianId: ids.adminId, now };
  instantiateMany(categories, catId("table"), mainStore.id, 3, stockCtx).forEach((i) => items.push(i));
  instantiateMany(categories, catId("chair"), mainStore.id, 3, stockCtx).forEach((i) => items.push(i));

  // ── Chemical Engineering ────────────────────────────────────────────────
  const chemCtx: InstantiateCtx = { ownerOrgNodeId: ids.chem, custodianId: ids.chemCustodianId, now };
  const chemLab = add("lab", null, "Mechanical Unit Operations Laboratory", chemCtx);
  chemLab.props.room = "C-105";
  chemLab.props.seats = 20;
  chemLab.props.purpose = "Unit operations practicals";
  add("table", chemLab.id, "Table", chemCtx);
  add("chair", chemLab.id, "Chair", chemCtx);

  const store = add("store", null, "Chemistry Store — Room C-12", chemCtx);
  store.props.room = "C-12";
  store.props.level = "Departmental";

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

  // ── The borrowing case — SE's 7th workstation sits physically in Chemical
  //    Engineering's lab. `currentOrgNodeId` says so for the whole subtree; SE still
  //    owns it and Girma Wolde (SE's custodian) is still answerable for it. Position
  //    moved, accountability did not — the case the owner/current split exists for. ──
  const loanedSetup = setupRoots[6];
  const childrenOf = new Map<string, DomainItem[]>();
  for (const it of items) {
    if (!it.parentId) continue;
    const list = childrenOf.get(it.parentId);
    if (list) list.push(it);
    else childrenOf.set(it.parentId, [it]);
  }
  loanedSetup.parentId = chemLab.id;
  const stack = [loanedSetup];
  while (stack.length) {
    const it = stack.pop()!;
    it.currentOrgNodeId = ids.chem;
    stack.push(...(childrenOf.get(it.id) ?? []));
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

async function main(): Promise<void> {
  console.log("Seeding lab_resource_v2's resource module (dev fixture)…");

  const ids = await loadSeedIds();
  await assertSafeToReset();
  await wipe();

  const categories = await createCategories();
  const items = buildItems(categories, ids);

  await prisma.item.createMany({ data: items.map((i) => itemCreateData(i, categories)) });

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
  console.log(`  ${CATEGORY_SPECS.length} categories across ${GROUP_NAMES.length} groups`);
  console.log(`  ${items.length} items (${roots} roots: SE Lab, ASTU Main Store, Chemistry lab, Chemistry store)`);
  console.log(`  1 loan: SE's 7th workstation sits in Chemistry Engineering's lab, owned/custodied by SE`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

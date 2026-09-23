/**
 * The parts of the register that are real — ported from
 * D:/py_yaddessa/temp_works/src/lib/real-data-seed.ts, mapped onto THIS app's real
 * seeded org nodes (`se`/`chem`, from prisma/seed.ts) rather than temp_works' own
 * mock OrgNode ids, and onto real, login-capable User rows instead of temp_works'
 * in-memory Person fixtures.
 *
 * People, rooms, equipment, conditions and photographs here come from three
 * documents the departments produced themselves (temp_works' `real_data/`,
 * git-ignored there and never copied here — only their extracted content is):
 *
 *   · (formerly the Software Engineering electricity/network survey — its rooms are now
 *     CSE's real labs, seeded from docs/cse_labs.md by prisma/cse-lab-data.ts)
 *   · the Chemical Engineering laboratory equipment list (DOCX) — extracted
 *     mechanically into prisma/chem-lab-data.ts, ported verbatim; see that file's
 *     own header
 *   · the Chemical Engineering expired chemicals list (DOCX)
 *
 * Everything in this file that is not from those documents is the small amount of
 * structure needed to hang them on: which category each machine belongs to, which
 * room each lab is, and the org/auth rows real people need to sign in and be
 * custodians. Called from resource-seed.ts's `main()` — this module only builds
 * pure data (category specs, domain items) and, for people, does its own
 * idempotent upsert (find-or-create by email) since a User is not wiped by
 * resource-seed.ts's own reset and must survive being called more than once.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { buildSubtree, type InstantiateCtx } from "../lib/domain/instantiate";
import type { Category, Item as DomainItem } from "../lib/domain/types";
import { CHEM_EQUIPMENT_RECORDS } from "./chem-lab-data";
import type { CategorySpec } from "./resource-seed";

const DEMO_PASSWORD = "astu1234";

interface RealPersonSpec {
  email: string;
  name: string;
  homeNode: "chem";
  title: string;
}

/** The 3 Chemical Engineering lab responsibles — the exact names, emails and titles
 *  the department's equipment-list submission carried. (The Software Engineering survey
 *  people are now CSE's lab custodians — prisma/cse-lab-data.ts, 2026-09-22.) */
const REAL_PEOPLE: RealPersonSpec[] = [
  { email: "amsaluaddisu@gmail.com", name: "Addisu Amsalu", homeNode: "chem", title: "Laboratory responsible person" },
  { email: "altewba@gmail.com", name: "Seid Hassen", homeNode: "chem", title: "Laboratory responsible person" },
  { email: "ebogizaw21@gmail.com", name: "Ebisa Gizachew", homeNode: "chem", title: "Laboratory responsible person" },
];

/** Find-or-create by email — real people survive a `resource-seed.ts` re-run that
 *  does not also re-run `prisma:seed` (which is the whole point of splitting item
 *  wipe from org/auth wipe). A second run must not try to INSERT the same email
 *  again and fail the unique constraint. */
export async function loadOrCreateRealPeople(prisma: PrismaClient, nodeIdByKey: { chem: string }): Promise<Record<string, string>> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const idByEmail: Record<string, string> = {};
  for (const p of REAL_PEOPLE) {
    const emailLower = p.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { emailLower } });
    if (existing) {
      idByEmail[p.email] = existing.id;
      continue;
    }
    const created = await prisma.user.create({
      data: {
        email: p.email,
        emailLower,
        name: p.name,
        title: p.title,
        passwordHash,
        status: "ACTIVE",
        homeNodeId: nodeIdByKey[p.homeNode],
        roles: { create: [{ kind: "CUSTODIAN" }, { kind: "STAFF" }] },
      },
    });
    idByEmail[p.email] = created.id;
  }
  return idByEmail;
}

// ─────────────────────────────────────────────────────────────────────────────
// Categories — the Chemical Engineering department's own real equipment
// classification, plus the expired-chemical container inventory. The one
// hand-made judgement (which category each machine belongs to) lives in
// CATEGORY_BY_EQUIPMENT below, keyed by the exact extracted name so a changed
// name in chem-lab-data.ts fails loudly here rather than silently filing a
// machine under the wrong heading.
// ─────────────────────────────────────────────────────────────────────────────

/** Every piece of process equipment carries these four facts, straight from the
 *  department's own equipment register. */
const processFields: CategorySpec["fields"] = [
  { key: "model", label: "Model / designation", type: "TEXT", summary: true },
  { key: "description", label: "Description", type: "TEXT" },
  { key: "experiments", label: "Experiments / teaching use", type: "TEXT" },
  { key: "sourceCondition", label: "Source condition", type: "ENUM", options: ["Functional", "Partially Functional", "Semi Functional"], summary: true },
];

export const REAL_GROUP_NAMES = ["Mechanical Unit Operations", "Reaction & Biochemical Engineering", "Process Control & Fluid Mechanics", "Heat & Mass Transfer"] as const;

export const REAL_CATEGORY_SPECS: CategorySpec[] = [
  { key: "fluidized-bed-apparatus", name: "Fixed / Fluidized Bed Apparatus", iconKey: "Layers3", group: "Mechanical Unit Operations", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "mixing-apparatus", name: "Mixing Apparatus", iconKey: "RefreshCw", group: "Mechanical Unit Operations", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "size-reduction-equipment", name: "Size Reduction Equipment", iconKey: "Cog", group: "Mechanical Unit Operations", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "solids-handling-module", name: "Solids Handling Module", iconKey: "Boxes", group: "Mechanical Unit Operations", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "filtration-apparatus", name: "Filtration Apparatus", iconKey: "Container", group: "Mechanical Unit Operations", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "sedimentation-apparatus", name: "Sedimentation Apparatus", iconKey: "Beaker", group: "Mechanical Unit Operations", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "reactor-training-unit", name: "Reactor Training Unit", iconKey: "Gauge", group: "Reaction & Biochemical Engineering", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "chromatography-unit", name: "Chromatography Unit", iconKey: "SlidersHorizontal", group: "Reaction & Biochemical Engineering", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "process-control-trainer", name: "Process Control Trainer", iconKey: "Gauge", group: "Process Control & Fluid Mechanics", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "fluid-mechanics-trainer", name: "Fluid Mechanics Trainer", iconKey: "Waves", group: "Process Control & Fluid Mechanics", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "heat-exchanger", name: "Heat Exchanger", iconKey: "Thermometer", group: "Heat & Mass Transfer", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "distillation-evaporation-unit", name: "Distillation / Evaporation Unit", iconKey: "Factory", group: "Heat & Mass Transfer", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "extraction-unit", name: "Extraction Unit", iconKey: "FlaskConical", group: "Heat & Mass Transfer", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "absorption-adsorption-unit", name: "Absorption / Adsorption Unit", iconKey: "Droplets", group: "Heat & Mass Transfer", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "crystallization-unit", name: "Crystallization Unit", iconKey: "Gem", group: "Heat & Mass Transfer", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "diffusion-apparatus", name: "Diffusion Apparatus", iconKey: "ArrowLeftRight", group: "Heat & Mass Transfer", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "drying-unit", name: "Drying Unit", iconKey: "Thermometer", group: "Heat & Mass Transfer", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  { key: "ion-exchange-unit", name: "Ion Exchange Unit", iconKey: "RefreshCw", group: "Heat & Mass Transfer", countingMode: "SERIALIZED", impairRule: "ANY_CRITICAL", fields: processFields },
  {
    key: "expired-chemical-container",
    name: "Chemical Container (Expired Inventory)",
    iconKey: "TestTubes",
    group: "Chemical",
    countingMode: "BULK",
    unit: "containers",
    impairRule: "ANY_CRITICAL",
    fields: [
      { key: "physicalState", label: "Physical state", type: "ENUM", options: ["Solid", "Liquid", "Gas", "Unknown"], summary: true },
      { key: "expiry", label: "Expiry (source)", type: "TEXT", summary: true },
      { key: "inventoryState", label: "Inventory state", type: "ENUM", options: ["Active", "Expired", "Quarantined", "Disposed"], summary: true },
      { key: "source", label: "Source", type: "TEXT" },
    ],
  },
];

interface ChemLabSpec {
  name: string;
  room: string;
  email: string;
  purpose: string;
}

const CHEM_LABS: ChemLabSpec[] = [
  { name: "Mechanical Unit Operation Laboratory", room: "B528-RG16", email: "amsaluaddisu@gmail.com", purpose: "Demonstration and training for mechanical unit operations and environmental engineering." },
  { name: "Chemical Reaction and Biochemical Engineering Laboratory", room: "B528-RG1-15", email: "altewba@gmail.com", purpose: "Demonstration and training for chemical reaction and biochemical engineering." },
  { name: "Process Control and Fluid Mechanics Laboratory", room: "B528-RG5", email: "amsaluaddisu@gmail.com", purpose: "Training for process dynamics and control, process instrumentation and fluid mechanics." },
  { name: "Heat and Mass Transfer Laboratory", room: "B528-RG7", email: "ebogizaw21@gmail.com", purpose: "Training for heat transfer, mass transfer and thermal unit operations." },
];

/** The source document's "Lab Category:" wording, mapped to a lab. The department
 *  writes it slightly differently in each section ("Heat and Mass Transfer laboratory",
 *  "Mechanical Unit Operation"), so this matches on a lowercased prefix rather than
 *  exact text. */
const LAB_BY_CATEGORY_PREFIX: Array<[prefix: string, labName: string]> = [
  ["mechanical unit operation", "Mechanical Unit Operation Laboratory"],
  ["chemical reaction", "Chemical Reaction and Biochemical Engineering Laboratory"],
  ["process control", "Process Control and Fluid Mechanics Laboratory"],
  ["heat and mass transfer", "Heat and Mass Transfer Laboratory"],
];

/** Which category each machine is an instance of — see this file's own header on
 *  why this is a hand-made judgement keyed by exact name. */
const CATEGORY_BY_EQUIPMENT: Record<string, string> = {
  "CEL-MKII Fixed and Fluidized Bed Apparatus": "fluidized-bed-apparatus",
  "CEK MKII - Fluid Mixing Apparatus": "mixing-apparatus",
  "Jaw Crusher": "size-reduction-equipment",
  "FT28 Oil Extraction Screw Press": "size-reduction-equipment",
  "Solids Handling Studies Module - CEN-MKII": "solids-handling-module",
  "UOP-12 Filtration Apparatus": "filtration-apparatus",
  "W7 MKII Model Sedimentation Tank": "sedimentation-apparatus",
  "Reactors Common Service Unit": "reactor-training-unit",
  "CEB Batch Reactor": "reactor-training-unit",
  "CEB CSTR reactor": "reactor-training-unit",
  "CET-MKII Tubular reactor": "reactor-training-unit",
  "CEP-MKII - Stirred Tank Reactors in Series": "reactor-training-unit",
  "CEU - Catalytic Reactors": "reactor-training-unit",
  "BE1 Batch Enzyme Reactor": "reactor-training-unit",
  "BE2 Chromatography Unit": "chromatography-unit",
  "PCT40 Process Control Apparatus": "process-control-trainer",
  "PCT23MKII - Process Plant Trainer": "process-control-trainer",
  "FM6X - Turbine Service Unit": "fluid-mechanics-trainer",
  "HT37E - Extended Plate Heat Exchanger": "heat-exchanger",
  "HT37X - Extended Plate Heat Exchanger": "heat-exchanger",
  "HT-34 Jacketed Vessel With Coil & Stirrer": "heat-exchanger",
  "CH-10.5 Laboratory Distillation Pilot Plant": "distillation-evaporation-unit",
  "CE 715 Rising Film Evaporation": "distillation-evaporation-unit",
  "CH-16.1 Liquid-Liquid Extraction Unit": "extraction-unit",
  "Liquid-Gas absorption": "absorption-adsorption-unit",
  "UOP14-Crystalization Unit": "crystallization-unit",
  "CERa-MKII - Gaseous Diffusion Coefficient Apparatus": "diffusion-apparatus",
  "CERb - Liquid Diffusion Coefficient Apparatus": "diffusion-apparatus",
  "CH-17 Solid Liquid Extraction Unit": "extraction-unit",
  "UOP15 Fixed Bed Adsorption Unit": "absorption-adsorption-unit",
  "CES - Wetted Wall Gas Absorption Column": "absorption-adsorption-unit",
  "CH-70 Tray Dryer Training Unit": "drying-unit",
  "CH-21 Ion Exchanger Unit": "ion-exchange-unit",
};

type ExpiredChemical = [name: string, state: string, expiry: string, containers: number];
const EXPIRED_CHEMICALS: ExpiredChemical[] = [
  ["Potassium chromate", "Solid", "2024", 1], ["Magnesium chloride", "Solid", "2020", 1], ["Sodium carboxymethyl cellulose", "Solid", "2024", 1],
  ["Eriochrome Black T", "Solid", "2024", 3], ["EDTA", "Solid", "2022", 1], ["Universal indicator", "Liquid", "2023", 2],
  ["Sodium hydroxide", "Liquid", "2022", 1], ["Glycerol", "Liquid", "2025", 2], ["Nickel (II) oxide", "Solid", "2022", 1],
  ["Phenolphthalein", "Liquid", "2024", 1], ["Sodium bicarbonate", "Solid", "2021/24", 2], ["Citric acid", "Solid", "2024", 1],
  ["Potassium dichromate", "Solid", "2022/24", 2], ["Potassium ferricyanide", "Solid", "2023", 1], ["Calcium chloride", "Solid", "21/26", 3],
  ["Graphite powder", "Solid", "2025", 2], ["Ferroin solution", "Liquid", "2022", 1], ["Sodium thiosulphite", "Solid", "2021", 1],
  ["Aluminium oxide", "Solid", "2024", 1], ["Ammonium chloride", "Solid", "21/23/24", 3], ["Sodium dichromate", "Solid", "2020", 1],
  ["Potassium carbonate anhydrous", "Solid", "2021", 2], ["Sodium sulphite", "Solid", "2022", 1], ["Methyl blue", "Liquid", "2022", 1],
  ["Potassium nitrate", "Solid", "2024", 2], ["Potassium chloride", "Solid", "2023/2024", 2], ["Sodium dihydrogen phosphate", "Solid", "2022", 2],
  ["Potassium iodide", "Solid", "2024", 3], ["Potassium dihydrogen phosphate", "Solid", "2021", 1], ["Manganese sulphate monohydrate", "Solid", "2021", 2],
  ["Starch soluble", "Solid", "2021", 1], ["Sodium thiosulphate pentahydrate", "Solid", "2024", 1], ["Ammonium ferrous sulphate", "Solid", "2022", 3],
  ["Magnesium sulfate pentahydrate", "Solid", "2021", 1], ["Sodium fluoride", "Solid", "2022", 2], ["Silica gel self-indicating blue", "Solid", "22/23", 2],
  ["Paraffin wax pellet", "Solid", "-", 1], ["Aluminium sulfate", "Solid", "2020", 2], ["Calcium carbonate", "Solid", "2021", 1],
  ["Cupric nitrate", "Solid", "2021", 1], ["Aluminium powder", "Solid", "2023", 1], ["Castor oil", "Liquid", "2024", 1],
  ["Lactic acid", "Liquid", "2025", 5], ["2-methyl tetrahydrofuran", "Liquid", "2022", 1], ["Ethyl acetate", "Liquid", "2026", 1],
  ["N,N-dimethylformamide", "Unknown", "2024", 1], ["Petroleum ether", "Liquid", "2020", 1], ["Acacia powder", "Solid", "2024", 1],
  ["Oxalic acid", "Liquid", "2023", 1], ["Zinc nitrate", "Solid", "2025", 1], ["Absolute ethanol", "Liquid", "2024", 1],
];

/** The leading model designation, when the name actually starts with one:
 *  "CEL-MKII" out of "CEL-MKII Fixed and Fluidized Bed Apparatus", "CH-16.1",
 *  "CERa-MKII", "CE 715". Every token must end on a word boundary, which is what
 *  stops "Jaw Crusher" from yielding a model of "J" and "Reactors Common Service
 *  Unit" from yielding "R C S U". A machine whose name carries no designation gets
 *  no model — an invented one is worse than a blank. */
const DESIGNATION = /^[A-Z0-9]+[a-z]?(?=[-. ]|$)(?:[-. ][A-Z0-9]+(?=[-. ]|$))*/;

function modelOf(name: string): string | undefined {
  const match = name.match(DESIGNATION)?.[0]?.trim();
  return match && match.length > 1 ? match : undefined;
}

function labFor(labCategory: string): string | undefined {
  const lower = labCategory.toLowerCase();
  return LAB_BY_CATEGORY_PREFIX.find(([prefix]) => lower.startsWith(prefix))?.[1];
}

export interface RealDataIds {
  chem: string;
  peopleIdByEmail: Record<string, string>;
}

/** Builds the real domain items — labs, equipment, the expired-chemical store — the
 *  same way resource-seed.ts's own `buildItems()` does, via `buildSubtree`. An
 *  equipment item's source photographs are carried on the domain `Item.images` field
 *  (`{id, src, caption}`, `src` a bare filename resolved against
 *  prisma/seed-assets/equipment/) purely as a handoff — resource-seed.ts's `main()`
 *  is what actually reads those files, sniffs them, writes them to storage and
 *  inserts the real `ItemImage` rows, after `items` is persisted. */
export function buildRealDataItems(categories: Record<string, Category>, ids: RealDataIds, categoryIdByKey: Map<string, string>): DomainItem[] {
  const now = new Date("2026-08-27T09:00:00Z").toISOString();
  const items: DomainItem[] = [];
  const catId = (key: string): string => {
    const id = categoryIdByKey.get(key);
    if (!id) throw new Error(`real-data-seed.ts: unknown category key "${key}"`);
    return id;
  };
  const add = (key: string, parentId: string | null, name: string, ctx: InstantiateCtx): DomainItem => {
    const made = buildSubtree(categories, catId(key), parentId, name, false, ctx);
    items.push(...made);
    return made[0];
  };
  const ctxFor = (email: string, _node: "chem"): InstantiateCtx => ({
    ownerOrgNodeId: ids.chem,
    custodianId: ids.peopleIdByEmail[email],
    now,
  });

  // ── Chemical Engineering — 4 named labs, populated with the department's real
  //    equipment register (names, descriptions, experiments, conditions, photos) ──
  const labByName = new Map<string, DomainItem>();
  for (const s of CHEM_LABS) {
    const lab = add("lab", null, s.name, ctxFor(s.email, "chem"));
    lab.props.room = s.room;
    lab.props.purpose = s.purpose;
    lab.props.source = "Laboratory list for chem.docx";
    labByName.set(s.name, lab);
  }

  for (const record of CHEM_EQUIPMENT_RECORDS) {
    const labName = labFor(record.labCategory);
    const lab = labName ? labByName.get(labName) : undefined;
    const categoryKey = CATEGORY_BY_EQUIPMENT[record.name];
    if (!lab || !categoryKey) continue;

    const labEmail = CHEM_LABS.find((l) => l.name === labName)!.email;
    const it = add(categoryKey, lab.id, record.name, ctxFor(labEmail, "chem"));
    const model = modelOf(record.name);
    if (model) it.props.model = model;
    if (record.description) it.props.description = record.description;
    if (record.experiments) it.props.experiments = record.experiments;
    it.props.sourceCondition = record.status;
    // The department's own words. "Functional" is working; anything else is a
    // machine that needs attention, which is what the register is for.
    if (record.status !== "Functional") it.status = "UNDER_MAINTENANCE";
    it.images = record.images.map((src, index) => ({
      id: `${it.id}-img${index + 1}`,
      src,
      caption: record.images.length > 1 ? `${record.name} (${index + 1})` : record.name,
    }));
  }

  // ── Expired Chemical Store — the department's own disposal-pending inventory ────
  const storeCtx = ctxFor("amsaluaddisu@gmail.com", "chem");
  const store = add("store", null, "Chemical Engineering — Expired Chemical Store", storeCtx);
  store.props.room = "Location not stated in source";
  for (const [name, physicalState, expiry, containers] of EXPIRED_CHEMICALS) {
    const it = add("expired-chemical-container", store.id, name, storeCtx);
    it.qty = containers;
    it.props.physicalState = physicalState;
    it.props.expiry = expiry;
    it.props.inventoryState = "Expired";
    it.props.source = "Expired chemicals list.docx";
    it.status = "UNDER_MAINTENANCE";
  }

  return items;
}

/**
 * Shared test fixture for lib/domain/**'s pure-logic specs — ported from
 * temp_works/src/lib/seed.ts's ORG_NODES/PEOPLE/SEED_CATEGORIES, essentially verbatim,
 * minus the `...REAL_PEOPLE`/`...REAL_CATEGORIES` spreads (real ASTU import data, not
 * test fixture material — that lands in a later phase's importer, not here).
 *
 * TEST-ONLY. Never imported from lib/server/** or components/** — production data
 * comes from Postgres via prisma/seed.ts or the real-data importer, not this file.
 */
import type { Category, OrgNode, Person } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// The organisation. A layered DAG: university at level 0, colleges and offices at
// level 1, departments at level 2, edges only between adjacent levels — that
// adjacency IS the approval route. The two offices hang off the university BESIDE
// the colleges, so they are never ancestors of any department and never appear on a
// hierarchy walk; a chain that needs Procurement names it explicitly.
// ─────────────────────────────────────────────────────────────────────────────

export const ORG_NODES: OrgNode[] = [
  { id: "astu", name: "Adama Science and Technology University", kind: "UNIVERSITY", level: 0, parentIds: [], occupantId: "p-avp", active: true },

  { id: "coeec", name: "College of Electrical Engineering and Computing", kind: "COLLEGE", level: 1, parentIds: ["astu"], occupantId: "p-dean-coeec", active: true },
  { id: "comcme", name: "College of Mechanical, Chemical and Materials Engineering", kind: "COLLEGE", level: 1, parentIds: ["astu"], occupantId: "p-dean-comcme", active: true },
  { id: "coace", name: "College of Architecture and Civil Engineering", kind: "COLLEGE", level: 1, parentIds: ["astu"], occupantId: "p-dean-coace", active: true },

  { id: "property-office", name: "Property Administration Office", kind: "OFFICE", level: 1, parentIds: ["astu"], occupantId: "p-property", active: true },
  { id: "proc-office", name: "Procurement Office", kind: "OFFICE", level: 1, parentIds: ["astu"], occupantId: "p-procurement", active: true },
  { id: "cmd-office", name: "College Managing Directorate", kind: "OFFICE", level: 1, parentIds: ["astu"], occupantId: "p-cmd", active: true },

  { id: "se", name: "Software Engineering", kind: "DEPARTMENT", level: 2, parentIds: ["coeec"], occupantId: "p-head-se", active: true },
  { id: "chem", name: "Chemical Engineering", kind: "DEPARTMENT", level: 2, parentIds: ["comcme"], occupantId: "p-head-chem", active: true },
  { id: "mech", name: "Mechanical Engineering", kind: "DEPARTMENT", level: 2, parentIds: ["comcme"], occupantId: "p-head-mech", active: true },
  { id: "civil", name: "Civil Engineering", kind: "DEPARTMENT", level: 2, parentIds: ["coace"], occupantId: "p-head-civil", active: true },
];

export const PEOPLE: Person[] = [
  { id: "p-admin", name: "System Administrator", homeOrgNodeId: "astu", roles: ["SYS_ADMIN"], title: "Administrator" },
  { id: "p-avp", name: "Academic Vice President", homeOrgNodeId: "astu", roles: ["MANAGER", "STAFF"], title: "Academic Vice President" },

  { id: "p-dean-coeec", name: "Dean, Electrical Engineering and Computing", homeOrgNodeId: "coeec", roles: ["MANAGER", "STAFF"], title: "College Dean" },
  { id: "p-dean-comcme", name: "Dean, Mechanical, Chemical and Materials Engineering", homeOrgNodeId: "comcme", roles: ["MANAGER", "STAFF"], title: "College Dean" },
  { id: "p-dean-coace", name: "Dean, Architecture and Civil Engineering", homeOrgNodeId: "coace", roles: ["MANAGER", "STAFF"], title: "College Dean" },

  { id: "p-property", name: "Property Administration Officer", homeOrgNodeId: "property-office", roles: ["PROPERTY_ADMIN", "STAFF"], title: "Property administration" },
  { id: "p-procurement", name: "Procurement Officer", homeOrgNodeId: "proc-office", roles: ["PROCUREMENT", "STAFF"], title: "Procurement office" },
  { id: "p-cmd", name: "College Managing Director", homeOrgNodeId: "cmd-office", roles: ["MANAGER", "STAFF"], title: "College Managing Director" },
  { id: "p-store", name: "Main Store Keeper", homeOrgNodeId: "property-office", roles: ["STORE_KEEPER", "STAFF"], title: "Main store" },

  { id: "p-head-se", name: "Head, Software Engineering", homeOrgNodeId: "se", roles: ["MANAGER", "STAFF"], title: "Department Head" },
  { id: "p-head-chem", name: "Head, Chemical Engineering", homeOrgNodeId: "chem", roles: ["MANAGER", "STAFF"], title: "Department Head" },
  { id: "p-head-mech", name: "Head, Mechanical Engineering", homeOrgNodeId: "mech", roles: ["MANAGER", "STAFF"], title: "Department Head" },
  { id: "p-head-civil", name: "Head, Civil Engineering", homeOrgNodeId: "civil", roles: ["MANAGER", "STAFF"], title: "Department Head" },

  { id: "u1", name: "Girma Wolde", homeOrgNodeId: "se", roles: ["CUSTODIAN", "STAFF"], title: "Laboratory responsible" },
  { id: "u2", name: "Meron Assefa", homeOrgNodeId: "se", roles: ["STAFF"], title: "Instructor" },
  { id: "u3", name: "Hanna Bekele", homeOrgNodeId: "chem", roles: ["CUSTODIAN", "STAFF"], title: "Laboratory responsible" },
  { id: "u4", name: "Dawit Tesfaye", homeOrgNodeId: "civil", roles: ["CUSTODIAN", "STAFF"], title: "Laboratory responsible" },
  { id: "u5", name: "Sara Yohannes", homeOrgNodeId: "mech", roles: ["CUSTODIAN", "STAFF"], title: "Laboratory responsible" },
  { id: "u6", name: "Abel Kebede", homeOrgNodeId: "se", roles: ["CUSTODIAN", "STAFF"], title: "Technician" },
  { id: "u7", name: "Kalkidan Tesfaye", homeOrgNodeId: "se", roles: ["STUDENT"], title: "Student" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Categories — the "defined metrics" layer. Each carries its own fields AND its own
// default subtree, so instantiating it scaffolds everything underneath.
// ─────────────────────────────────────────────────────────────────────────────

function cat(c: Partial<Category> & Pick<Category, "id" | "name" | "iconKey" | "group">): Category {
  return {
    countingMode: "SERIALIZED",
    fields: [],
    defaultChildren: [],
    impairRule: "ANY_CRITICAL",
    version: 0,
    ...c,
  };
}

export const SEED_CATEGORIES: Category[] = [
  cat({
    id: "lab",
    name: "Lab",
    iconKey: "Building2",
    group: "Places",
    fields: [
      { key: "room", label: "Room", type: "text", summary: true },
      { key: "seats", label: "Seats", type: "number", summary: true },
      { key: "purpose", label: "Purpose", type: "text" },
      { key: "source", label: "Source", type: "text" },
    ],
  }),
  cat({
    id: "store",
    name: "Store",
    iconKey: "Warehouse",
    group: "Places",
    fields: [
      { key: "room", label: "Room", type: "text", summary: true },
      { key: "level", label: "Store level", type: "enum", options: ["Central", "College sub-store", "Departmental"], summary: true },
    ],
    impairRule: "NEVER",
  }),

  cat({
    id: "setup",
    name: "Workstation Setup",
    iconKey: "Boxes",
    group: "IT",
    defaultChildren: [
      { categoryId: "computer", qty: 1, critical: true },
      { categoryId: "table", qty: 1, critical: false },
      { categoryId: "chair", qty: 1, critical: false },
    ],
  }),
  cat({
    id: "computer",
    name: "Computer",
    iconKey: "Laptop",
    group: "IT",
    fields: [
      { key: "brand", label: "Brand", type: "enum", options: ["Dell", "HP", "Lenovo", "Custom build"], summary: true },
      { key: "model", label: "Model", type: "text", summary: true },
      { key: "serial", label: "Serial no.", type: "text" },
      { key: "type", label: "Type", type: "enum", options: ["Desktop", "Laptop"], summary: true },
    ],
    defaultChildren: [
      { categoryId: "motherboard", qty: 1, critical: true },
      { categoryId: "monitor", qty: 1, critical: true },
      { categoryId: "keyboard", qty: 1, critical: false },
      { categoryId: "mouse", qty: 1, critical: false },
      { categoryId: "speaker", qty: 2, critical: false },
      { categoryId: "cable", qty: 2, critical: false },
    ],
  }),
  cat({
    id: "motherboard",
    name: "Motherboard",
    iconKey: "Cpu",
    group: "IT",
    fields: [{ key: "model", label: "Model", type: "text", summary: true }],
    defaultChildren: [
      { categoryId: "ram", qty: 1, critical: true },
      { categoryId: "storage", qty: 1, critical: true },
      { categoryId: "gpu", qty: 1, critical: false },
    ],
  }),
  cat({
    id: "ram",
    name: "RAM",
    iconKey: "MemoryStick",
    group: "IT",
    fields: [
      { key: "ddrType", label: "DDR type", type: "enum", options: ["DDR3", "DDR4", "DDR5"], summary: true },
      { key: "sizeGB", label: "Size", type: "number", unit: "GB", summary: true },
    ],
  }),
  cat({
    id: "storage",
    name: "Storage",
    iconKey: "HardDrive",
    group: "IT",
    fields: [
      { key: "kind", label: "Kind", type: "enum", options: ["SSD", "HDD"], summary: true },
      { key: "sizeGB", label: "Size", type: "number", unit: "GB", summary: true },
    ],
  }),
  cat({
    id: "gpu",
    name: "GPU",
    iconKey: "CircuitBoard",
    group: "IT",
    fields: [
      { key: "model", label: "Model", type: "text", summary: true },
      { key: "memGB", label: "Memory", type: "number", unit: "GB", summary: true },
    ],
  }),
  cat({
    id: "monitor",
    name: "Monitor",
    iconKey: "Monitor",
    group: "IT",
    fields: [
      { key: "brand", label: "Brand", type: "enum", options: ["Dell", "HP", "Samsung", "LG"], summary: true },
      { key: "sizeIn", label: "Size", type: "number", unit: '"', summary: true },
    ],
  }),
  cat({ id: "keyboard", name: "Keyboard", iconKey: "Keyboard", group: "IT" }),
  cat({ id: "mouse", name: "Mouse", iconKey: "Mouse", group: "IT" }),
  cat({ id: "speaker", name: "Speaker", iconKey: "Speaker", group: "IT" }),
  cat({
    id: "cable",
    name: "Cable",
    iconKey: "Cable",
    group: "IT",
    fields: [{ key: "kind", label: "Kind", type: "enum", options: ["Power", "HDMI", "VGA", "Ethernet"], summary: true }],
  }),

  cat({
    id: "switchrack",
    name: "Switch Rack",
    iconKey: "Server",
    group: "Network",
    defaultChildren: [
      { categoryId: "netswitch", qty: 2, critical: true },
      { categoryId: "outlet", qty: 30, critical: false },
    ],
  }),
  cat({
    id: "netswitch",
    name: "Network Switch",
    iconKey: "Network",
    group: "Network",
    fields: [
      { key: "model", label: "Model", type: "text", summary: true },
      { key: "ports", label: "Ports", type: "number", summary: true },
    ],
  }),
  cat({ id: "outlet", name: "Network Outlet", iconKey: "Link2", group: "Network" }),

  cat({ id: "table", name: "Table", iconKey: "Table2", group: "Furniture" }),
  cat({ id: "chair", name: "Chair", iconKey: "Armchair", group: "Furniture" }),
  cat({ id: "whiteboard", name: "Whiteboard", iconKey: "Presentation", group: "Furniture" }),

  cat({
    id: "chemical",
    name: "Chemical",
    iconKey: "FlaskConical",
    group: "Chemical",
    countingMode: "BULK",
    unit: "ml",
    fields: [
      { key: "casNumber", label: "CAS no.", type: "text", summary: true },
      { key: "hazard", label: "Hazard", type: "enum", options: ["Corrosive", "Flammable", "Toxic", "Oxidiser", "Irritant", "None"], summary: true },
      { key: "purity", label: "Purity", type: "number", unit: "%" },
    ],
  }),
  cat({
    id: "glassware",
    name: "Glassware",
    iconKey: "Beaker",
    group: "Chemical",
    countingMode: "BULK",
    unit: "pcs",
    fields: [
      { key: "type", label: "Type", type: "enum", options: ["Beaker", "Flask", "Pipette", "Burette"], summary: true },
      { key: "volumeMl", label: "Volume", type: "number", unit: "ml", summary: true },
    ],
  }),
];

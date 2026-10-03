/**
 * Dev playground only (2026-10-03), idempotent: puts instruments that need calibration
 * into two Chemical Engineering labs, with "Last calibrated" dates spread so every
 * calibration status shows (in date, due soon, overdue, never calibrated). Dates are
 * counted back from the day it runs, so the spread holds whenever it is run.
 *
 *   npx tsx --env-file=.env.development.local prisma/dev-calibration-demo.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { addMonths } from "../lib/domain/calibration";
import { addDays } from "../lib/domain/civil-time";

if (!process.env.DATABASE_URL?.includes("lrms_v2") || process.env.DATABASE_URL.includes("neon")) throw new Error("dev-calibration-demo.ts runs against the local lrms_v2 dev database only");

const prisma = new PrismaClient();
const SOURCE = "dev-calibration-demo";
const today = new Date().toISOString().slice(0, 10);
/** Last calibrated so that the next one falls `days` from today (negative: overdue). */
const dueIn = (cycleMonths: number, days: number) => addMonths(addDays(today, days), -cycleMonths);

interface Demo {
  key: string;
  lab: string;
  category: string;
  name: string;
  props: Record<string, unknown>;
  /** Days until the next calibration; null: never calibrated. */
  dueInDays: number | null;
}

const UNIT_OPS = "Mechanical Unit Operations Laboratory";
const REACTION = "Chemical Reaction and Biochemical Engineering Laboratory";
const DEMO: Demo[] = [
  { key: "bal-1", lab: UNIT_OPS, category: "analytical-balance", name: "Analytical balance AB-01", props: { manufacturer: "Sartorius", model: "Entris II", capacityG: 220, readabilityMg: 0.1, serial: "SAR-220-0417" }, dueInDays: 150 },
  { key: "bal-2", lab: UNIT_OPS, category: "analytical-balance", name: "Analytical balance AB-02", props: { manufacturer: "Ohaus", model: "Pioneer PX224", capacityG: 220, readabilityMg: 0.1, serial: "OH-PX-1182" }, dueInDays: 9 },
  { key: "ph-1", lab: UNIT_OPS, category: "ph-meter", name: "pH meter PH-01", props: { manufacturer: "Hanna Instruments", model: "HI5221", serial: "HI-5221-309" }, dueInDays: -62 },
  { key: "ph-2", lab: UNIT_OPS, category: "ph-meter", name: "Conductivity meter CM-01", props: { manufacturer: "Mettler Toledo", model: "SevenCompact S230", serial: "MT-S230-077" }, dueInDays: null },
  { key: "oven-1", lab: UNIT_OPS, category: "drying-oven", name: "Drying oven DO-01", props: { manufacturer: "Memmert", model: "UN110", maxTempC: 300, volumeL: 108, serial: "MEM-UN110-552" }, dueInDays: 21 },
  { key: "uv-1", lab: REACTION, category: "uv-vis", name: "UV-Vis spectrophotometer UV-01", props: { manufacturer: "Shimadzu", model: "UV-1900i", range: "190 to 1100 nm", serial: "SHI-UV19-2041" }, dueInDays: 240 },
  { key: "gc-1", lab: REACTION, category: "gc", name: "Gas chromatograph GC-01", props: { manufacturer: "Agilent", model: "8860", detector: "FID", serial: "AG-8860-9913" }, dueInDays: -120 },
  { key: "cen-1", lab: REACTION, category: "centrifuge", name: "Centrifuge CF-01", props: { manufacturer: "Eppendorf", model: "5702", maxRpm: 4400, serial: "EP-5702-631" }, dueInDays: null },
];

async function main() {
  const dept = await prisma.orgNode.findFirstOrThrow({ where: { name: "Chemical Engineering", kind: "DEPARTMENT" } });
  const admin = await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } }, select: { id: true } });
  const batchId = randomUUID();
  let added = 0;
  let refreshed = 0;
  for (const d of DEMO) {
    const lab = await prisma.item.findFirstOrThrow({ where: { name: d.lab, parentId: null, deletedAt: null, ownerOrgNodeId: dept.id }, orderBy: { createdAt: "asc" } });
    const category = await prisma.resourceCategory.findFirstOrThrow({ where: { key: d.category }, select: { id: true, calibrationCycleMonths: true, countingMode: true } });
    if (!category.calibrationCycleMonths) throw new Error(`${d.category} has no calibration cycle`);
    const props = { ...d.props, ...(d.dueInDays === null ? {} : { lastCalibrated: dueIn(category.calibrationCycleMonths, d.dueInDays) }) } as Prisma.InputJsonValue;
    const existing = await prisma.item.findFirst({ where: { sourceSystem: SOURCE, sourceKey: d.key }, select: { id: true } });
    if (existing) {
      await prisma.item.update({ where: { id: existing.id }, data: { props } });
      refreshed++;
      continue;
    }
    const item = await prisma.item.create({
      data: {
        parentId: lab.id,
        categoryId: category.id,
        name: d.name,
        countingMode: category.countingMode,
        props,
        ownerOrgNodeId: lab.ownerOrgNodeId,
        currentOrgNodeId: lab.currentOrgNodeId,
        custodianId: lab.custodianId,
        sourceSystem: SOURCE,
        sourceKey: d.key,
      },
    });
    await prisma.itemChange.create({
      data: { actorId: admin.id, kind: "createItem", targetKind: "ITEM", itemId: item.id, itemName: item.name, categoryId: category.id, batchId, note: "Calibration demo (dev)" },
    });
    added++;
  }
  console.log(`Calibration demo: ${added} added, ${refreshed} refreshed (dates counted from ${today}).`);
}

main().finally(() => prisma.$disconnect());

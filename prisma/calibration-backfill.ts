/**
 * One-off, idempotent (2026-10-03): the catalogue's free "Calibration due" date becomes
 * a calibration cycle on the category plus each item's "Last calibrated" date
 * (lib/domain/calibration.ts). For a catalogue instrument that is calibrated
 * (`CALIBRATION_CYCLES`), the detail is turned into "Last calibrated" (a value moves
 * back one cycle: due − cycle = last done); for the rest it is removed, after moving
 * any value into the item's extra details so nothing is lost unseen.
 *
 *   npx tsx prisma/calibration-backfill.ts            report only
 *   npx tsx prisma/calibration-backfill.ts --apply    write
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { CALIBRATION_CYCLES } from "./catalogue-data";
import { addMonths } from "../lib/domain/calibration";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const fields = await prisma.categoryField.findMany({ where: { key: "calibrationDue" }, include: { category: { select: { id: true, key: true, name: true } } } });
  let calibrated = 0;
  let removed = 0;
  for (const f of fields) {
    const cycle = CALIBRATION_CYCLES[f.category.key];
    const items = await prisma.item.findMany({ where: { categoryId: f.category.id, deletedAt: null }, select: { id: true, props: true, customProps: true } });
    const withValue = items.filter((i) => typeof (i.props as Record<string, unknown>)?.calibrationDue === "string");
    console.log(`${f.category.name}: ${cycle ? `calibrated every ${cycle} months` : "not calibrated"}; ${withValue.length} value(s)`);
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      for (const it of withValue) {
        const props = { ...(it.props as Record<string, unknown>) };
        const due = props.calibrationDue as string;
        delete props.calibrationDue;
        if (cycle && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
          props.lastCalibrated = addMonths(due, -cycle);
          await tx.item.update({ where: { id: it.id }, data: { props: props as Prisma.InputJsonValue } });
        } else {
          const custom = { ...((it.customProps as Record<string, unknown>) ?? {}), "Calibration due (earlier)": { type: "TEXT", value: due } };
          await tx.item.update({ where: { id: it.id }, data: { props: props as Prisma.InputJsonValue, customProps: custom as Prisma.InputJsonValue } });
        }
      }
      if (cycle) {
        await tx.categoryField.update({ where: { id: f.id }, data: { key: "lastCalibrated", label: "Last calibrated", summary: true } });
        await tx.resourceCategory.update({ where: { id: f.category.id }, data: { calibrationCycleMonths: cycle, version: { increment: 1 } } });
        calibrated++;
      } else {
        await tx.categoryField.delete({ where: { id: f.id } });
        await tx.resourceCategory.update({ where: { id: f.category.id }, data: { version: { increment: 1 } } });
        removed++;
      }
    });
  }
  console.log(apply ? `Done: ${calibrated} calibrated, ${removed} without calibration.` : `Report only (${fields.length} categories). Run with --apply to write.`);
}

main().finally(() => prisma.$disconnect());

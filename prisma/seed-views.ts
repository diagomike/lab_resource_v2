/**
 * Rolls `lib/domain/views.ts`'s `SEED_VIEWS` — one access view per stakeholder level
 * (custodian, department head, the university offices, store keepers, read-only
 * staff) plus the university-wide browse everybody gets — onto a REAL database with
 * real accounts already in it. Unlike `prisma/seed.ts` (dev-only, wipe-and-rebuild)
 * or `resource-seed.ts` (dev fixture data, refuses under NODE_ENV=production), this
 * is meant to run against production: idempotent upsert by the views' own stable
 * ids, never deletes, safe to re-run.
 *
 * Defaults to a DRY RUN — it always prints, for every active account, which view
 * they would land on and whether that is NARROWER than their current (zero-views)
 * default, but writes NOTHING unless `--apply` is passed. If any account would be
 * narrowed and `--force` is not also given, it refuses to apply even then: an
 * administrator has to have actually looked at the report before views change what
 * a real custodian can see.
 *
 * Usage:
 *   npx tsx prisma/seed-views.ts              # report only, writes nothing
 *   npx tsx prisma/seed-views.ts --apply       # writes, refuses if anyone narrows
 *   npx tsx prisma/seed-views.ts --apply --force   # writes regardless
 */
import { PrismaClient } from "@prisma/client";
import { SEED_VIEWS } from "../lib/domain/views";
import { previewRollout } from "../lib/server/resources/views-rollout";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");

function printReport(rows: Awaited<ReturnType<typeof previewRollout>>): number {
  console.log("\nView rollout preview — every active account, today vs. with SEED_VIEWS in place:\n");
  let narrowCount = 0;
  for (const r of rows) {
    const flag = r.narrows ? " ⚠ NARROWS" : "";
    if (r.narrows) narrowCount += 1;
    console.log(
      `  ${r.userName.padEnd(28)} [${r.roles.join(",")}]  today: ${r.currentModeNoViews.padEnd(14)} → ${r.wouldLandOn ?? "(no matching view)"} ` +
        `(${r.wouldLandOnMode ?? "—"}${r.wouldLandOnCanEdit === false ? ", read-only" : ""})${flag}`,
    );
  }
  console.log(`\n${rows.length} accounts checked, ${narrowCount} would see LESS than they do today.\n`);
  return narrowCount;
}

async function main() {
  const rows = await previewRollout(prisma, SEED_VIEWS);
  const narrowCount = printReport(rows);

  if (!apply) {
    console.log("Dry run only — nothing written. Re-run with --apply to write these views.");
    return;
  }

  if (narrowCount > 0 && !force) {
    console.error(`Refusing to apply: ${narrowCount} account(s) would see less than they do today. Review the report above, then re-run with --force if this is intended.`);
    process.exit(1);
  }

  console.log("Applying…");
  for (const view of SEED_VIEWS) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.accessView.upsert({
        where: { id: view.id },
        update: {
          name: view.name,
          description: view.description ?? null,
          scope: view.scope,
          explicitNodeIds: view.explicitNodeIds ?? [],
          extraFilters: (view.extraFilters as never) ?? undefined,
          canEdit: view.canEdit,
          active: view.active,
        },
        create: {
          id: view.id,
          name: view.name,
          description: view.description ?? null,
          scope: view.scope,
          explicitNodeIds: view.explicitNodeIds ?? [],
          extraFilters: (view.extraFilters as never) ?? undefined,
          canEdit: view.canEdit,
          active: view.active,
        },
      });
      await tx.accessViewAudience.deleteMany({ where: { viewId: row.id } });
      await tx.accessViewAudience.createMany({
        data: view.audiences.map((a) => ({
          viewId: row.id,
          type: a.type,
          role: a.type === "ROLE" ? a.role : null,
          personId: a.type === "PERSON" ? a.personId : null,
        })),
      });
    });
    console.log(`  ${view.id}: "${view.name}" (${view.audiences.length} audience row(s))`);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Rolls `lib/domain/approvals.ts`'s `SEED_POLICIES` — the institution's full rule set
 * (operation × actor role × object → AUTO/CHAIN/DENY) — onto a real database. Unlike
 * `prisma/seed.ts` (dev-only, wipe-and-rebuild), this is meant to run against
 * production: idempotent upsert by each policy's own stable id, never deletes, safe
 * to re-run.
 *
 * Seeding the full set is safe on its own — see
 * ~/.claude/plans/lets-merge-the-work-memoized-journal.md §6.1 — because nothing
 * reads `ApprovalPolicy` rows yet except Track 3's own `transferItem`-only code path
 * in `lib/server/resources/approvals.ts`. Every other operation (`setStatus`,
 * `setProperty`, `createItem`, ...) keeps applying directly through `mutate.ts`,
 * completely unaffected by these rows existing.
 *
 * Usage:
 *   npx tsx prisma/seed-policies.ts            # report only, writes nothing
 *   npx tsx prisma/seed-policies.ts --apply     # writes
 */
import { PrismaClient } from "@prisma/client";
import { SEED_POLICIES } from "../lib/domain/approvals";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");

async function main() {
  const existing = await prisma.approvalPolicy.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((r) => r.id));

  console.log(`\nApprovalPolicy rollout — ${SEED_POLICIES.length} rules in SEED_POLICIES, ${existingIds.size} already in the database:\n`);
  for (const policy of SEED_POLICIES) {
    console.log(`  ${existingIds.has(policy.id) ? "update" : "create"}  ${policy.id.padEnd(24)} ${policy.operation.padEnd(20)} ${(policy.actorRole === "ANY" ? "ANY" : policy.actorRole).padEnd(14)} → ${policy.outcome}`);
  }

  if (!apply) {
    console.log("\nDry run only — nothing written. Re-run with --apply to write these policies.");
    return;
  }

  console.log("\nApplying…");
  for (const policy of SEED_POLICIES) {
    await prisma.approvalPolicy.upsert({
      where: { id: policy.id },
      update: {
        name: policy.name,
        operation: policy.operation,
        appliesTo: policy.appliesTo as never,
        actorRole: policy.actorRole === "ANY" ? null : policy.actorRole,
        outcome: policy.outcome,
        chain: (policy.chain as never) ?? undefined,
        enabled: policy.enabled,
      },
      create: {
        id: policy.id,
        name: policy.name,
        operation: policy.operation,
        appliesTo: policy.appliesTo as never,
        actorRole: policy.actorRole === "ANY" ? null : policy.actorRole,
        outcome: policy.outcome,
        chain: (policy.chain as never) ?? undefined,
        enabled: policy.enabled,
      },
    });
  }
  console.log(`Done — ${SEED_POLICIES.length} polic${SEED_POLICIES.length === 1 ? "y" : "ies"} in place.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

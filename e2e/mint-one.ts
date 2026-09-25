/**
 * Mints ONE session for the given email on the CLONE DB and prints its raw token —
 * for driving the in-app browser as a particular person (the driver sets the cookie;
 * it never submits a password). Usage: node e2e/with-env.mjs npx tsx e2e/mint-one.ts <email>
 */
import { PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "../lib/server/auth/token";

if (!process.argv.includes("--dev") && !process.env.DATABASE_URL?.includes("lrms_v2_e2e")) throw new Error("mint-one.ts runs against lrms_v2_e2e (or lrms_v2 with --dev)");
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) throw new Error("usage: mint-one.ts <email>");
  const user = await prisma.user.findUniqueOrThrow({ where: { emailLower: email } });
  const token = generateToken();
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 86_400_000), userAgent: "e2e-driver" },
  });
  console.log(token);
}

main().finally(() => prisma.$disconnect());

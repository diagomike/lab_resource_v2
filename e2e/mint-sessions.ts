/**
 * Mints one Session per cast member on the CLONE DB and writes raw cookies to
 * e2e/.sessions.json (gitignored). Sessions are minted, not logged in, because the
 * campaign driver may not submit passwords; password flows live in e2e/auth-check.ts,
 * which the user runs themselves.
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { generateToken, hashToken } from "../lib/server/auth/token";

if (!process.env.DATABASE_URL?.includes("lrms_v2_e2e")) throw new Error("mint-sessions.ts runs against lrms_v2_e2e only");
const prisma = new PrismaClient();

const CAST: Record<string, string> = {
  admin: "admin@astu.edu.et",
  avp: "avp@e2e.test",
  deanCoeec: "dean.coeec@e2e.test",
  deanComcme: "dean.comcme@e2e.test",
  headSe: "head.se@astu.edu.et",
  headChem: "head.chem@astu.edu.et",
  headMat: "head.mat@e2e.test",
  custSe: "custodian.se@astu.edu.et",
  custSe2: "shambel.lemma@astu.edu.et",
  custChem: "custodian.chem@astu.edu.et",
  custMat: "custodian.mat@e2e.test",
  procurement: "procurement@e2e.test",
  storekeeper: "storekeeper@e2e.test",
  staffSe: "staff.se@e2e.test",
  staffChem: "staff.chem@e2e.test",
  student: "student@e2e.test",
  propadmin: "propadmin@e2e.test",
  disabled: "disabled@e2e.test",
};

async function main() {
  const out: Record<string, { id: string; email: string; token: string }> = {};
  for (const [key, email] of Object.entries(CAST)) {
    const user = await prisma.user.findUniqueOrThrow({ where: { emailLower: email } });
    const token = generateToken();
    await prisma.session.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 86_400_000), userAgent: "e2e-campaign" },
    });
    out[key] = { id: user.id, email, token };
  }
  fs.writeFileSync("e2e/.sessions.json", JSON.stringify(out, null, 2));
  console.log(`minted ${Object.keys(out).length} sessions`);
}

main().finally(() => prisma.$disconnect());

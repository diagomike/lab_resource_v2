import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** DB-backed — outside requesters' accounts (2026-09-28): sign up, the emailed link,
 *  sign-in refused until it is followed, earlier requests from the same address attached
 *  on verification, and the ways a sign-up is refused. Mail is captured, not sent. */
function loadDotEnv(): void {
  if (process.env.DATABASE_URL) return;
  const content = fs.readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadDotEnv();

const sent: Array<{ to: string; subject: string; html: string }> = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string; html: string }) => void sent.push(m) }));

let accounts: typeof import("./external-account");
let auth: typeof import("./auth");
let prisma: (typeof import("../prisma"))["prisma"];

const testKey = `__test-extacct-${Date.now()}`;
const emails: string[] = [];

function signup(suffix: string, overrides: Record<string, unknown> = {}) {
  const email = `${testKey}-${suffix}@example.org`;
  emails.push(email.toLowerCase());
  return { email, input: { organisation: "Outside Labs PLC", name: `Test ${suffix}`, email, phone: "+251911000999", password: "correct horse battery", ...overrides } };
}

const tokenIn = (html: string) => html.match(/verify\?token=([\w-]+)/)?.[1] ?? "";

beforeAll(async () => {
  accounts = await import("./external-account");
  auth = await import("./auth");
  ({ prisma } = await import("../prisma"));
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { emailLower: { in: emails } }, select: { id: true } });
  await prisma.externalRequest.deleteMany({ where: { contactEmail: { in: emails } } });
  await prisma.invitation.deleteMany({ where: { emailLower: { in: emails } } });
  await prisma.loginAttempt.deleteMany({ where: { OR: [{ emailLower: { in: emails } }, { emailLower: { startsWith: "signup:" }, ipHash: { startsWith: testKey } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
});

describe("requester accounts", () => {
  it("signs up unverified, refuses sign-in until the emailed link is followed, then attaches earlier requests", async () => {
    const { email, input } = signup("alpha");
    // A request sent from this address before accounts existed.
    const legacy = await prisma.externalRequest.create({
      data: { reference: `${testKey}-LEGACY`, organizationName: "Outside Labs PLC", contactName: "A", contactEmail: email.toLowerCase(), contactPhone: "0911", purpose: "old", lines: [], letterStorageKey: `${testKey}-none`, letterFileName: "l.pdf", letterByteSize: 1 },
    });

    sent.length = 0;
    await accounts.signUp(input, `${testKey}-ip`);
    const user = await prisma.user.findUniqueOrThrow({ where: { emailLower: email.toLowerCase() }, include: { roles: true } });
    expect([user.status, user.roles.map((r) => r.kind), user.organisation]).toEqual(["INVITED", ["EXTERNAL"], "Outside Labs PLC"]);
    expect(sent.map((m) => m.to)).toEqual([email]);

    await expect(auth.login({ email, password: input.password }, {})).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/Confirm your email/) });
    // A wrong password still says only that.
    await expect(auth.login({ email, password: "wrong one entirely" }, {})).rejects.toMatchObject({ status: 401, message: expect.stringContaining("The password is wrong") });

    await expect(accounts.verifyEmail("x".repeat(43))).rejects.toMatchObject({ status: 400 });
    await accounts.verifyEmail(tokenIn(sent[0].html));
    await expect(accounts.verifyEmail(tokenIn(sent[0].html))).rejects.toMatchObject({ status: 400 });
    expect((await auth.login({ email, password: input.password }, {})).user.roles).toEqual(["EXTERNAL"]);
    expect((await prisma.externalRequest.findUniqueOrThrow({ where: { id: legacy.id } })).requesterId).toBe(user.id);
  });

  it("signing up again before verifying sends a fresh link; an existing account or a staff address is refused", async () => {
    const { email, input } = signup("beta");
    await accounts.signUp(input, `${testKey}-ip`);
    sent.length = 0;
    await accounts.signUp({ ...input, name: "Beta Renamed" }, `${testKey}-ip`);
    expect(sent.map((m) => m.to)).toEqual([email]);
    expect((await prisma.user.findUniqueOrThrow({ where: { emailLower: email.toLowerCase() } })).name).toBe("Beta Renamed");
    await accounts.verifyEmail(tokenIn(sent[0].html));
    await expect(accounts.signUp(input, `${testKey}-ip`)).rejects.toMatchObject({ status: 409 });

    const staff = await prisma.user.findFirstOrThrow({ where: { roles: { some: { kind: "SYS_ADMIN" } } } });
    await expect(accounts.signUp({ ...input, email: staff.email }, `${testKey}-ip`)).rejects.toMatchObject({ status: 409 });
    await expect(accounts.signUp({ ...signup("gamma").input, website: "bot" }, `${testKey}-ip`)).rejects.toMatchObject({ status: 400 });
  });
});

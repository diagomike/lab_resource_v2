import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as argon2 from "@node-rs/argon2";

/** DB-backed — login/register/forgot-password against real Postgres. Mail is mocked
 *  (nothing leaves the machine — this repo's own .env carries real Gmail SMTP
 *  credentials, same reasoning external/requests.spec.ts's mock already documents).
 *  Every user row is created fresh with a unique email. */
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

const sent: Array<{ to: string; subject: string }> = [];
vi.mock("../mail/mail", () => ({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) }));

type AuthModule = typeof import("./auth");
type PrismaModule = typeof import("../prisma");

let auth: AuthModule;
let prisma: PrismaModule["prisma"];

const testKey = `__test-auth-${Date.now()}`;
const createdUserIds: string[] = [];
let userCounter = 0;

async function makeUser(suffix: string, opts: { status?: "INVITED" | "ACTIVE" | "DISABLED"; withPassword?: boolean } = {}) {
  const email = `${testKey}-${suffix}-${userCounter++}@astu.edu.et`;
  // login()'s argon2.verify needs a real PHC-format hash to decode, even for a
  // deliberately-wrong-password test — a placeholder string throws before it ever
  // reaches the "does it match" comparison.
  const passwordHash = opts.withPassword === false ? null : await argon2.hash("correct-horse-battery-staple");
  const user = await prisma.user.create({
    data: { email, emailLower: email, name: `Test ${suffix}`, status: opts.status ?? "ACTIVE", passwordHash },
  });
  createdUserIds.push(user.id);
  return { id: user.id, email, emailLower: email };
}

beforeAll(async () => {
  auth = await import("./auth");
  ({ prisma } = await import("../prisma"));
});

afterAll(async () => {
  await prisma.loginAttempt.deleteMany({ where: { emailLower: { startsWith: testKey } } });
  await prisma.passwordReset.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.invitation.deleteMany({ where: { emailLower: { startsWith: testKey } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("F-009 — forgot-password never resets an account that never set a password", () => {
  it("re-sends the invitation (not a reset) to an INVITED account with no passwordHash", async () => {
    const { email, emailLower } = await makeUser("invited", { status: "INVITED", withPassword: false });
    const before = sent.length;
    await auth.forgotPassword({ email });
    expect(sent.slice(before)).toEqual([{ to: email, subject: "Your ASTU Lab Resources invitation" }]);
    const resets = await prisma.passwordReset.count({ where: { user: { emailLower: email } } });
    expect(resets).toBe(0);
    expect(await prisma.invitation.count({ where: { emailLower, consumedAt: null, expiresAt: { gt: new Date() } } })).toBe(1);
  });

  it("throttles invitation re-sends through forgot-password at 3 an hour", async () => {
    const { email } = await makeUser("invited-throttle", { status: "INVITED", withPassword: false });
    const before = sent.length;
    for (let i = 0; i < 4; i++) await expect(auth.forgotPassword({ email })).resolves.toBeUndefined();
    expect(sent.length).toBe(before + 3);
  });

  it("still sends for an ACTIVE account with a password", async () => {
    const { id, email } = await makeUser("active-reset");
    const before = sent.length;
    await auth.forgotPassword({ email });
    expect(sent.length).toBe(before + 1);
    const resets = await prisma.passwordReset.count({ where: { userId: id } });
    expect(resets).toBe(1);
  });
});

describe("administrator sign-in help (temporary password, emailed reset)", () => {
  it("a temporary password forces a change, ends every session, and is cleared by changePassword", async () => {
    const { id, email } = await makeUser("temp-pw");
    await prisma.session.create({ data: { userId: id, tokenHash: `${testKey}-old-${id}`, expiresAt: new Date(Date.now() + 86_400_000) } });
    const people = await import("../people/people");
    const before = sent.length;
    const { temporaryPassword } = await people.setTemporaryPassword("admin-actor", ["SYS_ADMIN"], id);
    expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{12}$/);
    expect(sent.slice(before)).toEqual([{ to: email, subject: "Your ASTU Lab Resources password was reset" }]);
    let user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.mustChangePassword).toBe(true);
    expect(await prisma.session.count({ where: { userId: id } })).toBe(0);

    const { token } = await auth.login({ email, password: temporaryPassword }, {});
    const { user: dto } = await auth.login({ email, password: temporaryPassword }, {});
    expect(dto.mustChangePassword).toBe(true);
    await expect(auth.changePassword(id, temporaryPassword, temporaryPassword, token)).rejects.toMatchObject({ status: 400 });
    await auth.changePassword(id, temporaryPassword, "my-own-password-1", token);
    user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.mustChangePassword).toBe(false);
    // The session that made the change survives; the other one does not.
    const { hashToken } = await import("./token");
    expect(await prisma.session.findMany({ where: { userId: id }, select: { tokenHash: true } })).toEqual([{ tokenHash: hashToken(token) }]);
  });

  it("an emailed reset link never reaches the actor, and a head without a post may not send one", async () => {
    const { id, email } = await makeUser("send-reset");
    const people = await import("../people/people");
    const before = sent.length;
    await expect(people.sendPasswordReset("admin-actor", ["SYS_ADMIN"], id)).resolves.toBeUndefined();
    expect(sent.slice(before)).toEqual([{ to: email, subject: "Reset your ASTU Lab Resources password" }]);
    expect(await prisma.passwordReset.count({ where: { userId: id } })).toBe(1);
    const { id: actorId } = await makeUser("postless-manager");
    await expect(people.sendPasswordReset(actorId, ["MANAGER"], id)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a temporary password for someone who has not registered yet", async () => {
    const { id } = await makeUser("temp-invited", { status: "INVITED", withPassword: false });
    const people = await import("../people/people");
    await expect(people.setTemporaryPassword("admin-actor", ["SYS_ADMIN"], id)).rejects.toMatchObject({ status: 400 });
  });
});

describe("F-010 — throttles on forgot-password and login", () => {
  it("the 4th reset request within an hour sends nothing but still answers 201 (resolves)", async () => {
    const { id, email } = await makeUser("reset-throttle");
    for (let i = 0; i < 3; i++) await expect(auth.forgotPassword({ email })).resolves.toBeUndefined();
    const beforeFourth = sent.length;
    await expect(auth.forgotPassword({ email })).resolves.toBeUndefined();
    expect(sent.length).toBe(beforeFourth); // 4th sent nothing
    const resets = await prisma.passwordReset.count({ where: { userId: id } });
    expect(resets).toBe(3);
  });

  it("locks out login after repeated failures on the same account", async () => {
    const { email } = await makeUser("login-lockout");
    for (let i = 0; i < 5; i++) {
      await expect(auth.login({ email, password: "wrong" }, {})).rejects.toMatchObject({ status: 401, message: "Invalid email or password" });
    }
    await expect(auth.login({ email, password: "wrong" }, {})).rejects.toMatchObject({ status: 401, message: expect.stringContaining("Too many failed attempts") });
  });
});

describe("F-012 — a DISABLED account cannot re-register via a leftover invitation (regression, Phase 1)", () => {
  it("refuses register() for a DISABLED account and leaves it DISABLED", async () => {
    const { id, emailLower } = await makeUser("disabled-register", { status: "DISABLED" });
    const { generateToken, hashToken } = await import("./token");
    const raw = generateToken();
    const invitation = await prisma.invitation.create({
      data: { emailLower, tokenHash: hashToken(raw), intendedRole: "STAFF", invitedById: id, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    await expect(auth.register({ token: raw, name: "New Name", password: "Password123!" })).rejects.toMatchObject({ status: 400 });

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.status).toBe("DISABLED");
    await prisma.invitation.delete({ where: { id: invitation.id } });
  });
});

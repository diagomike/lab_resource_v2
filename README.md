# ASTU Laboratory Resource Management System (LRMS v2)

A Next.js application for tracking laboratory resources (labs, equipment, stores) across
a university's org hierarchy — who owns what, who holds it, who is custodian for it, and
its current condition — with a full audit trail, category-driven typed fields, and
role-scoped read/write access.

## Stack

Next.js 16 (App Router, Turbopack), React 19, PostgreSQL via Prisma, Tailwind, Zod,
Vitest. One application — no separate API server.

## Local setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   Copy `.env.example` to `.env` and fill in a real `DATABASE_URL`/`DIRECT_URL`
   (a local Postgres instance is fine — set both to the same value). SMTP and image
   storage settings can stay as their defaults for local dev.

3. **Run migrations and generate the Prisma client**

   ```bash
   npx prisma migrate deploy
   npm run prisma:generate
   ```

4. **Seed a working dataset**

   ```bash
   npm run prisma:seed
   ```

   Creates one SYS_ADMIN (`admin@astu.edu.et` / `astu1234`), the university root
   node, and a small two-department fixture (Software Engineering / Chemical
   Engineering, each with a department head and a custodian — all `astu1234`) so
   cross-department scoping has something real to exercise. This script **wipes and
   rebuilds** every run — it refuses to run with `NODE_ENV=production` (see
   `prisma/bootstrap.ts` for the production equivalent).

   Optionally, load a representative set of categories/items on top of that fixture:

   ```bash
   npm run seed:resources
   ```

5. **Start the dev server**

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000> and sign in as `admin@astu.edu.et`.

### Local mail

Invitation, password-reset, and other transactional emails go out over SMTP. For
local testing without real credentials, run [maildev](https://github.com/maildev/maildev):

```bash
npm run mail
```

and point `SMTP_HOST`/`SMTP_PORT` in `.env` at it. If SMTP isn't configured or a send
fails, the app logs the error and continues — nothing blocks on mail delivery. The
People page also surfaces a **copyable invite link** after every invite/resend, so
onboarding never depends solely on the email actually arriving.

## Migrations

Migrations are **append-only** — never edit a committed migration file. To add one:

```bash
npm run prisma:migrate    # `prisma migrate dev`, local development only
```

In any deployed environment, use `prisma migrate deploy` instead (never `migrate
dev`, which can prompt interactively and is meant for local iteration):

```bash
npm run prisma:deploy
```

## Testing

```bash
npm test          # one-shot
npm run test:watch
```

Tests are DB-backed against the same Postgres the dev server uses (they read
`.env`) — they operate on scoped, self-cleaning fixtures, but do require a real,
migrated database.

## Verifying before a commit or deploy

```bash
npx tsc --noEmit
npm test
npm run build
npx prisma validate
npx prisma migrate status
```

## Deploying (Vercel + Neon + Vercel Blob)

This is written for that specific combination; substitute equivalents (Supabase,
S3/R2, ...) as needed — the storage backend is a one-file seam (see
`lib/server/resources/storage/index.ts`).

1. **Database — Neon.** Create a Neon project and database. Neon gives you both a
   pooled and a direct connection string; set `DATABASE_URL` to the pooled one and
   `DIRECT_URL` to the direct one (serverless functions open/close connections per
   invocation, and the pooler is what keeps that from exhausting Postgres's
   connection limit — migrations still need the direct connection).

2. **Image storage — Vercel Blob.** Attach a Blob store to the Vercel project (this
   sets `BLOB_READ_WRITE_TOKEN` automatically). Set `IMAGE_STORAGE_DRIVER=vercel-blob`.

3. **Vercel project.** Import the repository. Set every variable from `.env.example`
   in the project's environment settings — in particular, `APP_ORIGIN` **must** be
   the real deployment URL, or every invitation/password-reset email links back to
   localhost. Add `npx prisma generate` to the build if it isn't picked up
   automatically (Prisma's own Vercel integration usually handles this).

4. **Run migrations against the new database:**

   ```bash
   npm run prisma:deploy
   ```

5. **Bootstrap the first account** — do this exactly once, against production, not
   `npm run prisma:seed` (that script wipes and rebuilds; running it against a real
   database would delete every real account):

   ```bash
   BOOTSTRAP_ADMIN_EMAIL=you@example.edu \
   BOOTSTRAP_ADMIN_PASSWORD=... \
   npx tsx prisma/bootstrap.ts
   ```

   Idempotent — safe to re-run (it upserts, never deletes). See
   `prisma/bootstrap.ts`'s own header for every variable it accepts.

6. **Sign in and build the org chart from there** — colleges, departments, offices,
   and personnel are all created through the app itself; nothing further needs
   seeding.

### Verifying the deploy

Sign in as the bootstrapped admin, build a small slice of the org chart, invite a
department head via the copied link (not email — proves the non-SMTP path works),
have them invite a custodian, and on that custodian's genuinely empty register
create a lab and then something inside it. Upload a photo and confirm it's still
there after a redeploy (this is what actually exercises the Blob driver — a photo
that survives only until the next deploy means the local driver is still active).

## Project structure

- `app/` — Next.js routes (pages under `app/(workspace)/`, `app/(auth)/`; API route
  handlers under `app/api/`).
- `lib/server/**` — server-only modules (`import "server-only"`), one per domain
  area (auth, org, people, resources).
- `lib/shared/**` — Zod contracts shared between client and server; the wire format.
  Client code must only import types from here, never server logic.
- `lib/domain/**` — pure, framework-free business logic (status derivation,
  filtering, tree operations, placement rules) — unit-tested independent of Prisma.
- `components/**` — client components, organized by feature area.
- `prisma/` — schema, migrations, and the three data scripts (`seed.ts` for dev,
  `bootstrap.ts` for production, `resource-seed.ts` for a representative item
  fixture).

See [PROGRESS.md](PROGRESS.md) for the full project history, architectural
decisions, and current state — it's the persistent memory for this project across
work sessions.

# LRMS v2 — Progress & Context Snapshot

This file is the persistent memory for this project. It's updated after every
work session so a fresh chat (post context-clear) can pick up without
re-explaining anything. Read this file first in a new conversation.

## What this project is

Rebuild of the Laboratory Resource Management System at
`D:\py_yaddessa\lab_resource_v2`, starting from two sibling repos:

- `D:\py_yaddessa\sc_lab_resource` — mature, 8-phase LRMS. This rebuild's
  **backend** (auth/org/people) is carried over from here nearly verbatim —
  it was already correct and more complete for this domain than the sister
  app.
- `D:\py_yaddessa\sc_feedback` — sister teaching-feedback system, same stack.
  Source of a few specific things the user preferred: login page chrome,
  theming/font-size correction. (Its own org-structure UI — simple per-kind
  CRUD pages, no canvas — was tried first but then explicitly rejected; see
  Decisions below.)

**Scope of this rebuild**: identity + org-hierarchy foundation only —
User/roles/sessions/invitations + the org chart (OrgNode/OrgEdge/OrgClosure/
OrgNodeAssignment). Every lab-management domain table (Location, Asset,
StockLine, Category, CatalogItem, procurement, bookings, chemicals, etc.) is
**deliberately deferred** — to be designed and built one module at a time in
future work, not ported wholesale.

## Stack

- Monorepo: npm workspaces — `apps/api`, `apps/web`, `packages/shared`
- Backend: NestJS 10.4.x, Prisma 6.19.3, PostgreSQL, argon2, nodemailer
  (Gmail SMTP with maildev fallback), zod validation (`ZodValidationPipe`)
- Frontend: React 18.3, Vite 5.4, Tailwind 3.4, react-router-dom 6.26,
  `@xyflow/react` (ReactFlow) 12.3.6 + `dagre` 0.8.5 for the org canvas
- `packages/shared`: zod schemas + inferred TS types — single source of truth
  for DTOs

## Key architectural decisions

- **Org hierarchy** is a layered DAG (multi-parent allowed — e.g. a
  department co-owned by two colleges), with a precomputed `OrgClosure`
  table (BFS, `computeClosureRows`) for O(1) reachability/permission checks.
  Edges only connect *adjacent* levels (`assertAdjacentParents`) — that
  single rule keeps every node's ancestor chain a straight walkable line.
- **`OrgNode.userId`** is a cache of the current occupant; **`OrgNodeAssignment`**
  is the dated ledger of who has held the node over time. Same cache/ledger
  split used throughout (mirrors `sc_feedback`'s pattern).
- **`ScopeService`** resolves which org nodes a user can see: global roles
  (SYS_ADMIN/PROPERTY_ADMIN/PROCUREMENT see everything), occupancy-based,
  homeNodeId-based, or none (students).
- **4 workspace shells** (admin/department/approver/custodian), computed
  server-side in `auth.controller.ts`'s `me()` via `workspacesFor()`.
- **Mail pattern**: inline HTML in `.send()` calls, sent *after* the DB
  transaction commits (never inside one), sequential sends only (never
  `Promise.all`).
- **Confirmation-dialog pattern**: `ConfirmDialog` (wraps `Modal`) +
  discriminated-union `PendingAction` state machine in the consuming page.
  Anything that changes access, destroys something, or changes how a node is
  understood in the hierarchy goes through it. Anything reversible or
  purely-additive (reassigning parents, creating a node) does not.

## Decisions made along the way (so we don't redo this debate)

1. Org-structure UI: **canvas wins**. Tried `sc_feedback`'s simpler
   drag-list + per-kind pages first; user explicitly asked to go back to
   `sc_lab_resource`'s original ReactFlow/dagre canvas, with one unified
   node-creation form (Kind dropdown) instead of separate
   College/Department/Office pages.
2. Node inspector should be as direct as the occupant picker: name and kind
   are inline-editable right in the panel, not buried in a separate edit
   mode.
3. Anything with a real consequence needs a confirmation pop-up: occupant
   change, vacate, deactivate, delete, **and now kind change** (see
   timeline). Anything reversible/additive (reparenting, creating a node)
   does not.
4. Assigning an occupant — whether an existing person or a brand-new invite
   — sends an email, same as the personnel-invite flow. Vacating and no-op
   re-saves do **not** email.
5. You can invite a brand-new person and assign them as a node's occupant
   directly from the Org Studio page (no detour through Personnel first).
   Role choices offered there are scoped to the three that make sense for
   occupying a node: MANAGER, PROPERTY_ADMIN, PROCUREMENT (not the full
   7-role list — SYS_ADMIN deliberately occupies no node).

## Current state

Both dev servers run via `npm run dev` (workspace root) and are normally
left running during a work session:
- API: NestJS, port from `apps/api/.env` (Postgres db `lrms_v2`)
- Web: Vite dev server

Seed data (`apps/api/prisma/seed.ts`): one SYS_ADMIN
(`admin@astu.edu.et` / `astu1234`) + one UNIVERSITY root OrgNode
("Adama Science and Technology University") — **plus, as of the resource
register's Phase 1 (2026-09-02), a small scoping fixture**: 2 colleges, 2
departments (SE / ChemE, each with a `code`), a department head + a
custodian per department (`head.se@astu.edu.et` / `head.chem@astu.edu.et` /
`custodian.se@astu.edu.et` / `custodian.chem@astu.edu.et`, all
`astu1234`), one `Lab` category, and 3 seeded labs (2 owned by SE, 1 by
ChemE) — enough to exercise `ItemScopeService`'s cross-department scoping
live. This fixture is explicitly demo-only and gets replaced by the real
ASTU data import in a later resource-register phase.

`.env` (apps/api) has real dev credentials copied from the user's own
sibling project (`DATABASE_URL`, Gmail `SMTP_*`, `MAIL_FROM`) — this is the
user's own dev machine, not a shared secret; `.gitignore` already excludes
`.env`. No git repo has been initialized for this project yet.

### Built so far

- Identity: register-by-invite, login, forgot/reset/change password, session
  auth (httpOnly cookie, hashed token, argon2).
- Org Studio (`apps/web/src/pages/admin/OrgStudioPage.tsx`): ReactFlow+dagre
  canvas, click a node to inspect/edit it. Inline-editable name (explicit
  Save button) and kind (dropdown). Occupant assign/vacate via
  `EntityPicker`, or invite-and-assign-in-one-step via a form on the same
  panel. Parent reassignment via checkboxes. Deactivate/reactivate/delete.
  Confirmation pop-up before: assign occupant, vacate occupant, **change
  kind**, deactivate, delete.
- Personnel page: list/invite/assign-roles/assign-node, ported from
  `sc_lab_resource` mostly unchanged.
- Admin dashboard: stats computed client-side from `/org/nodes` + `/people`.
- Auth screens (Login/AcceptInvite/ForgotPassword/ResetPassword) use shared
  `AuthChrome` (ASTU top bar + theme toggle, centered card) ported from
  `sc_feedback`.
- Profile page: account details + change password (from `sc_lab_resource`)
  merged with theme/text-size/typeface controls (`DisplayPanel`,
  `SegmentedChoice`) ported from `sc_feedback`.
- Nav: 4 workspaces; admin has Dashboard / People & roles / Org structure /
  **Register**. department/approver/custodian each now have a **Register**
  entry too (their "Coming soon" placeholder is gone — see the resource
  register below); everything else in those three workspaces still awaits
  its module, one at a time.
- **Resource register, Phase 1** (`apps/api/src/resources/`,
  `apps/web/src/pages/resources/RegisterPage.tsx`) — a flat, scoped item
  list. `ResourceCategory`/`CategoryField`/`Item` in Postgres;
  `ItemScopeService` (owner-or-current org reach, plus a narrower
  recursive-query custody scope for a CUSTODIAN-without-MANAGER) gates
  every read; `GET /resources/categories`, `GET /resources/search`,
  `GET /resources/items/:id`. One `RegisterPage` mounted at all four
  workspaces, scoped differently per caller server-side. Containment,
  mutations and derived status are later phases — see
  `~/.claude/plans/act-as-the-principal-hazy-thompson.md`.

### Not yet done

- Browser click-through verification of the round-3 features (confirm
  dialogs, assignment email, invite-and-assign-from-Org-Studio) — code is
  build-verified but not yet exercised live in-browser this session.
- Everything domain-specific beyond identity/org and the resource
  register's Phase 1 flat list: item containment/tree/rollup views,
  mutations + audit log, category administration (fields, default child
  templates), derived (never-stored) `IMPAIRED` status, server-side
  filtering/pagination, images, the real ASTU data import, and — as their
  own separate, later modules — access views, approval policies/requests,
  transfers, procurement, and scheduling. Full phase-by-phase plan:
  `~/.claude/plans/act-as-the-principal-hazy-thompson.md`.

### The resource module: sandboxed, then planned, now landing

The resource register's domain model was worked out in a sandbox first —
`D:/py_yaddessa/temp_works` (Next.js + Zustand + localStorage) — because
iterating a data model against Prisma migrations is slow. `Direction.md` in
this repo is its founding brief. That sandbox is now feature-complete for
its own purpose (register, categories, derived status, filters, access
views, approval policies, transfers, procurement, personnel, bookings —
~21k lines) and its worktree is committed
(`7cdc473 feat: vacant offices block approval, custody is never null`).

A full architectural plan for landing it — what to adopt, adapt, merge,
defer or reject; the Prisma data model; NestJS module boundaries; a
dependency-ordered phase list; and a scheduling-specific addendum covering
weekly class timetables, ad hoc bookings and department/external
occasions — was written after deep review of both codebases (including the
sandbox's uncommitted worktree and documentation-vs-code drift) and lives
at `~/.claude/plans/act-as-the-principal-hazy-thompson.md`. **Phase 1 of
that plan has landed** (see "Built so far" above): the `Item`/
`ResourceCategory`/`CategoryField` core, `ItemScopeService`, and a scoped
flat register, verified live in-browser across a SYS_ADMIN, two department
heads and a custodian — including confirming at the raw network-payload
level, not just the UI, that a department head's response never mentions
the other department's node id.

Two decisions from the plan worth remembering, since they change what the
sandbox actually did:
- `currentOrgNodeId` is **NOT NULL**, defaulted to the owner at creation —
  the sandbox left it nullable and special-cased the fallback in two
  places (`filters.ts`, `scope.ts`); this repo's schema does not need to.
- The sandbox's `README.md` claims a `NEVER`-impairment category can still
  be taken down by a critical child ("a lab is never impaired by its
  contents, but its switch rack is critical to it"). The algorithm
  (`status.ts`) does not implement that — `NEVER` ignores every child
  unconditionally. The correct way to express "ignores ordinary contents
  but fails on its rack" is `ANY_CRITICAL` with the ordinary contents
  marked non-critical, which is what the sandbox's own seed data actually
  does. Carry the seed's behavior forward, not the README's sentence.

## Timeline

- **2026-08-21** — Initial rebuild approved and built: trimmed Prisma schema
  (identity + org-hierarchy tables only), backend carried over from
  `sc_lab_resource`, frontend chrome/theming ported from `sc_feedback`,
  4-workspace nav with only admin fleshed out. Verified: build succeeds,
  servers start, login/org-CRUD/invite/profile-theming all worked live.
- **2026-08-21** — Feedback round 1: restored the original ReactFlow/dagre
  canvas org-structure UI (had initially built `sc_feedback`'s simpler
  per-kind-page + drag-list version; user asked for the canvas back), with
  one unified node-creation form (Kind dropdown) instead of per-kind pages.
  Deleted the now-unused per-kind pages. Verified live in-browser.
- **2026-08-21** — Feedback round 2: made node name and kind inline-editable
  in the Org Studio inspector panel (`NodeHeaderEditor`), matching the
  directness of the occupant picker. Verified live in-browser.
- **2026-08-21** — Feedback round 3 (three-part): added `ConfirmDialog`
  (`components/ui.tsx`) and a `PendingAction` state machine in
  `OrgStudioPage.tsx` so occupant change, vacate, deactivate and delete all
  require confirmation; added an email on occupant assignment
  (`people.service.ts` `assignNode()`, only on a genuinely *new* assignment,
  not on vacate or a no-op re-save) with matching wording added to the
  existing invite email when an invite includes a node assignment; added
  "+ Invite someone new and assign them here" on the Org Studio occupant
  section (`InviteAndAssignForm`), posting to the same `/people` endpoint
  the Personnel page uses, scoped to the three headship roles
  (MANAGER/PROPERTY_ADMIN/PROCUREMENT). Build-verified; not yet
  browser-verified.
- **2026-08-21** — This file created, per user request, as the standing
  memory/timeline doc to survive context clears.
- **2026-08-21** — Feedback round 4: changing a node's **kind** (office ↔
  college ↔ department ↔ university) now also requires confirmation — it no
  longer saves the instant the dropdown changes. Kind change was pulled into
  the same `PendingAction` union/`ConfirmDialog` as occupant/deactivate/
  delete (`changeKind` variant); `NodeHeaderEditor`'s `<select>` now calls a
  new `onRequestKindChange` prop instead of hitting the API directly.
  Build-verified (`npm run build -w apps/web` clean).
- **2026-08-21** — Feedback round 5: Org Studio's canvas+inspector layout is
  now responsive. Below `md` it was a fixed `flex` row with a hardcoded
  `320px`-wide docked side panel, which on phone widths left almost nothing
  for the canvas and cut the panel off — user couldn't see either. Changed
  to `flex-col md:flex-row`: canvas gets a dedicated `360px` height and full
  width on mobile, inspector panel stacks below it full-width (page scrolls
  naturally, same as the rest of the app); at `md`+ it's unchanged (canvas +
  docked 320px panel side by side at 560px height). Verified live in the
  in-app browser at mobile viewport width: canvas fully visible, node
  selection + inspector panel + the round-4 kind-change confirmation dialog
  all work correctly stacked below the canvas.
- **2026-08-21** — Feedback round 6: added a Graph/Cards tab toggle to Org
  Studio (`ViewModeTabs`) — the ReactFlow canvas was still "too much" for
  mobile even stacked full-width, so there's now a lightweight card-list
  alternative (`NodeCardList`: nodes grouped by level, each a tappable card
  showing kind/parents/occupant, no pan/zoom required). Defaults to Cards
  under 768px width and Graph at/above it (`defaultViewMode()`, read once at
  mount), overridable anytime via the tabs. The ReactFlow canvas and its
  dagre layout pass are only mounted/computed in Graph mode — switching to
  Cards on a phone means the canvas library never loads or runs, not just
  that it's visually hidden. Both tabs and node selection sync correctly
  (selecting a card highlights it if you switch to Graph, and vice versa).
  Build-verified and verified live in-app-browser at mobile width.

- **2026-08-28** — Resource-module sandbox reset. A prior agent had turned
  `Direction.md` into a plan (`Details.md`) and executed it in `temp_works`,
  but built the half the brief explicitly deferred: ~3,500 lines of approval
  chains, mutation policies and configurable access views, enforced in browser
  localStorage where they carry no security, re-implementing the org DAG,
  closure index and scope resolution that already exist server-side here. It
  also left every concept with two names (`ownerDeptId` + `ownerOrgNodeId`,
  `Department` + `OrgNode`, `RequestKind` + `MutationOperation`) and ~200 lines
  of unreachable store methods.

  Agreed with the user and carried out: keep the sandbox in `temp_works` and
  land it here later; drop governance entirely for now; salvage the domain core.
  Deleted `governance.ts`, `GovernanceAdmin`, `Approvals` and their tests
  (~1,250 lines); collapsed every duplicate field name to the Postgres name it
  will carry; reduced `store.ts` 1,017 → 442 lines around a single
  `applyChange` write path; split `page.tsx` 805 → 232 lines behind a shared
  `useRegisterState`. Restored spreadsheet-speed inline editing (corrections
  apply with no dialog; consequential changes and all bulk edits confirm first —
  the rule lives in one `CONFIRMED_CHANGES` map that the approval layer will key
  off). Added item photographs (references in the store, bytes in IndexedDB) and
  a proper change-log table. Re-extracted the Chemical Engineering equipment
  register from the source `.docx`, which the earlier pass had only skimmed —
  33 machines with real descriptions, experiment lists and 36 photographs.
  Verified: 12 Vitest tests, lint and build clean, and live in-browser —
  inline edit applies with no dialog and one log row, status change confirms
  first, bulk edit writes 4 rows under one `batchId`, chem equipment shows its
  real photograph and description. `Details.md` deleted as superseded.

- **2026-09-02** — Landing plan written, and its Phase 1 implemented. In plan
  mode, read both codebases deeply (every `temp_works/src/lib` module, its
  commit history, and its uncommitted worktree) and wrote a full
  architectural plan — current-state maps, a source-to-target adoption
  matrix, conflict resolutions, the Prisma data model, NestJS module
  boundaries, and a dependency-ordered phase list — to
  `~/.claude/plans/act-as-the-principal-hazy-thompson.md`. The user then
  reviewed it against a requirement the plan had under-specified —
  scheduling — pointing out that the sandbox's `booking.ts` models one-off
  time-window requests only, not the weekly-class-timetable /
  student-ad-hoc / staff-ad-hoc / department-external calendar actually
  wanted, and that several of its assumptions (a room shareable up to its
  seat count with an *uncounted* room never clashing at all; materials
  reserved by time window instead of by allocation ledger; store-as-ROOM)
  were structurally wrong, not just incomplete. Verified every claim
  against source before revising: confirmed all of them, found the room
  capacity bug worse than described, and found a genuine, separate bug of
  my own in the plan — a test row asserting the sandbox README's claim
  that `NEVER`-impairment categories still fail on a critical child, which
  `status.ts`'s algorithm does not implement (see "Not yet done" above).
  Added a full scheduling architecture addendum (one `Reservation` table
  fed by four sources, a Postgres exclusion constraint against double-
  booking, explicit local-time/UTC handling — the sandbox stamps a bare
  `${local}Z`, a 3-hour Ethiopia-timezone bug invisible in a
  browser-only sandbox) and corrected the impairment test matrix.

  Then executed: committed the sandbox's 20-file uncommitted worktree in
  `temp_works` (vacant-office-blocks approval, non-null custody,
  `ChainStep.selector`) so it stopped being the only copy of that logic;
  implemented the plan's Phase 1 in this repo — `ResourceCategory`/
  `CategoryField`/`Item` in Prisma (with the qty/counting-mode and
  no-self-parent CHECK constraints, and a JSONB GIN index), `packages/
  shared/src/resources/*`, `ItemScopeService` with its pure predicate
  builder unit-tested against fixtures (global/custody/org-reach/no-reach),
  `GET /resources/categories|search|items/:id`, a `RegisterPage` on the
  existing `DataTable` engine at all four workspaces, and a seed fixture
  (2 departments, a Lab category, 3 labs). Verified: `npm run build` clean
  across all three workspaces, all existing tests still pass (94 web + 18
  api, 9 new), and live in-browser as SYS_ADMIN, both department heads and
  a custodian — confirmed at the raw `GET /resources/search` response body,
  not just the rendered table, that a department head's payload never
  contains the other department's data.

## Working agreements for this project

- Never spawn subagents (global CLAUDE.md rule) — do everything inline.
- Update this file's Timeline section after each round of changes, and keep
  the "Current state" / "Decisions" sections in sync when they change —
  don't let this doc drift from what's actually in the code.
- Be cautious about live-testing mutations in the browser when there's
  evidence the user is concurrently using the app themselves (watch for org
  data changing that this session didn't cause).

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

**As of 2026-09-02, mid-conversion to a single Next.js app — see "Architecture
conversion in progress" below before trusting anything in this section that
mentions `apps/api`/`apps/web`/`packages/shared`.**

- **New (target, landing phase-by-phase):** one Next.js 16.3.x app (App
  Router, Turbopack), React 19, Route Handlers under `app/api/**` replacing
  the NestJS controllers, `lib/server/**` (`import "server-only"`) replacing
  the NestJS services with plain functions, `lib/shared/**` replacing
  `packages/shared`, Vitest replacing Jest/ts-jest, Tailwind 3.4 unchanged.
  Root `package.json`, `prisma/`, `.env` all now live at the repo root.
- **Old (still on disk, frozen, not started since Phase 0, deleted in
  Phase 9):** `apps/api` — NestJS 10.4.x; `apps/web` — React 18.3/Vite
  5.4/react-router-dom 6.26; `packages/shared` — the old contracts package.
  `@xyflow/react`/`dagre` for the org canvas carry over unchanged either way.

## Architecture conversion in progress

The npm-workspace split (separate NestJS API + Vite frontend + a compiled
shared-contracts package, glued by same-machine CORS) was never the intended
architecture — the target has always been **one unified Next.js app**. A full
replan + phased execution is underway; the plan (current state, target
decisions, directory mapping, construct-translation rules, the phased
conversion, and — preserved as an appendix — the pre-existing resource
register/scheduling domain design) lives at
`~/.claude/plans/act-as-the-principal-hazy-thompson.md`.

**Phases 0–7 are done** (git history now exists at the repo root, one commit
per phase): checkpoint + a recorded runtime API reference; scaffold; shared
Zod contracts moved; every server-side domain module ported to
`lib/server/**`; all 24 Route Handlers; core UI primitives/contexts; the
frontend shell/routing/auth pages (`app/layout.tsx`, the four `(auth)/`
pages, `app/(workspace)/layout.tsx`, `app/page.tsx`, `proxy.ts`); and the
remaining pages — the data-table engine (with its `useSearchParams` rework),
Org Studio, Personnel, Admin Dashboard, Profile, and the resource register,
mounted at all four workspaces. Every route in the app now exists and is
live-verified. **Remaining: Phase 8** (cutover acceptance pass — §9 of the
plan, full run-through), **Phase 9** (delete `apps/api`/`apps/web`/
`packages/shared` and now-unused dependencies), **Phase 10** (update this
file's stack/current-state sections for the finished conversion, and extract
the resource-register/scheduling appendix into its own plan file).

Everything below this point in the file (Stack's old-architecture note aside)
was written before the conversion was decided on and describes the *domain*
work (org hierarchy, resource register Phase 1, etc.), which the conversion
carries forward unchanged — only its file layout is moving.

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

- **2026-09-02 (later)** — Architecture replan and conversion begun. User
  determined the NestJS API + Vite frontend + shared-package npm-workspace
  split was a deviation from the original intent (one unified Next.js app)
  and asked for a full replan, not a patch. Two rounds of plan-mode rejection
  and revision (first for being an append-only Part-A/Part-B hybrid that left
  the old NestJS plan in place; then for 8 specific execution-blocking issues
  — phase-ordering, a missing ReactFlow Client Component boundary, a
  matcher-less `proxy.ts`, a `server-only` Vitest shim, and the
  resource-register/scheduling design being deleted instead of preserved)
  produced an approved plan at
  `~/.claude/plans/act-as-the-principal-hazy-thompson.md`: one coherent
  Next.js 16 conversion plan (verified against Next's own shipped docs, not
  assumed) with the domain design kept as a clearly separated appendix
  pending Phase 10 extraction.

  Executed Phases 0–6, one git commit each, git initialized fresh at the repo
  root (this project had none before): Phase 0 recorded an actual runtime
  reference snapshot (`docs/pre-conversion-api-reference.md` — exact
  Set-Cookie headers, 400/401/403/404 bodies) from the live NestJS server
  before stopping it for good — the old servers have not run since. Phases
  1–4 scaffolded the app and ported every server module (auth/org/people/
  resources/mail) to `lib/server/**` and all 24 routes to `app/api/**`,
  diffing every response against the Phase 0 reference. Phase 5 ported the
  core UI primitives/contexts. Phase 6 ported the shell/routing/auth pages
  and surfaced a real hydration bug in `theme-context.tsx`: its SSR guard
  (`typeof window === "undefined"`) only prevented a server crash, not a
  client/server mismatch, since `window` already exists during the browser's
  own hydration render — it was reading the real stored/system theme
  immediately instead of the server's hardcoded `"light"` default, crashing
  hydration and (visibly) wiping the login form on reload. Fixed by making
  the initial state always match the server default and applying the real
  value only in a mount-only effect. Verified live: full login→logout cycle,
  cookie attributes matching the Phase 0 reference byte-for-byte (including
  logout's exact clearing header), `proxy.ts` gating protected pages but
  never `/api/**`, and correct role-based landing routing.

- **2026-09-02 (later still)** — Phase 7 executed: the data-table engine
  (`components/data-table/**` — filter/sort/URL-state/facets, all pure logic
  ported unchanged), Org Studio (`components/org-studio/OrgStudioPage.tsx`,
  dynamic-imported with `ssr:false` from a "use client" `page.tsx` per the
  plan's §6.2 Client Component boundary requirement — ReactFlow cannot SSR),
  Personnel, Admin Dashboard, Profile, and the resource register — mounted
  as thin `page.tsx` wrappers under `app/(workspace)/**` at all four
  workspaces (admin/department/approver/custodian), each behind
  `RequireRole` and, where they use `DataTable`, a `<Suspense>` boundary for
  `useSearchParams`.

  `url-state.ts`'s `useTableUrlState` hook was the one genuinely non-trivial
  rework the plan flagged in advance: `next/navigation`'s `useSearchParams()`
  is read-only, unlike react-router's mutable version this was built
  against. Reconstructed the functional-updater contract
  (`setParams(prev => next)`) on top of `router.replace()`, using a ref to
  track the params any pending `replace()` call is about to produce — so two
  `setParams` calls made synchronously in the same tick (several actions do
  this, e.g. `write()`) each see the other's effect instead of both
  computing off the same stale render-time `searchParams`. Every pure
  function (`decodeTableState`, `applyTableState`, `keysFor`, the whole
  `filter-logic.ts` operator matrix) ported unchanged, and all 94 of their
  existing Vitest cases still pass with no modification.

  Live verification surfaced a real, separate bug in `theme-context.tsx`
  (introduced by Phase 6's own SSR-guard fix): the persist effect wrote
  `localStorage` from the SSR-safe placeholder render — one commit *before*
  the mount effect's correction (reading the real stored value) landed —
  permanently clobbering a real stored `"dark"`/`"large"` back to the
  placeholder on the very next reload. Fixed architecturally rather than
  patched: `localStorage` is now written only at the exact point of an
  explicit user action (the `setTheme`/`setFontSize`/`setFontFamily`
  wrappers), never inferred from a `[theme]`-dependent effect; the DOM-sync
  effects are now idempotent and side-effect-free, immune to the ordering
  race regardless of how many times they re-run (this also happens to make
  the whole thing correct under React's dev-mode double-effect-invocation,
  which is what surfaced the bug in the first place).

  Verified live: Org Studio's Graph and Cards views under Turbopack, node
  select/inspect in both; Personnel's `DataTable` — typing a search term
  writes `?people_q=...` to the URL and the filtered view survives a hard
  reload; the resource register across workspaces; Profile's theme/text-size
  toggle now correctly persists across a reload (both the bug and the fix
  confirmed via direct `localStorage` polling, not just visually); and the
  cross-department scoping check via raw `curl` — signed in as
  `head.se@astu.edu.et`, `GET /api/resources/search`'s response contains
  exactly the 2 SE-owned items, no mention of Chemical Engineering's node or
  item id. `npm run build` (every route now present, e.g. `/admin/dashboard`
  no longer 404s) and `npm test` (112 tests) both clean.

## Working agreements for this project

- Never spawn subagents (global CLAUDE.md rule) — do everything inline.
- Update this file's Timeline section after each round of changes, and keep
  the "Current state" / "Decisions" sections in sync when they change —
  don't let this doc drift from what's actually in the code.
- Be cautious about live-testing mutations in the browser when there's
  evidence the user is concurrently using the app themselves (watch for org
  data changing that this session didn't cause).

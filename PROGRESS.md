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

**Two prior conversions are complete** and are foundational, not
in-progress: (1) the app is a single Next.js application, not the original
NestJS API + Vite frontend npm-workspace split — see "Stack" below; (2) as
of 2026-09-02, the project is **replatforming its resource-management
surface** onto the full functional design worked out in the
`D:\py_yaddessa\temp_works` sandbox, replacing the resource-register
"Phase 1" flat list that a previous plan had landed. See "Resource
management: replatforming onto temp_works" below — that is the module this
project is actively building today.

**Scope kept from the original rebuild**: identity + org-hierarchy
foundation — User/roles/sessions/invitations + the org chart
(OrgNode/OrgEdge/OrgClosure/OrgNodeAssignment) — plus personnel management
and Org Studio. These are **not** touched by the resource-management
replatforming; only the resource/inventory module and its navigation are
being replaced.

## Stack

One Next.js 16.3.x application (App Router, Turbopack), React 19. Route
Handlers under `app/api/**`, `lib/server/**` (`import "server-only"`) for
every server-side module, `lib/shared/**` for Zod contracts, Vitest, Tailwind
3.4 (fully custom theme — `tailwind.config.js` replaces Tailwind's default
scale wholesale; this is deliberate and is **not** being changed by the
resource-management replatforming, which reuses these same tokens rather
than adopting `temp_works`' Tailwind 4/shadcn setup). Root `package.json`,
`prisma/`, `.env` all live at the repo root. `@xyflow/react`/`dagre` power
the Org Studio canvas.

The original npm-workspace split (`apps/api` NestJS + `apps/web` Vite/React
+ `packages/shared`) is **gone** — deleted in the conversion's Phase 9
(commit `12de563`). Nothing on disk references it any more.

## Architecture: Next.js conversion (complete) and resource-management replatforming (in progress)

**The Next.js conversion is done.** All ten phases of
`~/.claude/plans/act-as-the-principal-hazy-thompson.md` are committed:
checkpoint + runtime reference; scaffold; shared Zod contracts moved; every
server-side domain module ported to `lib/server/**`; all Route Handlers;
core UI primitives/contexts; the frontend shell/routing/auth pages; the
data-table engine, Org Studio, Personnel, Admin Dashboard, Profile, and the
(now superseded, see below) resource register; the full cutover acceptance
pass; and Phase 9's deletion of the obsolete `apps/`/`packages/` trees. That
plan's own Phase 10 (a documentation-only pass) is what this update
finally closes out.

**Resource management is now being replatformed**, superseding that plan's
appendix ("Resource register & scheduling design"). The appendix's domain
analysis was sound but scoped against a resource module that had only
landed a flat scoped list (Phase 1) and treated the `temp_works` sandbox as
a reference to selectively adopt from. The actual direction is different:
keep auth/org/personnel/Org Studio exactly as they are, delete the Phase-1
resource register and its `DataTable` engine entirely, and bring the
`temp_works` functional surface across whole — register, categories,
derived status, filters, hierarchy/rollup/search views, inspector, inline
and bulk editing, images, change log, access views, approvals, transfers,
procurement, and real-data imports. The full replacement plan — decisions,
data model, server design, phase list, verification — lives at
`~/.claude/plans/wait-i-want-gentle-haven.md`. Bookings are explicitly
deferred to a later track (that plan's §2 records why: the sandbox's
booking model has verified defects — unlimited room sharing when no seat
count is set, bookability inferred rather than configured, materials
modelled as time windows, indefinitely-held pending slots, an in-memory
double-booking guard, and a timezone bug that silently shifts every class
by 3 hours).

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
- **The 4-workspace shell (admin/department/approver/custodian) is being
  retired**, not extended. It was designed for the old resource register's
  per-workspace scoped list; `temp_works`' navigation model — one sidebar
  for everyone, with an access view and server-enforced scope deciding what
  a person sees rather than which menu they get — is replacing it (see
  `~/.claude/plans/wait-i-want-gentle-haven.md`, Phase 5). `WorkspaceKind`,
  `workspacesFor()`, and `lib/nav.ts`'s workspace-keyed structure are
  scheduled for deletion, not preserved as-is. Auth/org/personnel do not
  depend on the workspace concept surviving.

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

One `npm run dev` at the repo root (Next.js, Turbopack) — there is no
second process any more; the old NestJS API and Vite dev server are gone.
Postgres db `lrms_v2`.

Seed data (`prisma/seed.ts`): one SYS_ADMIN (`admin@astu.edu.et` /
`astu1234`) + one UNIVERSITY root OrgNode ("Adama Science and Technology
University"), plus a scoping fixture — 2 colleges, 2 departments (SE / ChemE,
each with a `code`), a department head + a custodian per department
(`head.se@astu.edu.et` / `head.chem@astu.edu.et` / `custodian.se@astu.edu.et`
/ `custodian.chem@astu.edu.et`, all `astu1234`) — enough to exercise
cross-department scoping live. **The resource-register Phase 1 half of this
seed (the `Lab` category and 3 seeded labs) is being deleted along with the
Phase-1 resource module itself** (replatforming Phase 1, see the
architecture section above); the auth/org half of the seed is untouched.

`.env` (repo root) has real dev credentials copied from the user's own
sibling project (`DATABASE_URL`, Gmail `SMTP_*`, `MAIL_FROM`) — this is the
user's own dev machine, not a shared secret; `.gitignore` excludes `.env`.

### Built so far

- Identity: register-by-invite, login, forgot/reset/change password, session
  auth (httpOnly cookie, hashed token, argon2). `app/api/auth/**`,
  `lib/server/auth/**`.
- Org Studio (`components/org-studio/OrgStudioPage.tsx`): ReactFlow+dagre
  canvas, click a node to inspect/edit it. Inline-editable name (explicit
  Save button) and kind (dropdown). Occupant assign/vacate via
  `EntityPicker`, or invite-and-assign-in-one-step via a form on the same
  panel. Parent reassignment via checkboxes. Deactivate/reactivate/delete.
  Confirmation pop-up before: assign occupant, vacate occupant, change kind,
  deactivate, delete.
- Personnel page (`components/admin/PersonnelPage.tsx`): list/invite/
  assign-roles/assign-node, ported from `sc_lab_resource` mostly unchanged.
- Admin dashboard: stats computed client-side from `/api/org/nodes` +
  `/api/people`.
- Auth screens (Login/AcceptInvite/ForgotPassword/ResetPassword) use shared
  `AuthChrome` (ASTU top bar + theme toggle, centered card) ported from
  `sc_feedback`.
- Profile page: account details + change password (from `sc_lab_resource`)
  merged with theme/text-size/typeface controls ported from `sc_feedback`.
- Nav: 4 workspaces (admin/department/approver/custodian) — **scheduled for
  replacement by a single sidebar**, see the architecture section above.
- **Resource register, Phase 1** — a flat, scoped item list
  (`ResourceCategory`/`CategoryField`/`Item` in Postgres, `ItemScopeService`,
  `components/resources/RegisterPage.tsx`, the `components/data-table/**`
  engine). **This entire module is being deleted**, not extended — see the
  architecture section above and `~/.claude/plans/wait-i-want-gentle-haven.md`.
  It is listed here only as a record of what existed before the
  replatforming's Phase 1 (demolition) runs.

### Not yet done

Phases 0–6 of the resource-management replatforming plan
(`~/.claude/plans/wait-i-want-gentle-haven.md`) are complete: demolition of
the Phase-1 resource register; the full `temp_works`-derived Prisma data
model; the pure domain logic (`lib/domain/**`); the server-side scope,
write path, and full read/write API surface (`lib/server/resources/**`,
`app/api/resources/**`); the single-sidebar shell/navigation with
`WorkspaceKind` removed end-to-end; and the table engine — the register's
three views (hierarchy/rollup/search), the filter bar and the read-only
inspector on `@tanstack/react-table` 9.2.3, with Personnel re-tabled onto
the same engine and `components/data-table/**` deleted — see this file's
Phase 4–6 timeline entries above for what each covers. The register's
filter bar is core-fields-only for now (status/category/owner/current/
custodian), not the full generalised prop:/desc: rule engine the plan's
"two engines merge" language originally described — a disclosed, narrower
scope, recorded in full in the Phase 6 entry above. Approvals/Purchasing/
Change log are still `ComingSoon`; the register has no EDITING yet (browse/
filter/inspect only) — that is Phase 7.

Remaining, in phase order: the editing surface — inline commit, bulk
edit, confirmation rules (Phase 7); category administration's three-tab
editor (Phase 8); images — object storage, upload, thumbnails (Phase 9);
the change log view (Phase 10); access views (Phase 11); approvals
(Phase 12); transfers (Phase 13); procurement (Phase 14); the real ASTU
data import and demo seed (Phase 15); a final documentation pass
(Phase 16). **Bookings are explicitly deferred** to a later track — see
that plan's §2 for the specific defects in `temp_works`' booking model
that must be fixed, not ported, when that track starts.

### The resource module: superseded — replatforming onto `temp_works` in full

**This section describes a plan that is no longer being followed** — kept
for history, not as current direction. See the architecture section above
and `~/.claude/plans/wait-i-want-gentle-haven.md` for what actually happens
next.

The resource register's domain model was worked out in a sandbox first —
`D:/py_yaddessa/temp_works` (Next.js + Zustand + localStorage) — because
iterating a data model against Prisma migrations is slow. `Direction.md` in
this repo is its founding brief. A first architectural plan for landing it
(`~/.claude/plans/act-as-the-principal-hazy-thompson.md`'s appendix) treated
`temp_works` as a domain *reference*: adopt the core `Item`/category model,
but selectively defer or recreate access views, approvals, transfers,
procurement, and scheduling as later modules, and reject the sandbox's own
UI/store code outright. **Phase 1 of that plan landed** — a flat, scoped
`Item`/`ResourceCategory` register (see "Built so far" above for what it
was) — verified live across a SYS_ADMIN, two department heads and a
custodian, including at the raw network-payload level.

**That direction has been superseded.** The actual requirement is to bring
`temp_works`' functional surface across *whole* rather than selectively —
its register, categories, derived status, filters, hierarchy/rollup/search
views, inspector, inline and bulk editing, images, change log, access
views, approvals, transfers, and procurement — with only its stubbed
`Person`/`OrgNode`, its own auth, its org-reach re-derivation, and its
Zustand/localStorage persistence replaced by the production equivalents.
The Phase-1 flat register and the `DataTable` engine it used are being
**deleted**, not extended. Two decisions from the superseded plan remain
correct and carry forward into the new one:
- `currentOrgNodeId`/`ownerOrgNodeId` stay **NOT NULL**, defaulted to the
  owner at creation — the sandbox left them nullable and special-cased the
  fallback in two places; this schema does not need to.
- The sandbox's `README.md` claims a `NEVER`-impairment category can still
  be taken down by a critical child ("a lab is never impaired by its
  contents, but its switch rack is critical to it"). The algorithm
  (`status.ts`) does not implement that — `NEVER` ignores every child
  unconditionally, no exception. The seed data's own configuration
  (`Lab` = `ANY_CRITICAL` with an ordinary non-critical population and a
  `critical: true` switch rack; only `Store` is `NEVER`) is what actually
  produces "one dead switch takes the lab down," and it is what carries
  forward — not the README's sentence, which the sandbox's own test suite
  never exercised either (its fixture builds the lab as `NEVER`).

Bookings are the one `temp_works` module deliberately left behind for now
— see the architecture section above for the specific, verified defects in
its model that make porting it as-is the wrong move.

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

- **2026-09-02 (Phase 8)** — Full cutover acceptance pass (the plan's §9),
  no code changes needed. `npx prisma migrate status` clean against the same
  database (`prisma generate` hit a Windows file lock from the running dev
  server holding the query engine DLL — an OS/dev-workflow quirk, not a
  schema issue; the already-generated client, unchanged since Phase 3,
  already matches). Live in-browser: a full org-node lifecycle through Org
  Studio's UI — create (Office under Software Engineering), deactivate
  (custom `ConfirmDialog`, not a native one), reactivate, delete, each with
  the panel updating correctly and no console errors. Personnel: invited a
  test person through the UI, added a role via Manage, confirmed it
  persisted in the table. (Personnel's own deactivate button uses a native
  `window.confirm()` — ported verbatim from the original app, not a
  conversion artifact — which the browser-automation tool can't answer, so
  that action and node-parent-reassignment/assign-node were verified
  directly against the Route Handlers instead: deactivate, `PUT
  .../parents` reassignment, `assign-node`, and vacate (`nodeId: null`) all
  returned the correct status codes.) Confirmed a STAFF/CUSTODIAN session
  hitting the admin-only `POST /api/org/nodes` directly gets a real
  server-side 403, not just a hidden UI button. All test fixtures created
  during this pass were cleaned up afterward (deactivated/deleted) so the
  seed data is unchanged.

- **2026-09-02 (Phase 9)** — Deleted the obsolete npm-workspace
  architecture now that Phase 8's cutover acceptance pass was clean:
  `apps/api`, `apps/web`, `packages/shared`, `tsconfig.base.json`, and the
  `apps`/`packages` excludes in `tsconfig.json`/`vitest.config.ts` (added in
  Phase 1 to keep the two trees from interfering while they coexisted). A
  clean `npm install`, `tsc --noEmit`, `npm run build`, `npm test` (112
  tests), `npx prisma generate`, and `npx prisma migrate status` all
  succeeded with the old trees physically absent, confirming nothing was
  still depended on by path. The pre-conversion tree remains fully
  recoverable from the Phase 0 commit if ever needed.

- **2026-09-02 (Phase 10 / plan replacement)** — The Next.js-conversion
  plan's own Phase 10 (a documentation-only pass) was interrupted mid-run
  by a decision to replace the resource-management direction entirely,
  rather than finish documenting the superseded one. Reviewed both
  `lab_resource_v2` (the Phase-1 resource register that had landed) and
  `D:/py_yaddessa/temp_works` (the sandbox's now much larger functional
  surface — register, categories, derived status, filters, hierarchy/
  rollup/search views, access views, approvals, transfers, procurement,
  personnel, bookings, real-data imports) in detail, mapping every file in
  both trees. Wrote a full replacement plan —
  `~/.claude/plans/wait-i-want-gentle-haven.md` — that keeps auth/org/
  personnel/Org Studio exactly as they are, deletes the Phase-1 resource
  register and the `DataTable` engine entirely, and brings the
  `temp_works` functional surface across whole rather than selectively,
  reusing the current Tailwind 3.4 design system rather than adopting the
  sandbox's Tailwind 4/shadcn one. Key decisions made along the way: the
  4-workspace shell is replaced by `temp_works`' single sidebar plus a
  server-enforced access-view/scope model; `RoleKind` gains
  `STORE_KEEPER`/`EXTERNAL` so the sandbox's seeded views and policies land
  unmodified; and bookings are explicitly deferred to a later track after
  identifying six real defects in the sandbox's booking model (unlimited
  room sharing when no seat count is set, an uncapped-capacity room that
  can never clash, bookability inferred rather than configured, materials
  modelled as time windows instead of an allocation ledger, indefinitely-
  held pending slots, an in-memory double-booking guard, and a datetime-
  local timezone bug that silently shifts every class by 3 hours in
  Ethiopia). This update — updating `PROGRESS.md`'s stack/current-state/
  built/not-yet-done sections for the completed conversion and marking the
  old resource-register plan as superseded — is that new plan's own
  Phase 0.

- **2026-09-02 (replatforming Phase 1)** — Deleted the resource-register
  Phase 1 module in full: `lib/server/resources/**`, `app/api/resources/**`,
  `lib/shared/resources/**`, `lib/resources/**`,
  `components/resources/RegisterPage.tsx`, and the four workspace
  `register/page.tsx` files. Dropped the Prisma `CategoryGroup`/
  `ResourceCategory`/`CategoryField`/`Item` models and their four enums
  (plus the back-relations they had added to `User`/`OrgNode`) via a
  migration generated non-interactively — `prisma migrate dev` needs a TTY
  for its destructive-change confirmation, which is not available here, so
  the SQL was produced with `prisma migrate diff --from-url ... --to-schema-
  datamodel ...` against the live dev database, written into a normal
  timestamped migration directory, and applied with `prisma migrate
  deploy`. `prisma/seed.ts` lost its demo Lab category and 3 seeded labs;
  its org/personnel fixture (2 colleges, 2 departments, department heads,
  custodians) is untouched and was re-seeded afterward.

  `lib/nav.ts` keeps its 4-workspace scaffolding for now (Personnel/Org
  Studio/Dashboard/Profile still render inside it — full removal is
  replatforming Phase 5) but lost every Register nav entry;
  department/approver/custodian now carry no items beyond the "You"
  (Profile) group they always had.

  Verified: `npm run build` (22 routes, no resource paths — a stale
  `.next/` build-type cache briefly surfaced phantom errors for the
  deleted routes, resolved by clearing it), `npm test` (103 tests, down
  from 112 — the 9 deleted `item-scope.logic.spec.ts` cases), `npx prisma
  migrate status` clean. Live in-browser: signed in as SYS_ADMIN (dashboard
  renders, seed counts correct: 5 org nodes, 5 people), a department head
  (`head.se@astu.edu.et`, lands on Profile with the correct scope shown),
  and a custodian (`custodian.se@astu.edu.et`, same) — no console or
  server errors, no stray requests to the deleted routes.

- **2026-09-02 (replatforming Phase 2)** — Landed the full temp_works-derived
  resource data model and its Zod contracts, in three parts.

  Part 1: RoleKind grew from 7 to 9 values (STORE_KEEPER, EXTERNAL),
  applied as an additive Postgres enum migration with no destructive-
  change prompt needed. Rippled into ScopeService.canSeeCost (a store
  keeper reads the cost a purchase order was raised for), auth.ts's
  workspacesFor (STORE_KEEPER grouped with PROPERTY_ADMIN/PROCUREMENT
  — university-wide reach by role), and PersonnelPage.tsx's local
  role list.

  Part 2: the full Prisma schema for categories (ResourceCategory,
  CategoryField, CategoryTemplateChild — the default-subtree
  instantiation the old Phase 1 module never had), items (Item
  unchanged from the deleted Phase 1 shape, ItemImage, ItemChange as
  an append-only audit log with no FK to Item), access views
  (AccessView + AccessViewAudience), approvals (ApprovalPolicy,
  ChangeRequest with a payload Json column holding the exact
  ItemChangeInput verbatim, ChainStep with a real StepSelectorType
  enum column rather than a string), and procurement (NeedLine,
  PurchaseRequest, PurchaseLine, PurchaseEvent). Three migrations: the
  additive schema itself, a GIN (jsonb_path_ops) index on Item.props
  (expressible directly in Prisma's DSL, stable since Prisma 5), and
  the two CHECK constraints Prisma's DSL cannot express at all
  (SERIALIZED => qty=1 / BULK => qty>=0, and no-self-parent) — applied
  via `prisma db execute` against the live dev database and recorded
  with `prisma migrate resolve --applied` rather than replayed. A
  throwaway functional smoke test (deleted after) confirmed all of it
  live: a valid insert succeeds, a bad SERIALIZED qty is rejected, a
  negative BULK qty is rejected, a self-parent update is rejected, and
  a GIN-indexed jsonb containment query finds a written prop.

  Part 3: lib/shared/resources/** — Zod contracts mirroring the new
  Prisma models. item.ts's ItemChangeInput is the one worth
  remembering: a proper Zod discriminated union on `kind` (stronger
  than temp_works' own loosely-typed shape), each of the 13
  item-targeted variants carrying only the fields that kind actually
  uses. A throwaway runtime smoke test (tsx, deleted after) parsed 37
  representative payloads through every new schema to catch what
  `tsc` alone can't — a mismatched `z.literal` string against the
  actual enum values.

  Verified throughout: `npx tsc --noEmit` clean, `npm test` (103
  tests, unchanged — this phase is schema/contracts only), `npm run
  build` (still 22 routes), `npx prisma migrate status` clean at each
  step. This closes out replatforming Phase 2.

- **2026-09-03 (replatforming Phase 3)** — Ported the pure domain logic from
  `temp_works` into `lib/domain/**`, essentially verbatim, with its own internal
  type vocabulary (`types.ts`) kept separate from both the Prisma schema and
  `lib/shared`'s wire DTOs — the same pattern
  `lib/server/org/closure-algorithm.ts` already uses for its own
  ClosureEdge/ClosureRow pair.

  Ported near-verbatim, each with its test file: `status.ts` (derived
  impairment), `tree.ts` (the three row shapes and cluster aggregation),
  `filters.ts` (the query engine — one adaptation: `buildFilterFields` now
  requires `orgNodes`/`people` instead of defaulting to a seed module,
  since production has no fixture to fall back to), `instantiate.ts`
  (category-to-subtree instantiation — `temp_works` had no test for this;
  wrote one fresh), `edit-impact.ts` (the blast-radius preview),
  `approvals.ts` (policy resolution and chain building, including
  `SEED_POLICIES`), `views.ts` (access-view resolution, including
  `SEED_VIEWS`), `icons.ts` (the curated icon registry + fallback — its
  React wrapper component is deferred to whichever UI phase first renders
  one).

  One new module, not a straight port: `org-chain.ts`. `temp_works`'
  `approvals.ts` needs to walk an approval chain upward through
  `org.ts`'s `indexOrg`/`ancestorsOf`/`OrgIndex` — but `org.ts` as a
  whole is rejected (its `visibleNodeIds`/`ownNodeId` genuinely duplicate
  ScopeService). Rather than re-deriving that BFS a second time,
  `org-chain.ts` is a thin adapter over the already-shipped
  `closure-algorithm.ts` (`computeClosureRows` — the identical
  `{ancestorId, descendantId, depth}` row shape), giving `approvals.ts` the
  same `OrgIndex`/`ancestorsOf` contract `temp_works` wrote against. That
  is what let `approvals.ts` and its 45-test spec port with only an
  import-source change.

  Deliberately narrower than a full module port, per the plan's own
  scoping: `purchasing.ts` brought over only its pure functions
  (`canRaiseNeed`, `lineTotal`, `nextStage`, ...) — its own test file
  exercises the Zustand store's stateful actions end to end, none of which
  calls these functions directly, and that write path becomes a server
  module in a later phase; wrote a fresh, focused spec for the pure
  functions instead. `item-scope.ts` brought over only `unitsOf`/
  `withAncestors` — `scope.ts`'s `scopedItemIds`/`defaultScopeFor`
  operate over an already-loaded item array, which production must NOT do
  (`ItemScopeService` becomes a Prisma `where`-builder applying scope in
  SQL before pagination in Phase 4, not this shape); same treatment, a
  fresh focused spec.

  Explicitly not ported: `org.ts`'s `visibleNodeIds`/`ownNodeId`/
  `validateOrg` (ScopeService's job), `personnel.ts` (PeopleModule's
  job), `store.ts`'s Zustand write path (becomes
  `lib/server/resources/mutate.ts` later), `booking.ts` (the deferred
  track).

  Test fixture (`lib/domain/__fixtures__/seed.ts`, test-only, never
  imported from `lib/server/**` or `components/**`): `temp_works`'
  ORG_NODES/PEOPLE/SEED_CATEGORIES ported verbatim minus the
  `...REAL_PEOPLE`/`...REAL_CATEGORIES` spreads (real ASTU import data,
  landing with the Phase 15 importer instead).

  Also added `lucide-react` 1.34.0 (exact pin, matching `temp_works`'
  resolved version) and `vitest.config.ts`'s `@/*` alias (mirroring
  `tsconfig.json`'s own path mapping — the first specs needing
  cross-directory absolute imports).

  One correctness addition beyond a straight port: `status.spec.ts` adds
  the "NEVER ignores a critical child" case `temp_works`' own suite never
  exercised (its fixture built a NEVER category differently from the
  seed's actual configuration) — see this file's earlier note on why the
  seed's behaviour is authoritative, not the sandbox README's
  now-superseded sentence.

  Verified: `npx tsc --noEmit` clean, `npm test` — 222 tests across 14
  files (109 new domain tests, the 113 pre-existing ones unmodified and
  still passing), `npm run build` clean (still 22 routes — this phase
  adds no new API/UI wiring, only the logic layer beneath one).

- **2026-09-03 (replatforming Phase 4)** — Server-side resource scope, the
  single mutation path, category/property validation, change logging, and
  every resource read/write Route Handler. No UI wiring — that starts at
  Phase 5 (shell/navigation) and Phase 6 (the register views that actually
  render this data); this phase proves the API layer is correct and secure
  on its own.

  `lib/server/resources/**`, each following the same pure-logic/Prisma-glue
  split `lib/server/org/closure-algorithm.ts` and the (now-superseded)
  Phase-1 `item-scope.ts` already established:
  - `item-scope.logic.ts` (+ 13-case spec) — the pure `Prisma.ItemWhereInput`
    builder over four `ScopeMode`s (UNIVERSITY/ORG_SUBTREE/MY_CUSTODY/
    EXPLICIT_NODES), extended past the deleted Phase-1 version with the
    `explicitNodeIds`/`extraGrantedIds` seams AccessView (Phase 11) and
    approval grants (Phase 12) will plug into later, without another
    rewrite.
  - `scope.ts` — `ItemScopeService`: `visibleItemWhere` (the SQL predicate,
    with a recursive-CTE custody resolver ported from the deleted Phase-1
    module), `resolveScope`, and two DELIBERATELY different point-checks
    found necessary during live testing (see below) — `canSeeItem`
    (ancestor-inclusive, for reads) and `assertCanWriteItem` (direct scope
    only, for anything used as a write target).
  - `template-cycle.ts` (+7-case spec) — cycle detection over the category
    default-subtree graph, the same shape as `closure-algorithm.ts`'s
    `wouldCreateCycle` but for `CategoryTemplateChild` edges.
  - `category-props.ts` (+11-case spec) — compiles `CategoryField` rows into
    a Zod schema per write, so `Item.props` is never written unvalidated;
    kept pure (no `server-only`) since it operates on already-loaded rows.
  - `adapt.ts` — the one Prisma-row ↔ `lib/domain` translation point, used
    by every other module here rather than each hand-rolling it.
  - `categories.ts` — full CRUD, `expectedVersion` optimistic concurrency
    (409 `VERSION_CONFLICT`), `purgeKeys` (raw-SQL JSONB key removal, opt-in
    and audited), counting-mode rewrite (denormalised `Item.countingMode`
    kept in sync, `qty` forced back to 1 on BULK→SERIALIZED), one
    `ItemChange` line per genuine alteration (`describeCategoryEdit`, ported
    verbatim), and the impact-preview endpoint over `lib/domain/edit-impact`.
  - `changes.ts` — deliberately narrow: change history for ONE item only
    (`GET /items/:id/changes`), scope inherited from the item-level check
    already run. A global, filterable change-log browse view is Phase 10,
    not this one — an entry for a since-deleted item has no live row left
    to scope-check against.
  - `mutate.ts` — `applyChange`/`previewChange`, the one write door for all
    13 `ItemChangeInput` kinds (`editCategory` excluded — that is
    categories.ts's own endpoint). Ported from `store.ts`'s
    `validate`→`apply`→log→bump-version, inside one Prisma transaction;
    `previewChange` runs the identical path and throws a sentinel to roll
    back instead of committing. Authorization runs before the transaction
    opens, against committed state.
  - `items.ts` — the read model. Loads the WHOLE undeleted item forest per
    request and runs `computeStatuses`/`indexItems` over ALL of it, per
    `lib/domain/status.ts`'s own contract ("must never be called against a
    caller's scoped item set... scope the RESULT, not the input") — then
    `ItemScopeService` decides which of those globally-computed rows a
    given response may include. `search()` returns direct matches only,
    paginated; `tree()` returns the same rows ancestor-AND-descendant
    closed (`expandMatches`), unpaginated, meant for
    `buildTree`/`buildRollup` to run over CLIENT-side (`lib/domain/tree.ts`
    is explicitly written to run in the browser too) — one endpoint serves
    both the Hierarchy and Rollup view modes, since the underlying data is
    identical and only the client-side grouping differs. `facets()`/
    `filterFields()`/`summary()` round out the read surface.

  Two wire-contract gaps closed, both additive to the Zod schemas Phase 2
  had already landed (`lib/shared/resources/item.ts`'s `ItemRowDto`):
  `effectiveStatus` (the schema only carried the STORED status, but the
  entire point of the domain status engine is the DERIVED one) and
  `readOnlyContext` (the plan's own scope.ts design note — "ancestor
  closure is added back by the tree query and marked `readOnlyContext` in
  the DTO" — had no field to carry it).

  One pre-existing bug surfaced and fixed while wiring the first schema
  with `.default(...)` fields (`CreateCategoryInput`/`UpdateCategoryInput`):
  `lib/server/validate.ts`'s `parseBody<T>(schema: ZodSchema<T>, ...)`
  inferred `T` against Zod's Input type parameter, not Output — invisible
  until a schema's input and output diverged, since every prior schema in
  the app happened not to. Fixed by binding the generic to the schema
  itself and returning `z.output<T>`; every existing call site was
  unaffected since Input=Output for all of them.

  Deletion semantics extended into two modules Phase 4 doesn't own, both
  named explicitly in the original plan (§5): `lib/server/org/org.ts`'s
  `deleteNode` gained two blockers (owns/holds resources) it needed the
  moment `Item.ownerOrgNodeId`/`currentOrgNodeId` existed as `onDelete:
  Restrict` foreign keys, or a delete would have surfaced as a raw
  uncaught Prisma error instead of a named one; `lib/server/people/
  people.ts`'s `deactivate` gained a custody blocker (`Item.custodianId`
  is NEVER null — custody hands off, it never lapses) so disabling a
  custodian can no longer silently strand accountability for what they
  hold.

  **Two real authorization bugs found and fixed during live verification**
  (not by inspection — both were caught testing the actual write paths):
  1. `moveInTree`/`transferItem` validated that the ITEM being moved was in
     scope, but never checked the DESTINATION — a ChemE department head
     was able to move their own item to become a physical child of SE's
     lab with no visibility into SE's lab at all. Fixed by adding
     `scope.assertCanWriteItem` on the target parent/`targetParentId` for
     both kinds, using a NEW direct-only (non-ancestor-inclusive) point
     check — reusing the read-oriented `canSeeItem` here would have let
     "read-only context" visibility (seeing a container only because it
     holds something of yours) double as permission to write into it.
  2. Once that nesting existed (created before the fix above), deleting or
     transferring the OUTER item's subtree swept up the foreign nested
     item too — `deleteItem`/`transferItem` walk the whole physical
     subtree by `parentId`, which does not stop at scope boundaries. SE's
     department head deleting their own lab silently deleted ChemE's item
     nested inside it. Fixed with `assertSubtreeInScope`, a whole-subtree
     scope check (refusing the entire operation, not silently skipping the
     foreign row) run before either function starts mutating.

  A third, non-security bug: `setQuantity`'s no-op skip (`if (before ===
  value) continue`) compared a Prisma `Decimal` against the wire input's
  plain `number` — never equal by reference, so re-applying the same
  quantity always bumped `version` and wrote a redundant change-log line
  instead of being recognised as a no-op. Fixed by normalising both sides
  to a number before comparing.

  Verified: `npx tsc --noEmit` clean; `npm test` — 253 tests (31 new: 13
  item-scope.logic, 7 template-cycle, 11 category-props); `npm run build`
  clean (15 new resource routes, 37 total). Live, via `curl` against a
  running dev server signed in as SYS_ADMIN, both department heads and the
  SE custodian (mirroring Phase 1's own verification approach): created a
  category and items through the real write door; confirmed the raw
  response bodies of `GET /api/resources/items` (search) for both
  department heads never mention the other's node id or item id; confirmed
  `GET /api/resources/items/:id` 404s (not 403) on an out-of-scope id and
  the write door 404s the same way on a cross-department edit attempt;
  confirmed a non-admin session hitting `POST /api/resources/categories`
  gets a real 403; confirmed `MY_CUSTODY` scope, `tree`, `summary`,
  `filter-fields`, `facets`, category `expectedVersion` conflict (409) and
  the impact-preview endpoint all behave correctly; found and fixed the
  two authorization bugs and the `setQuantity` bug above through this same
  pass. All test fixtures (category, group, items) were deleted afterward
  through the real API/a throwaway script, confirmed empty via a final DB
  count — except 15 `ItemChange` rows, which the schema deliberately keeps
  even after their item is gone (no FK to `Item`, by design) and whose
  bulk cleanup this session's own safety classifier declined to run
  unsupervised; left in place as harmless test noise rather than retried
  around.

- **2026-09-03 (replatforming Phase 5)** — The single sidebar replaces the
  four-workspace shell. `WorkspaceKind` removed end-to-end: `lib/shared/
  enums.ts` (the enum itself), `lib/shared/auth.ts` (`MeContextDto` lost
  `workspace`/`availableWorkspaces`, gained `scopeMode` — resolved via
  `lib/server/resources/scope.ts`'s `defaultModeFor`, reusing Phase 4's
  scope service rather than re-deriving it — and `views`, an
  `AccessViewSummaryDto[]` that stays empty until Phase 11 seeds real
  `AccessView` rows), `lib/server/auth/auth.ts` (`workspacesFor()` deleted
  outright), `lib/nav.ts` (collapsed from a
  `Record<WorkspaceKind, NavGroup[]>` to one flat `NavGroup[]`, `navFor`/
  `canAccessPath`/`screenKeyForPath`/`landingPathFor` all lost their
  workspace parameter), `components/RequireRole.tsx`, `components/shell/
  Sidebar.tsx` (workspace switcher removed; scope panel gained the
  resolved `scopeMode` label via `lib/domain/views.ts`'s `SCOPE_LABEL` —
  imported straight into a client component, proving out that module's
  own "runs in the browser too" design — and an access-view `<select>`
  that degrades to nothing while `views` is empty), `components/shell/
  TopBar.tsx` (workspace-switcher pills deleted; `pendingCount` prop
  dropped with them — nothing read it once the pills that displayed the
  approvals badge were gone), `app/(workspace)/layout.tsx`, `app/page.tsx`,
  `app/(auth)/login/page.tsx`.

  Six new top-level routes under `app/(workspace)/**`, matching the plan's
  decision #2 nav list exactly: `/dashboard`, `/register`, `/approvals`,
  `/purchasing`, `/change-log`, `/categories`, visible to every signed-in
  role (no `roles` gate) — "what differs per person is their access view
  and server-enforced scope, not their menu." Administration (Personnel +
  Org Studio, plus the pre-existing org/people admin Overview) keeps its
  real role gates (`SYS_ADMIN` for Overview/Org structure, `SYS_ADMIN`/
  `MANAGER` for People & roles) as `roles` on the nav items themselves,
  since nothing above them enforces that any more once workspaces are
  gone.

  Two of the six get real content now rather than a placeholder, because
  Phase 4's API already supports them and the alternative was leaving
  working, tested endpoints completely unused by any UI:
  - **Dashboard** (`components/resources/DashboardPage.tsx`) — stat tiles
    over `GET /api/resources/items/summary`: total in scope, needs
    attention, a by-effective-status grid. Promoted `SummaryDto` from a
    private `items.ts` interface into a proper Zod contract
    (`ItemSummaryDto` in `lib/shared/resources/item.ts`) so a client
    component could import its type at all — `lib/server/resources/
    items.ts` carries `import "server-only"` and cannot be imported from
    client code the way a plain TS interface tempted.
  - **Categories** (`components/resources/CategoriesPage.tsx`) — a
    read-only list over `GET /api/resources/categories`: name, key, group,
    counting mode, field count, active flag. The three-tab admin editor
    (create/edit/impact preview) is still Phase 8; this only proves the
    read path and gives everyone the shared vocabulary view categories are
    meant to be.

  Register/Approvals/Purchasing/Change log share one `ComingSoon`
  component, named honestly rather than hidden — each names what already
  exists underneath it (the read API, the domain policy/chain logic,
  per-item change history) and which later phase builds the screen.

  Verified: `npx tsc --noEmit` clean; `npm test` 253/253 (unchanged — this
  phase is shell/nav/UI, no new pure logic); `npm run build` clean (36
  routes, +6). Live in-browser across three seeded accounts (SYS_ADMIN,
  the SE department head, the SE custodian): each lands on Dashboard with
  correct real data; the scope panel shows the right `scopeMode` label per
  account ("University-wide" / "My unit and below" / "In my custody");
  Administration correctly shows all three items for SYS_ADMIN, only
  "People & roles" for the MANAGER, and is absent entirely for the
  CUSTODIAN (empty groups drop, per `navFor`'s own rule); a CUSTODIAN
  typing `/admin/people` directly gets `RequireRole`'s real refusal
  screen, not the page. Also caught and fixed, mid-verification, a
  Windows dev-workflow issue distinct from any app bug: running `npm run
  build` while `next dev` was still serving the same `.next/` directory
  left the dev server's route manifest in a state where every navigation
  silently stuck on `/login` (`GET`s all returned 200, but nothing ever
  redirected) — a clean `preview_stop`/`preview_start` cycle resolved it
  outright; noted here since it will recur if a build is run alongside a
  live dev server again. `npm run build` itself is now run only after
  stopping the dev server, not alongside it.

- **2026-09-03 (replatforming Phase 6)** — The table engine, the register's
  three views, the filter bar and the inspector — on `@tanstack/react-table`
  9.2.3, pinned exactly as the plan specified. Personnel migrated onto the
  same engine, and `components/data-table/**` (2,793 lines: the whole
  custom filter-logic/URL-state/faceted-filter engine) is deleted.

  **A deliberate, disclosed scope reduction from the plan's own words.**
  Section 6's "two filter engines merge in Phase 6" meant the FULL
  generalised `ItemFilterState` (prop:/desc: synthetic per-category fields,
  14 operators, AND/OR joins) actually travelling over the wire. What
  shipped instead: the register's filter bar uses the CORE fields only
  (status/category/owner/currentOrg/custodian, plus free-text search) —
  exactly what Phase 4's `items.ts` `ItemQuery`/`parseItemQuery` already
  accepted, so no server-side change was needed to wire it up. The full
  merge (prop:/desc: fields, the wider operator set) is still open;
  `lib/domain/filters.ts`, `lib/shared/resources/item-filter.ts` and
  `items.ts` all now say so explicitly where they used to point at the
  (now-deleted) old engine.

  `lib/register/**` — the client-side half, deliberately thin per the
  plan's own note ("its implementation thins out once scope, filtering,
  sorting, pagination and facet counts are server-side"): `adapt.ts`
  (`ItemRowDto` → the domain `Item` shape `lib/domain/tree.ts` is written
  against — that module's header says it is meant to run in the browser
  too, and this is the client half of proving that true) and
  `useRegisterState.ts` (mode/filter/page state, URL-persisted, fetching
  from `/api/resources/items/tree` for Hierarchy/Rollup and
  `/api/resources/items` — paginated — for Search, then shaping the result
  into `RowNode[]` via `buildTree`/`buildRollup`/`buildSearchList`, the
  exact same pure functions the server's own design assumed would be
  reused here).

  `components/resources/**` — `ResourceTable.tsx` (the v9 table: explicit
  `tableFeatures` registration, `table.FlexRender` as a component on the
  table instance rather than v8's standalone `flexRender`, cluster-row
  aggregation via `lib/domain/tree.ts`'s `aggregate`/`describeAgg` — all
  read-only, since inline/bulk editing is Phase 7), `FilterBar.tsx`,
  `Inspector.tsx` (a read-only detail modal: specs, path breadcrumb, and
  per-item change history via the Phase-4 `/changes` endpoint — the first
  UI consumer of that endpoint), `StatusChip.tsx` (STATUS_TONE's full
  good/warn/bad/cross/dim/faint vocabulary — wider than `ui.tsx`'s `Tag`,
  which is why it isn't a `Tag` wrapper), `RegisterPage.tsx` (the
  Hierarchy/Rollup/Search mode toggle). `/register` now serves this
  instead of the Phase-5 placeholder.

  `components/people/PeopleTable.tsx` — Personnel's replacement table.
  Filtering (search/role/status) is plain component state narrowing the
  array before it ever reaches TanStack, not a ported `filter-logic.ts`;
  search stays URL-persisted (`?people_q=`, matching the exact behaviour
  Phase 7 of the original Next.js conversion had already verified) while
  role/status stay local — this register is small enough that losing them
  on reload costs nothing. `PersonnelPage.tsx` updated accordingly; its
  modals/forms/actions are otherwise untouched.

  **One real v9 bug found and fixed during live verification**: a `<th>`
  click did nothing, no sort arrow, no reorder. Root cause —
  `rowSortingFeature`'s `getCanSort()` hard-requires
  `!!column.accessorFn` (`rowSortingFeature.utils.ts`), so a `.display()`
  column can NEVER be sortable no matter what `sortFn` it carries, unlike
  v8. The type error that had originally pushed every PeopleTable column
  to `.display()` (mixing `.accessor()` and `.display()` in one array
  literal fails to unify their `Value` generics) had to be solved a
  different way instead: the four sortable columns stayed `.accessor()`,
  each individually cast to `ColumnDef<typeof features, PersonDto,
  unknown>` to satisfy the array literal. Confirmed live: clicking "Name"
  now shows the ↑ indicator and genuinely reorders the five seeded people;
  a second click reverses it.

  Verified: `npx tsc --noEmit` clean; `npm test` — 159 tests (94 fewer
  than Phase 5's count, exactly the deleted data-table engine's own
  `filter-logic.spec.ts` (72) + `url-state.spec.ts` (22)); `npm run build`
  clean (36 routes, same count as Phase 5 — this phase fills in existing
  placeholders rather than adding new ones). Live in-browser, signed in as
  the SE department head with a real two-level hierarchy seeded through
  the actual write door (a Lab containing 5 Computers, to force cluster
  grouping): Hierarchy mode showed the Lab, expanding to a "Computer ×5"
  cluster row with correctly aggregated status/qty/custodian/owner,
  further expanding to the five individual rows; Rollup mode grouped the
  same subtree by category one level down; Search mode listed all six
  rows flat with a Location column; clicking an item opened the Inspector
  with its real detail and change history ("Add resource" logged against
  it). Confirmed the done-when criterion directly: set `mode=flat` and a
  category filter via the UI, captured the resulting URL, reloaded it cold
  — same mode, same filter, same single row. Signed in as SYS_ADMIN and
  repeated the equivalent check on Personnel: searched "Girma", confirmed
  `?people_q=Girma` in the URL, reloaded cold, got the same one-row result
  back. All test fixtures (2 categories, 6 items, 1 category group)
  deleted afterward through the real API/a throwaway script.

## Working agreements for this project

- Never spawn subagents (global CLAUDE.md rule) — do everything inline.
- Update this file's Timeline section after each round of changes, and keep
  the "Current state" / "Decisions" sections in sync when they change —
  don't let this doc drift from what's actually in the code.
- Be cautious about live-testing mutations in the browser when there's
  evidence the user is concurrently using the app themselves (watch for org
  data changing that this session didn't cause).

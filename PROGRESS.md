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

Seed data (rewritten 2026-09-22/23, fix round Phase C). The chain is `prisma/seed.ts`
→ `prisma/resource-seed.ts` → `prisma/seed-policies.ts --apply`:
- **Org:** ASTU → CoEEC → {SE, CSE}; ASTU → CoMCME → ChemE; ASTU → Procurement Office
  (active).
- **Role accounts** (placeholders to rename later): `avp@`, `coeec.dean@`, `cse.head@`,
  `se.head@`, `procurement@`, `store.keeper@astu.edu.et`. ChemE keeps `head.chem@`,
  `custodian.chem@` and its 3 real lab responsibles. All passwords are `astu1234`.
- **Data:** the 17 real CSE ARAs and their 31 labs (`prisma/cse-lab-data.ts`, from
  `docs/cse_labs.md`), current state only. CSE drafts are ON. ChemE's real data, and the
  ASTU Main Store (the store keeper's).
- **No ideals are seeded.** Custodians propose them on Lab states.
- **Mail:** 11 ARAs carry real addresses, so notification-triggering tests belong on the
  E2E clone (:3100, mail sink), never the dev DB with real SMTP.

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

Phases 0–7 of the resource-management replatforming plan
(`~/.claude/plans/wait-i-want-gentle-haven.md`) are complete: demolition of
the Phase-1 resource register; the full `temp_works`-derived Prisma data
model; the pure domain logic (`lib/domain/**`); the server-side scope,
write path, and full read/write API surface (`lib/server/resources/**`,
`app/api/resources/**`); the single-sidebar shell/navigation with
`WorkspaceKind` removed end-to-end; the table engine — the register's
three views (hierarchy/rollup/search), the *full* filter bar (prop:/desc:
synthetic fields, the whole operator set, AND/OR composition — not core
fields only, see the Phase 6-filtering-gap entry) and the editable
inspector on `@tanstack/react-table` 9.2.3, with Personnel re-tabled onto
the same engine and `components/data-table/**` deleted; and the editing
surface itself — inline commit for corrections, a shared confirmation step
for consequential single- and bulk-edits, adding resources, bulk property
editing, and item-level optimistic version-conflict handling, plus an
audited and now-explicit write-role policy (only SYS_ADMIN or an item's own
custodian may write; every other role reads and, once Phase 12 exists,
approves) — see this file's Phase 4–7 timeline entries above for what each
covers. Approvals/Purchasing/Change log are still `ComingSoon`. A handful
of Phase 7 UI affordances are deliberately deferred, not missing
capability — see that entry's own "disclosed scope trims" note (no literal
per-table-cell inline editing, no dedicated bulk-quantity control, the
Move/Position picker only offers currently-loaded rows as destinations).

Remaining, in phase order: category administration's three-tab editor
(Phase 8); images — object storage, upload, thumbnails (Phase 9); the
change log view (Phase 10); access views (Phase 11); approvals (Phase 12);
transfers (Phase 13); procurement (Phase 14); the real ASTU data import and
demo seed (Phase 15); a final documentation pass (Phase 16). **Bookings
are explicitly deferred** to a later track — see that plan's §2 for the
specific defects in `temp_works`' booking model that must be fixed, not
ported, when that track starts.

**This paragraph is now stale** — Phases 8 (Category Studio), 9 (images) and
10 (change log) are all done (see the Timeline below for each). More
significantly, **the phase-by-phase order above stopped being the active plan
on 2026-09-04**: the user re-prioritized around three concrete deliverables
needed to actually ship — creating a resource at all (which was completely
broken), a university-wide read-only browse, and Vercel deployment — tracked
as Phase 10a/10b/10c/hardening/deploy in
`~/.claude/plans/three-product-changes-dynamic-thompson.md`. Phase 11
(access views) and everything below it in the old list wait until after that
ships. See that plan file and this Timeline's 2026-09-04 entries for what is
actually happening now.

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

- **2026-09-03 (Phase 6 seed-and-verification checkpoint)** — Landed the
  uncommitted Phase 6 checkpoint that had accumulated on top of the Phase 6
  commit: `prisma/resource-seed.ts` (a `seed:resources` package script), a
  flat-Search correction, filter-bar search debouncing, and an Expand/Collapse
  All control.

  **The flat-Search correction** (`lib/server/resources/items.ts`'s
  `search()`): was returning the ancestor-closed set (`closed`, from
  `computeScopedIds`) filtered by the match predicate, so Search — meant to be
  the intentionally flat view, direct matches only — was silently including
  read-only ancestor context rows that only matched because a descendant of
  theirs matched. Now filters `base` (direct scope, unclosed) instead, and
  every returned row is hardcoded `readOnlyContext: false` since that
  distinction belongs to `tree()` (Hierarchy/Rollup), not `search()`.

  **The representative development seed** (`prisma/resource-seed.ts`) is the
  first real data this replatforming has loaded past the department-head/
  custodian scoping fixture: 5 category groups, 21 categories (with 14
  `CategoryTemplateChild` default-subtree edges — Setup→Computer→Motherboard→
  RAM/Storage/GPU, Switch Rack→Network Switch/Outlet), 134 items across 4
  physical roots (SE Lab with 7 workstation setups + a switch rack, ASTU Main
  Store, a Chemical Engineering lab, a Chemical Engineering store with bulk
  chemicals and glassware), and 14 "on loan" rows (`ownerOrgNodeId <>
  currentOrgNodeId`) — SE's 7th workstation subtree physically relocated into
  Chemical Engineering's lab while SE retains ownership and custody. Seeded
  status stories exercise derived impairment at one, two and three levels of
  nesting, `ANY_CRITICAL`'s discrimination (a broken non-critical mouse
  changes nothing), and `NEVER` truly ignoring a critical child (a chemical
  marked `critical: true` AND fully consumed — Store stays healthy). Built via
  `lib/domain/instantiate.ts`'s `buildSubtree`/`instantiateMany` — the exact
  functions the live "Add N × category" write path calls — so seeded items
  have the identical shape one created through the app would have; the
  Prisma-row mapping `lib/server/resources/mutate.ts` normally does after
  instantiation is duplicated locally in the seed script since that module's
  `import "server-only"` guard throws outside a bundler.

  **Hardened before finalizing, per this session's own audit**: the script
  already refused to run under `NODE_ENV=production`; added a second guard
  (`assertSafeToReset()`) that refuses to wipe-and-rebuild categories if
  `AccessView`, `ApprovalPolicy`, `ChangeRequest` or `NeedLine` hold any rows
  — those either embed a `categoryId` in a plain Json field with no FK behind
  it (`AccessView.extraFilters`, `ApprovalPolicy.appliesTo`,
  `ChangeRequest.payload`) or otherwise depend on category ids surviving a
  reset, and a rebuild mints fresh cuids every run. Verified live: created a
  throwaway `AccessView` row, confirmed the script refuses with a clear
  message and exit code 1, deleted the row, confirmed the script runs clean
  again. None of Phase 11/12/14 (access views/approvals/procurement) has
  landed yet, so all four tables are genuinely empty in dev today — this
  guard exists so a future phase can't silently corrupt those tables by
  forgetting this constraint, not because it fired on real data. The real
  ASTU importer (Phase 15) remains keyed by `(sourceSystem, sourceKey)` and
  non-destructive, unaffected by any of this.

  Verified: `npx tsc --noEmit` clean; `npm test` 159/159 (unchanged — no
  logic touched, only the seed script and two small UI/read-path fixes);
  `npx prisma migrate status` clean, still 7 migrations. Ran the seed script
  twice consecutively — identical counts both times (21 categories, 134
  items, 14 loaned rows, confirmed against the live database directly, not
  just the script's own console output), confirming wipe-and-rebuild
  idempotency with no duplicates. `.scratch/` (API captures and session-
  cookie jars from the live verification that produced this checkpoint,
  pre-existing when this session started) is now covered by `.gitignore`
  rather than removed outright, since nothing in the working tree referenced
  it and its cookie contents were never read or exposed by this session.

  **The seed's place in the plan moved up**: it originally belonged with
  Phase 15 ("real-data import + seeds"). It now lands here, at the Phase 6
  checkpoint, as representative development/demo data — closer to what
  `temp_works`' own seed was for. Phase 15 is unchanged in scope: it still
  means the real ASTU import (idempotent, keyed by stable source
  identifiers, non-destructive) and whatever final production-oriented seed
  work that phase needs; it does not need to reintroduce this dev fixture.

  **The disclosed Phase 6 filtering gap remains open as of this entry** — see
  the next timeline entry for its resolution, tracked separately since it is
  substantial enough to warrant its own verification pass.

- **2026-09-03 (Phase 6 filtering gap closed)** — Closed the disclosed gap from the
  Phase 6 commit's own entry above: the register's filter bar had wired only the core
  fields (status/category/owner/currentOrg/custodian) into `items.ts`'s `ItemQuery`,
  not the full `lib/domain/filters.ts` engine those core fields sit on top of —
  prop:/desc: synthetic fields, its whole operator set, several rules per field,
  AND/OR composition.

  **The wire and domain filter shapes are now one shape, not two.**
  `lib/shared/resources/item-filter.ts`'s `ItemFilterState`/`ItemFilterRule` used to be
  a separate `{id, op, v}` triple inherited from the deleted `components/data-table`
  engine, with a 14-operator vocabulary `lib/domain/filters.ts`'s `matchRule` never
  actually implemented (only 7 of them — `matchRule` exhaustively switches over
  exactly those 7, no `default` branch, so the other 7 —
  `notContains`/`eq`/`ne`/`lt`/`gt`/`isBetween`/`isRelativeToToday` — were dead
  vocabulary carried forward from a deleted engine, not a gap to fill). Restructured
  `ItemFilterRule` to `{id, field, op, values}` — structurally identical to the domain
  `FilterRule` — and trimmed `filterOperators` to the 7 real ones, so a rule built by
  the toolbar, the advanced builder, or a future stored `AccessView.extraFilters` row
  (Phase 11) all speak one shape with no adapter step. Added `join: "and"|"or"` to
  `ItemFilterState` (default `"and"`) since AND/OR composition was named in the gap
  explicitly.

  **Server side** (`lib/server/resources/items.ts`): `ItemQuery` gained
  `rules?: FilterRule[]` and `join?: "and"|"or"`, additive to the five existing core
  fields (which stay their own readable query params rather than folding into `rules`
  — a shareable `?categoryId=x&status=WORKING` URL reads better than JSON for the
  common case). `parseItemQuery` parses a `rules` query param as JSON, Zod-validates it
  against `ItemFilterRule`, and treats anything unparseable or schema-invalid as
  absent rather than a 400 — a malformed filter degrades to "no filter," not a broken
  register. `buildFilterState` concatenates the parsed rules with the core-field rules
  it already built, under one `join`. No changes were needed to `matchItems` or any
  other domain function — the engine already fully implemented prop:/desc: fields and
  the whole operator set; only the wire boundary was incomplete. `toWireFilterField`
  also started passing through `unit` (e.g. "GB", "ml"), previously dropped at the wire
  boundary though the domain side always computed it. New coverage:
  `lib/server/resources/items.spec.ts` (7 cases) — the parsing function is DB-free and
  testable in isolation despite `items.ts` starting `import "server-only"`, since
  `vitest.config.ts` already shims that import for exactly this reason.

  **Client side**: `RegisterFilters` (`lib/register/useRegisterState.ts`) gained
  `rules`/`join`, serialised to/from the URL as a `rules` JSON param (+ `join`) so a
  reload reproduces an advanced filter exactly like the core ones already did; a
  `readRules` type guard drops any rule failing basic shape validation before it's
  ever rendered, since a hand-edited URL reaches the client's `describeRule` (which
  calls `.join` on `values`) before the server gets a chance to reject it.
  `FilterBar.tsx` gained an "Add filter" builder (`AddRuleForm`): a field picker (the
  filter-fields endpoint's response minus the five core ids, grouped by category/part
  name), an operator picker populated from `lib/domain/filters.ts`'s own `opsFor`
  (reused directly, not reimplemented), a value editor that switches between a
  multi-value control and a plain input by field kind, and rule chips with a remove
  button; an AND/OR toggle chip appears once 2+ rules exist. The `+ Add filter…`
  field list re-fetches from `/api/resources/items/filter-fields?categoryId=...`
  whenever the core Category dropdown changes, so prop:/desc: options appear only once
  a category is actually in play, matching `buildFilterFields`'s own documented
  behaviour.

  **Three real UI bugs found live, fixed in the same pass** (verified together with
  the user driving the browser directly — the first time in this project the user did
  the live-testing rather than reading a report of it):
  1. **Cropped multi-select.** The first pass rendered an enum field's value picker as
     a native `<select multiple>` sized by a fixed `h-24` (24px) class — far too short
     to show any option inside its own scrollable box, so it looked broken/empty.
  2. **A native multi-select that DID show all rows (via a `size` attribute) fixed #1
     but traded it for a worse problem the user caught immediately**: it rendered
     inline and grew the whole toolbar taller every time an enum field was picked,
     reflowing the page instead of floating over it.
  3. **Stale field selection after Clear filters.** `AddRuleForm`'s local `fieldId`
     state isn't reset by anything external; once "Clear filters" drops `categoryId`
     (and with it every prop:/desc: field), a `fieldId` left pointing at a
     now-nonexistent option resolves `field` to `undefined` — which silently hides the
     operator/value/Add controls (all gated on `field` being truthy) instead of the
     builder visibly resetting to its own empty "+ Add filter…" state.

  Fixed #1/#2 together by replacing the native multi-select with a small
  `MultiSelectPopover` — a button showing a summary ("2 selected" / one label /
  "Select…") that opens an absolutely-positioned floating checkbox panel on click,
  closing on an outside click or Escape. No shadow utility exists in this app's
  Tailwind scale (`tailwind.config.js`'s own comment: "there are no floating cards, so
  the shadow scale is deliberately empty apart from `none`") — matched the existing
  `Modal` component's pattern instead (`bg-panel border border-border2`, no shadow) so
  this is the first genuinely floating, non-modal element in the app and it still
  reads as consistent with the rest of the design system. Fixed #3 with a `useEffect`
  that resets `AddRuleForm`'s local state whenever `fields` no longer contains the
  currently-selected `fieldId`.

  **Verified live** against the representative Phase 6 seed data, mostly by the user
  driving the browser directly with this session narrating what to check: selecting
  Computer as the active category correctly surfaced Computer's own fields plus its
  parts' descendant fields (Motherboard/RAM/Storage/GPU/Monitor/Cable — reaching down
  through `CategoryTemplateChild` edges); a `RAM · Size ≥ 16` rule correctly narrowed
  to exactly the 3 seeded computers whose RAM is ≥16GB (indices 2/3/4 of the seed's
  `[8,8,16,16,32][idx%5]` pattern — confirmed by expanding the cluster row and counting
  "3 units"); a second `Storage · Kind is SSD` rule combined under the AND/OR toggle;
  the popover opened as a floating panel without resizing the toolbar and closed
  correctly on an outside click; "Clear filters" now correctly returns the builder to
  its own empty state instead of hiding its controls; the `rules`/`join` URL params
  round-tripped through a reload.

  **One known, disclosed limitation surfaced during this same live pass, left
  unaddressed on the user's explicit call** ("let it be — continue with the next
  step"): free-text search (`matchSearch` in `lib/domain/filters.ts`, unchanged by
  this entry) matches an item's own name, its own category's name, and its own props
  — never a descendant's. Searching "SSD" finds a Storage item whose own `kind` prop is
  "SSD", but not the Computer that contains one three levels down. This is
  `matchSearch`'s pre-existing, narrower-than-`matchRule` scope (rules do reach
  descendants via `desc:` fields; free-text search never has) and was not part of what
  the Phase 6 entry disclosed as missing — recorded here as an open item for whenever
  search depth is revisited, not a regression from this entry's work.

  Verified: `npx tsc --noEmit` clean; `npm test` — 166 tests (7 new, all others
  unchanged); `npm run build` clean after stopping the dev server first (36 routes,
  same as Phase 6 — no new pages, only existing ones gaining capability) per this
  project's own standing note about `.next` manifest corruption from a concurrent
  dev+build. This closes the Phase 6 entry's own disclosed gap in full — the reduced
  core filter bar is no longer the final implementation.

- **2026-09-04 (replatforming Phase 7 — the editing surface)** — Inline commit, a
  confirmation step for consequential edits, bulk property editing, adding resources,
  and optimistic version-conflict handling, all through the existing single mutation
  endpoint (`lib/server/resources/mutate.ts`'s `applyChange` — no parallel write path
  added). Two real, pre-existing gaps were closed as part of this phase, both
  explicitly called for by the plan: the write door's role authorization, and item-level
  version conflicts (categories already had `expectedVersion`; items never did).

  **Write-role authorization — a genuine gap, closed by explicit user decision.**
  Before this phase, `mutate.ts`'s `assertAuthorized` checked only SCOPE
  (`scope.assertCanWriteItem`/`outOfScopeCount`, both now deleted as dead code) — any
  signed-in user with *any* reach over an item, including a department head's ordinary
  ORG_SUBTREE read scope, could write to it. The write endpoint's own comment said as
  much: "a signed-in user is enough to reach this handler; whether they may act on the
  named items is the write path's own job" — and that job was never actually role-aware.
  Asked directly (this session, via AskUserQuestion — a security-relevant policy
  decision, not something to guess), the user's answer was categorical: **"Only direct
  Lab or Store owners can Create, Edit, Delete — others approve — and of course
  sys_admin can do anything."** Implemented as a new pair of functions in
  `lib/server/resources/scope.ts`, deliberately separate from the read-scope machinery
  above them:
  - `isSysAdmin(userId)` — the one universal override.
  - `assertCanMutate(userId, itemIds)` — SYS_ADMIN bypasses; everyone else must have
    every named id inside `custodyItemIdsOf(userId)` (now exported — `custodianId =
    userId` plus every transitive descendant), or the whole call 404s. This is
    deliberately narrower than any READ scope: PROPERTY_ADMIN and STORE_KEEPER see the
    whole university, MANAGER sees its whole subtree, but none of them may write
    without also being the custodian — their part in a mutation, until Phase 12's
    approval chain exists, is nothing at all.

  `mutate.ts`'s `assertAuthorized` and `assertSubtreeInScope` (the descendant-sweep
  guard on delete/transfer) were rewritten against this pair rather than patched — the
  plan's own text had assumed the existing scope-based check was already the intended
  policy and only needed verifying, but the user's direct answer defined a materially
  narrower one, which supersedes that assumption. `createItem` with no `parentId` (a
  new university-level root) is now refused for everyone but SYS_ADMIN outright — a
  root has no existing custodian to check against, and custody grants no root-level
  reach by construction, so nothing else could ever satisfy it; the plan's own warning
  ("do not silently grant the ability to create university-level root labs or stores
  merely because child creation is allowed") is enforced structurally, not by a special
  case. `transferItem`'s destination check follows the same rule, which makes a
  genuinely cross-custody transfer SYS_ADMIN-only for now — intentional, matching the
  plan's own framing of transfers as consequential and later gated by Phase 12's
  approval policies, not this phase's job to loosen.

  Verified live (curl against the running dev server, mirroring Phase 4's own
  methodology): a custodian editing their own lab succeeds; the same custodian editing
  another department's lab 404s; **the SE department head — a MANAGER with ordinary
  read scope over the exact same lab, not its custodian — is now refused (404) editing
  it**, the regression test that proves the gap is actually closed, not just
  re-described; a custodian creating a root 404s; the same custodian creating a child
  beneath their own custodied lab succeeds (the plan's "special handling" case,
  preserved not replaced); SYS_ADMIN succeeds on both an edit outside their own org and
  a root create; an unauthenticated request 401s. All fixture writes reverted
  afterward, confirmed via a direct DB re-count.

  **Item-level optimistic version-conflict handling — did not exist, now does.**
  `lib/shared/resources/item.ts`'s `VersionConflictDto` wire shape existed since Phase
  2 but nothing produced it for items (only `categories.ts`'s own separate
  `expectedVersion` field did, for category edits). Added `expectedVersions?:
  Record<itemId, number>` to every `ItemChangeInput`'s shared `Base` schema — a map
  rather than categories.ts's single number, since a bulk edit touches several items
  at once — and `mutate.ts`'s new `assertVersionsMatch(input)`, called right after
  authorization and before the transaction opens: any named id whose live version
  doesn't match what the caller expected refuses the WHOLE change with 409
  `VERSION_CONFLICT` (the same whole-refusal discipline every other guard in this file
  already uses), naming every mismatched id, expected and actual version. Omitting the
  field (or leaving an id out of it) opts that id out of the check entirely — nothing
  is forced to adopt it. Verified live: a write with the item's true current version
  applies; the identical write with a deliberately wrong version 409s with the correct
  `conflicts` array; a write with no `expectedVersions` at all still applies (the
  opt-out path).

  **The editing surface itself**, built around one shared state machine
  (`lib/register/usePendingChange.ts`) rather than a bespoke dialog per screen — it
  mirrors `OrgStudioPage.tsx`'s existing `PendingAction`/`ConfirmDialog` pattern
  exactly (pick a value → `request()` → either applies on the spot or opens the same
  `ConfirmDialog` component already used there), per the plan's explicit instruction
  not to invent a second one. `request()` defers to `lib/domain/types.ts`'s
  already-ported `needsConfirm`/`CONFIRMED_CHANGES` (present since Phase 3, unused
  until now) rather than a new copy — a duplicate was written first and deleted once
  the original was found by name in `Inspector.tsx`'s existing import.
  - **Inspector.tsx**, rewritten from read-only to the single-item edit surface: name,
    quantity (BULK counting mode only) and every category-defined property commit
    inline on blur — no dialog, matching `needsConfirm`'s "a correction is typing, not
    a decision" rule for a lone item — reverting the field and showing an inline error
    if the write is refused. Status, custodian, owning unit, current unit and position
    (`moveInTree`) are pickers that call `request()`, all consequential kinds per
    `CONFIRMED_CHANGES`, so all open the shared `ConfirmDialog`. Delete opens it too,
    danger-toned. Property inputs render by the category field's real type (enum →
    select, boolean → Yes/No, number/text → typed input), fetched once from
    `GET /resources/categories` — not a plain text box guessing at the type. Every
    write carries `expectedVersions` keyed off the version the Inspector loaded the
    item at. `useEditOptions.ts` (owning/current unit, custodian option lists) fetches
    `/resources/items/filter-fields` a second time rather than threading FilterBar's
    own copy through several prop layers — matches this app's existing per-component
    fetch style.
  - **The register's bulk-selection toolbar** (`RegisterPage.tsx`), appearing once
    `useRegisterState`'s new `selectedItemIds` (resolving TanStack's row-keyed
    `RowSelectionState` down to real item ids — a cluster row's `memberIds` can be
    many, exactly `lib/domain/tree.ts`'s own "a cluster-cell edit is a bulk edit of
    its members" header) is non-empty: the same status/custodian/owner/current-
    unit/position pickers as the Inspector, a rename input, a property picker (only
    fields every selected item's own category defines in common — offering a narrower
    field would let the write reach a category that cannot hold it, which the server
    refuses outright rather than silently skipping), and delete. Every one of these
    confirms unconditionally once the selection is genuinely bulk, per
    `needsConfirm`'s second rule, independent of which field.
  - **AddModal.tsx** and **BulkPropModal.tsx** — the two components the plan names
    that don't fit the single-value-pick-then-confirm shape (creating needs
    parent+category+count; a bulk property write needs key+value), ported from
    `temp_works`' same-named components with the same "the form itself is the
    confirmation step" design (no second `ConfirmDialog` stacked on top — a multi-field
    form the user reviews before submitting already serves that purpose, matching
    temp_works' own originals, neither of which had one either). AddModal hides the
    "Top level" (root) option entirely unless the signed-in user holds SYS_ADMIN
    (`user.roles.includes("SYS_ADMIN")`) — offered-then-refused would just be
    confusing given the authorization change above.

  **Three real UI bugs found live, fixed in the same pass** (this session drove the
  browser directly rather than narrating steps back to the user):
  1. Deleting an item from inside its own Inspector called the same `load()` every
     other successful edit does, which re-fetched the now-deleted item's own detail
     and 404'd — showing "Resource not found" in a modal that had, correctly, just
     finished doing exactly what was asked. Fixed by having `usePendingChange`'s
     `onApplied` callback also hand back which `ItemChangeInput` was actually applied
     (not just the result), so `Inspector.tsx` can tell a delete apart from every other
     kind and close instead of reloading.
  2. The "Move to…" bulk-toolbar picker used an empty string for both its own
     unselected placeholder AND its "Top level" option — selecting the placeholder
     itself (i.e., touching nothing) would have silently fired a move-to-root request.
     Caught in code review before it ever reached the browser; fixed with a distinct
     sentinel value for "Top level" so the placeholder stays inert.
  3. (Carried over from the Phase 6 checkpoint work earlier this session, not new
     here, but worth noting it held up under real use throughout this phase's testing
     too: the floating `MultiSelectPopover` and the field-reset-on-stale-selection fix
     both continued to behave correctly through every bulk-picker interaction in this
     pass.)

  **Disclosed scope trims, not gaps in the underlying capability** — the write door
  and its authorization/version-conflict handling support all of these already; only
  UI affordances are deferred:
  - No literal per-cell inline editing directly in `ResourceTable.tsx`'s grid — the
    Inspector (single item) and the bulk toolbar (selection) are the two edit
    surfaces this phase built, both reaching the identical `usePendingChange`/
    `submitChange` path a future table-cell editor would too, so nothing about this
    trim constrains how that would be added later.
  - No dedicated bulk-quantity UI control (single-item quantity is inline in the
    Inspector; a bulk quantity write is fully supported server-side via `setQuantity`
    + multiple `itemIds`, just not wired to a toolbar button yet).
  - The "Move to…"/Position picker's destination list is whatever rows are currently
    loaded in the register's active view (the whole scoped set for Hierarchy/Rollup,
    only the current page for Search) rather than a dedicated container search —
    adequate at this seed's scale, worth revisiting if the register grows much larger.

  Verified live throughout, signed in as the SE custodian (`custodian.se@astu.edu.et`)
  against the representative seed, reverting every fixture change afterward and
  confirming via direct DB re-count (134 items, 4 `ItemChange` rows — the exact Phase 6
  checkpoint baseline, unchanged): an inline property correction (Seats 7→8) committed
  with no dialog and one correctly-attributed change-log line; a status change
  (Working→Broken→Working) opened the ConfirmDialog both times, including a Cancel
  that left the record untouched; the SE department head (MANAGER, not custodian)
  attempting the identical edit got a clean "Resource not found" error with the
  optimistic input reverted, not a crash; the bulk toolbar's rename correctly
  bulk-applied to a single-item selection with no dialog (matching `needsConfirm`'s
  selection-size rule); AddModal created a Speaker under SE Lab X with the correct
  inherited custodian/owner/current-unit and no "Top level" option shown (non-
  SYS_ADMIN); Delete removed it cleanly and the Inspector closed instead of erroring.
  `npx tsc --noEmit` clean; `npm test` — 169 tests (3 new: `lib/domain/types.spec.ts`
  covering the previously-untested `needsConfirm`); `npm run build` clean after
  stopping the dev server first (still 36 routes — this phase adds no new pages, only
  capability on the existing Register).

- **2026-09-04 (Phase 7 checkpoint audit — atomic version-conflict handling)** — Before
  treating the accumulated Phase 6/7 working tree as a clean checkpoint, audited it end
  to end against the replatforming plan and closed the one real correctness gap found:
  `lib/server/resources/mutate.ts`'s `assertVersionsMatch` ran BEFORE
  `prisma.$transaction` opened, reading each item's version with a plain `findMany`
  against the committed-but-not-yet-locked row. A second writer could change the same
  item after that read and before the transaction's own update — the exact TOCTOU race
  optimistic concurrency exists to close, on the one write door every mutation in the
  app funnels through.

  Fixed by moving the check inside the transaction and reading with `SELECT ... FOR
  UPDATE` rather than a plain read: `assertVersionsMatch(tx, input)` now runs as the
  transaction's first statement, locking every id named in `expectedVersions` for the
  rest of that transaction. Any concurrent transaction touching the same rows blocks
  until this one commits or rolls back, so the version compared here is guaranteed
  still current at the moment `performChange`'s own update runs a few statements
  later — a losing concurrent writer's OWN check then fails against the version this
  transaction just committed, rather than both succeeding. Whole-refusal is
  unchanged: any one mismatch throws before `performChange` is ever called, so nothing
  in a bulk edit partially applies, including the ids whose version DID match.

  Added `lib/server/resources/mutate.spec.ts` — the one DB-backed spec in the suite
  (every other `*.spec.ts` tests pure logic only, per vitest.config.ts's own header;
  this bug is not pure logic, it is a real transaction race that only a live Postgres
  can prove closed). `.env` is not loaded by Vitest the way `next dev` loads it —
  confirmed directly (`process.env.DATABASE_URL` is `undefined` under a bare `vitest
  run`) — so the spec reads `.env` by hand in its own top-level code before dynamically
  `import()`-ing `mutate.ts`/`../prisma` inside `beforeAll`, after which their
  module-level `new PrismaClient()` sees the env var already set. Three cases against
  real fixture items (cleaned up in `afterAll`, verified via a direct count afterward —
  134 items/21 categories/5 groups unchanged): a bulk edit with one stale id among
  several refuses the whole batch AND leaves the non-stale id's row untouched, not just
  the stale one; a fully-matching bulk edit applies normally; and the load-bearing
  case — two real concurrent `applyChange` calls racing the SAME expected version
  against the SAME item (`Promise.allSettled`) — asserts exactly one fulfills and one
  rejects with 409 `VERSION_CONFLICT`, and that the item's final version reflects
  exactly one increment, not zero (both refused) and not two (both silently applied,
  what the pre-fix code would have allowed). All three passed against the fix and
  would not have passed against the pre-fix code.

  Also audited the rest of the Phase 6/7 working tree file by file against
  PROGRESS.md's own account of it (scope.ts's write-eligibility split, the
  item-filter/filters wire-shape unification, items.ts's flat-Search and rules/join
  wiring, Inspector.tsx, RegisterPage.tsx's bulk toolbar and its `MOVE_TOP_LEVEL`
  sentinel fix, FilterBar.tsx's popover and stale-selection-reset fix, AddModal.tsx,
  BulkPropModal.tsx, the three new `lib/register/**` hooks) — found nothing else
  incorrect; every file matches its own documented behavior above. One deliberate,
  pre-existing design choice re-confirmed rather than changed: the register's bulk
  toolbar (unlike the Inspector) does not send `expectedVersions` on its writes — the
  field is opt-in by the wire contract's own design ("omitted entirely... means don't
  check this one"), not a gap parallel to the one just fixed.

  Explicitly NOT fixed here, on purpose: `lib/server/resources/categories.ts`'s
  `update()` has the identical shape of bug — `loadOne(id)` checks `expectedVersion`
  before its own `prisma.$transaction` opens. This is Phase 8's job, not this
  checkpoint's — categories.ts is the module Phase 8 rewrites into the full Category
  Studio, and giving it the same atomic treatment happens there, against the same
  `SELECT ... FOR UPDATE` pattern established here, rather than as a drive-by change to
  a module about to be substantially rewritten anyway.

  Verified: `npm test` — 172 tests (3 new, all others unchanged); `npx tsc --noEmit`
  clean; `npx prisma validate` clean; `npx prisma migrate status` clean (still 7
  migrations); `git diff --check` clean (no whitespace/conflict-marker issues); `npm
  run build` clean (36 routes, unchanged) after stopping the dev server first. This
  closes out the audit — the accumulated Phase 6 dev-seed/filtering-completion/Phase 7
  editing-surface working tree, now including this fix, is the clean checkpoint Phase 8
  builds on.

- **2026-09-04 (Phase 8, part 1 — Category Studio)** — Replaced `CategoriesPage.tsx`'s
  read-only list with the database-backed Category Studio: group-sidebar navigation,
  full create/edit/delete, the managed group vocabulary (new server module + Route
  Handlers Phase 2 had only stubbed a DTO for), template-children editing with
  cycle/duplicate/self-reference guards, and the impact-preview review step ported
  behaviorally from `temp_works/src/app/categories/page.tsx` (the standalone editor
  shell) and `ItemEditModal.tsx`'s "Category type" tab (the staged-draft/impact-preview/
  purge-checkbox behavior) — not that modal's Details/Children tabs, which are an ITEM
  editor's job (Inspector.tsx's own), not this category-scope editor's.

  **The atomic version-conflict fix, extended to categories.** `categories.ts`'s
  `update()` had the item-level bug's exact twin: `loadOne(id)` checked
  `expectedVersion` before `prisma.$transaction` opened. Rewritten so the version check
  (`SELECT ... FOR UPDATE`) is the transaction's first statement and every read the
  diff/impact computation depends on (group existence, template validity, the affected
  item list) now runs against `tx`, not the bare `prisma` client — the same fix as
  `mutate.ts`'s, applied to the module the plan named as still owing it. `create()`
  gained a `P2002` catch so a racing duplicate key is a clean 400, not a raw 500.

  **New validation, closing three real gaps**: duplicate field keys within one write
  (`assertNoDuplicateFieldKeys`), duplicate template-child entries within one write
  (`assertNoDuplicateTemplateChildren` — the existing "missing category" check silently
  passed a duplicate-id list, since it compared against a de-duplicated `Set` size),
  and self-reference via `update()` (create-time self-reference is already impossible —
  a new category has no id yet to reference; `wouldCreateTemplateCycle` already covered
  the update-time case, this just proves it with a test). All three are checked before
  any write, named 400s rather than raw Prisma constraint errors.

  **The template-child deletion guard the plan specifically asked to audit.**
  `CategoryTemplateChild.childCategory` is `onDelete: Cascade` — deleting a category
  that another category still lists as a default part would silently rewrite that
  OTHER category's subtree with no one having agreed to it. `remove()` now checks for
  this (`categoryTemplateChild` rows where `childCategoryId = id`) and refuses with a
  structured 409 (`TEMPLATE_CHILD_IN_USE`, naming the affected parent categories) unless
  the caller explicitly passes `confirmTemplateRemoval` (a query param on the DELETE
  route) — the same "present and confirm the collateral impact" rule `purgeKeys`
  already uses. A confirmed removal logs an `ItemChange` line against each affected
  parent category, naming what was removed and why.

  **Editing a category's own stable key** — `UpdateCategoryInput` never had a `key`
  field (only `CreateCategoryInput` did); added, with the same uniqueness check
  `create()` already runs. Renaming it moves nothing else: `Item.categoryId` is a cuid
  FK, never the key, so this is a pure display/import-target-string change.

  **Per-field usage counts** — new (`fieldUsageCounts`, `GET .../[id]/field-usage`),
  what the Studio's field editor uses to lock a field's storage-key input once any item
  holds a value under it (ported behaviorally from `ItemEditModal.tsx`'s `CategoryTab`:
  `disabled={used > 0}` on the key input) — "do not permit a quiet key rename that
  strands values" enforced as a UI guard on top of the schema's own already-correct
  dormant-by-default semantics (removing a field never deletes its stored values,
  `purgeKeys` is the sole explicit, audited, opt-in path that does). Also new: a
  category-level `usageCounts()` (`GET /resources/categories/usage`) for the sidebar's
  per-category counts, and `CategoryImpactNote`'s wire shape gained `id`/`title`/
  `detail`/`orphanKeys` (previously flattened into one `message` string with
  `orphanKeys` dropped entirely — nothing had consumed this DTO yet, so widening it
  cost nothing) so the Studio's review step can render a bold claim + counted detail
  per note, exactly `edit-impact.ts`'s own header describes, and drive the purge
  checkbox off real key names.

  **Icon picker** — `components/resources/IconPicker.tsx`, a thin wrapper around
  `lib/domain/icons.ts`'s `categoryIconFor`/`CATEGORY_ICON_OPTIONS` (a `<select>` over
  the curated registry plus a live preview glyph) — no second icon vocabulary, no
  free-text `iconKey`.

  **Role gating** — `canManage` (SYS_ADMIN/PROPERTY_ADMIN) threaded down from
  `useAuth()` hides every write control (New/Manage groups/field-and-part editors/
  Delete) client-side; `CategoryEditor` renders `CategoryReadOnly` instead for everyone
  else. The server's own `requireRole` on every mutating Route Handler remains the
  actual boundary — verified live via `curl` as `custodian.se@astu.edu.et` (CUSTODIAN +
  STAFF, no admin role): `POST /api/resources/category-groups` and
  `DELETE /api/resources/categories/:id` both returned a clean 403 with nothing written.

  New tests: `lib/server/resources/categories.spec.ts` — the category-level twin of
  `mutate.spec.ts` (real Postgres, same `.env`-loading approach), covering duplicate
  field keys, duplicate/self-referencing template children, the template-child-in-use
  delete guard (blocked, then explicitly confirmed), a stale whole-object write leaving
  the category completely untouched, and — the load-bearing case — two genuinely
  concurrent `update()` calls racing the same `expectedVersion` against the same
  category, proving exactly one succeeds and the version increments exactly once.

  Verified: `npx tsc --noEmit` clean; `npm test` — 178 tests (12 new); fixture-created
  and fully cleaned-up round trips via `curl` against the live dev server as SYS_ADMIN
  (group create/rename, category create with a template-child link, the duplicate-field
  400, the template-child-in-use 409 then confirmed delete, final counts back to
  baseline: 5 groups, 21 categories) and as the SE custodian (both mutations correctly
  403, nothing written). Live in-browser, signed in as the SE custodian: the read-only
  Category Studio renders every group/category/field/template-child correctly with no
  write controls and the "Only SYS_ADMIN and PROPERTY_ADMIN may edit..." note. Signed in
  as SYS_ADMIN: "+ New category"/"Manage groups" appear; opening Computer shows the full
  editor (icon picker, fields with real "N in use" locks, the six-part default subtree,
  the impair-rule picker); toggling the impair rule to NEVER and clicking "Review
  changes" correctly rendered the impact preview ("Consequences (2)" — the reach note
  and the failure-rule-change note) without writing anything (impact preview is a dry
  run), and "Back to editing" returned to the draft unshown. **`npm run build` was
  deliberately NOT run this pass** — another chat's `next dev` was serving the same
  `.next/` directory throughout this session (confirmed via `netstat`, live `curl`, and
  a live-browser pass against it on port 3000, since this session's own `preview_start`
  could not bind a second server against the same project in this sandbox); running a
  production build concurrently is the project's own standing corruption risk (see the
  Phase 5 timeline entry). Run `npm run build` once no `next dev` is active against this
  directory before treating Phase 8 as fully closed.

  **Deliberately not done in this pass, carried forward**: the plan's own "reconcile
  Phase 7's Inspector against `ItemEditModal`'s missing child-structure and
  category-definition review capabilities" — Inspector.tsx still has no direct-children
  list/add/remove section and no in-context link to a resource's own category
  definition. Superseded in priority by an explicit user request (recorded in the next
  entry) for item-specific custom properties, which also touches Inspector.tsx; the
  children/category-link reconciliation remains open.

- **2026-09-04 (item-specific custom properties)** — Mid-Phase-8, the user asked for a
  feature not in the original replatforming plan: an authorized user editing ONE item
  can add a property their category does not define — a one-off fact about that
  resource alone — without an admin first changing the category schema for everyone.
  Explicit, repeated constraint throughout the request: this must SUPPLEMENT category
  fields, never weaken their validation, and the two concepts must stay explicitly,
  visibly distinct.

  **The storage design decision, made deliberately against the obvious shortcut.** The
  tempting shape was a reserved key inside the existing `Item.props` JSON blob (no
  migration needed). Rejected in favor of a genuinely separate column, `Item.customProps
  Json @default("{}")` (its own additive migration), each entry `{ type, value }`, for
  one concrete reason that isn't cosmetic: `categories.ts`'s `purgeKeys` runs a raw
  `UPDATE "Item" SET props = props - $1` — a reserved key sharing that same JSON object
  would be one dormant-field purge away from silently erasing an unrelated custom
  value, exactly the failure mode the user explicitly warned against. A separate column
  makes that structurally impossible rather than relying on a runtime guard someone
  could forget to keep in sync. The domain `Item` type gained an OPTIONAL `customProps`
  field (not `{}`-defaulted) rather than required, so every existing fixture across
  ~15 spec files and the client-side `ItemRowDto`→`Item` adapter (whose row DTO
  deliberately does not carry this — the register table's own Specs cell stays category
  fields only, custom properties are Inspector-only) kept compiling with zero touch-up.

  **Validation lives in its own module** (`lib/server/resources/custom-props.ts`, pure,
  mirroring `category-props.ts`'s own split), explicitly NOT a relaxation of
  `validatePropWrite` — that function is untouched and still refuses any key a category
  doesn't define, exactly as before. A custom key is pattern-checked (letters, digits,
  spaces, `-`/`_`, starting with a letter, capped length — no `:`, which the new
  `custom:<key>` synthetic filter-field id uses as a namespace separator) and collision
  checked, normalized (case/punctuation-insensitive — "Serial Number" and
  "serial_number" read as one collision, not two properties), against BOTH the item's
  own category fields and its own other custom properties. A value is validated against
  the TEXT/NUMBER/BOOLEAN type it was declared with — chosen once at creation, stored
  explicitly, never re-guessed from form text on reload (the user's own stated
  requirement). Editing a custom property's value cannot change its type; changing type
  means remove-then-re-add, the same "removing strands the old value until re-added"
  discipline a category field already follows.

  **Three new `ItemChangeInput` kinds** (`addCustomProperty`, `setCustomProperty`,
  `removeCustomProperty`, all single-item-only — a custom property is a fact about ONE
  resource by construction, never a bulk write), handled in `mutate.ts` alongside every
  other kind — the SAME one write door, the SAME `assertVersionsMatch`/`assertAuthorized`
  gates already in place, no parallel mutation path. This means the item-level
  atomicity fix from the prior checkpoint (`SELECT ... FOR UPDATE` inside the
  transaction) already covers these three for free. `CONFIRMED_CHANGES`:
  add/edit are corrections (no dialog, matching `setProperty`'s own treatment — "A
  custodian must be able to add and edit... without an approval chain" is satisfied by
  the SAME custody-only write policy Phase 7 already established, not a new one);
  remove is a deletion (confirms, matching `removeImage`).

  **Search and the advanced filter builder**, both extended rather than duplicated:
  `lib/domain/filters.ts`'s `matchSearch` now folds custom-property values into its
  haystack, and `valuesFor`/`matchRule` gained a `custom:<key>` field branch alongside
  the existing `prop:`/`desc:` ones. Unlike those two, a custom property is not
  organized by category — it is discovered from the items actually in play, via a new
  `customPropFilterFields(scopedItems)` that has NO scope logic of its own (a
  deliberate design choice, tested explicitly) — `items.ts`'s `domainFilterFields` is
  the one caller, and it already had a `closed`-scoped item set on hand for the
  "Lab / location" option list; the same set now feeds custom-property key discovery
  too, which is what keeps an out-of-scope item's custom key from ever reaching a
  filter-fields response — collecting keys AFTER scoping, never before, per the user's
  explicit requirement.

  **The Category Studio's impact preview learned one new note.** When a category admin
  adds a field whose key normalizes to match an existing custom property somewhere
  among that category's own items, `categoryImpact` now emits a `warning`-severity note
  naming how many items are affected — surfaced, never blocked (the two live in
  different storage, so nothing is actually overwritten; the risk is purely that the
  same name now means two different things on the same item, worth a human's attention,
  not a refusal).

  **Inspector.tsx** — a "Custom properties (this item only)" section, visually and
  structurally separate from the category's own "Properties" block: each existing
  custom property renders as a typed input (text/number/select for boolean) with an
  inline commit-on-blur, matching category fields' own editing feel, plus a small ×
  remove button that opens the existing `ConfirmDialog` via the same `usePendingChange`
  machinery every other Inspector edit already uses — no second mutation system, per
  the user's own explicit instruction. "+ Add optional property" opens a small inline
  form (name / type / value) that submits through the identical `request()` call.

  **One real bug found live, fixed in the same pass**: a collision error from a failed
  "Add" attempt (`inlineError`, a separate state from `usePendingChange`'s own
  `pendingError`) was never cleared by anything except the specific `commit*` functions
  — cancelling the add form, opening it again, or completing an unrelated remove all
  left a stale "This item already has a property named…" banner sitting above fields
  that had nothing wrong with them. Fixed by clearing `inlineError` in `load()`'s own
  reset block (so every successful reload starts clean) and at the three points that
  open/close the add-form or a remove confirmation.

  New tests, matching every case the user asked for by name: `custom-props.spec.ts`
  (pure — key validation, normalized-collision detection, per-type value validation);
  extended `filters.spec.ts` (custom-property search and `custom:` rule matching,
  `customPropFilterFields`'s own no-scope-of-its-own contract) and `edit-impact.spec.ts`
  (the category-field/custom-property collision note, and its negative case); a new
  DB-backed `custom-props.mutate.spec.ts` (real Postgres, same fixture/`.env` pattern as
  `mutate.spec.ts`/`categories.spec.ts`) covering creation, exact persistence and typing
  across a reload, editing, removal, a duplicate-key collision, a category-field
  collision, an unsafe key and a wrong-typed value, a stale-version write applying
  nothing, a custodian succeeding with no approval chain, a non-custodian MANAGER
  refused the same 404 an out-of-scope write already uses, SYS_ADMIN succeeding across
  departments, and — the scope-leakage case named explicitly — an SE custodian's
  filter-fields response never naming a ChemE item's custom key and vice versa.

  Verified: `npx tsc --noEmit` clean; `npm test` — 209 tests (31 new); `npx prisma
  validate`/`migrate status` clean (9 migrations); `npm run build` clean (41 routes, +5:
  the two group Route Handlers and the two usage/field-usage endpoints — no dev server
  was running this pass, so the build ran without the prior entry's deferral). Live
  in-browser, signed in as the SE custodian, on the real "Whiteboard" item in the dev
  seed: added a TEXT custom property ("Warranty Vendor" → "Steelcase") with an
  immediately-correct History line; edited its value inline with no dialog; attempting
  a second property named "warranty vendor" (different casing) was refused with the
  exact normalized-collision message, live proof the same check the DB test exercises
  also fires through the real endpoint; added a NUMBER property ("Weight Limit" → 250,
  confirmed the value input switches to `type="number"` for the chosen type); removed
  "Weight Limit" via the confirm dialog. Confirmed the new field appears in the
  register's "+ Add filter…" list after a reload (the filter-fields list is fetched
  once per FilterBar mount, a pre-existing characteristic shared by every advanced
  field, not something new here) and that a `Weight Limit ≥ 100` rule correctly
  narrowed Hierarchy mode to just the item's own lab. All fixture state reverted
  afterward and confirmed via direct DB query: baseline counts unchanged (134 items/21
  categories/5 groups), the Whiteboard item's `customProps` back to `{}` — its `version`
  column is higher than before (8, from the live edits), left as-is per this project's
  own established precedent for harmless test-history noise on real seed rows rather
  than being reset artificially.

- **2026-09-04 (Phase 9 — images)** — Object storage, the two-step upload, client-side
  downscaling, item image galleries, inspector images, table thumbnails, captions, and
  category-image fallback, ported behaviorally from `temp_works/src/lib/images.ts` and
  `src/components/ItemImages.tsx` — none of that sandbox's IndexedDB/Zustand/blob-URL
  machinery, since production has a real server and a real database to hold metadata
  in instead.

  **Storage is a clean, swappable driver — `lib/server/resources/storage/`**:
  `StorageDriver` (`write`/`read`/`remove` on an opaque key) is the one interface
  everything else in the app talks to; `local-fs-driver.ts` is the complete,
  correct interim implementation (files under `IMAGE_STORAGE_DIR`, default
  `.local-storage/images/`, gitignored), selected by `IMAGE_STORAGE_DRIVER` (default
  `local`) in `index.ts`. No production object-store target has been chosen yet — that
  was deliberately not treated as a blocker; adding one later means one new file next
  to `local-fs-driver.ts` and one branch in the selector, nothing else in the codebase
  changes. Image bytes and thumbnails never enter Postgres — `ItemImage` holds only
  metadata and a `storageKey` reference, exactly as the schema already declared before
  this phase existed to fill it in.

  **The two-step upload — a new `ImageUpload` Prisma model** (`PENDING` → `UPLOADED` →
  `FINALIZED`, `expiresAt`-bounded) is the seam that makes "the client can never choose
  an authoritative storage path or finalize an arbitrary existing key" actually true,
  not just documented:
  1. `POST /api/resources/items/:id/images/upload-sessions` (`images.ts`'s
     `createUploadSession`) — authorized by the SAME custody-based write gate every
     other mutation uses (`scope.assertCanMutate`, not a parallel or weaker check),
     mints a `crypto.randomUUID()` storage key the client never sees a way to pick, and
     returns an opaque session id plus a 10-minute-bounded upload URL.
  2. `PUT /api/resources/images/upload/:sessionId` (`receiveUpload`) — the only place
     bytes are trusted. The client's declared `Content-Type` is read only as an early
     size hint; every stored fact (`contentType`, `byteSize`, `width`, `height`) comes
     from `lib/server/resources/image-sniff.ts` reading the ACTUAL bytes — a new,
     dependency-free module that reads real PNG/JPEG/WebP container headers (magic
     bytes plus the couple of fixed offsets each format keeps its dimensions at, no
     native image library needed since nothing decodes pixels or resizes anything).
     An SVG, or anything else, fails the very first signature check and is refused
     before a single format-specific byte is interpreted — "do not accept SVG or trust
     client-supplied metadata" is enforced structurally, not by a content-type
     allowlist a client could still lie about. Also enforces `MAX_UPLOAD_BYTES` (15 MB)
     and `MAX_DIMENSION` (8000px/side).
  3. `addImage` (mutate.ts, through the SAME one write door every other change already
     uses) — the only place a session may become a real `ItemImage`. Looks the session
     up by id (never trusts a client-supplied `storageKey`/`contentType`/`byteSize`/
     `width`/`height` — `AddImageChange`'s wire shape no longer HAS those fields, only
     `uploadSessionId`), checks it belongs to this item and this actor, is `UPLOADED`
     (not still `PENDING`, not already `FINALIZED`, not expired), then creates the
     `ItemImage` and marks the session `FINALIZED` in the SAME transaction — which is
     what makes "finalize this session twice" (409, `UPLOAD_ALREADY_FINALIZED`) and
     "finalize a session some other item claimed" (400) both structurally impossible,
     not just unlikely. Existing `expectedVersions`/`assertVersionsMatch` and
     custody-based authorization apply exactly as they do to every other change kind —
     no special-casing.

  **File cleanup, threaded through `applyChange` without touching every handler's
  return type.** `applyChange` now carries a `cleanupKeys: string[]` collected during
  the transaction (by `applyRemoveImage` and `applyDeleteItem`) but never acted on
  until AFTER the transaction commits — `storage.remove()` runs once, outside the
  transaction, only on the success path, so a rolled-back removal or delete can never
  strand a live `ItemImage` row with its file already gone, and a committed one can
  never leave the bytes behind. `applyDeleteItem` collects storage keys for BOTH the
  doomed subtree's finalized photos (`ItemImage`) and any upload that reached storage
  but was never finalized (`ImageUpload` rows still `UPLOADED`) — `Item→ItemImage`/
  `Item→ImageUpload` are both `onDelete: Cascade`, so the DB rows vanish the instant
  the item does, but the files behind them do not go with them unless collected first,
  before the delete runs. A bounded, opportunistic sweep
  (`sweepExpiredForItem`, called on every new session request for that item) deletes
  the storage bytes of any of THAT item's own abandoned sessions — `PENDING` that never
  received bytes, or `UPLOADED` that never got finalized — past their `expiresAt`, so a
  user who picks a file and then never applies the change does not leave a permanent
  orphan; not a substitute for a real scheduled sweep at production scale, but exact
  and directly testable at this one.

  **Serving enforces scope through the image's own item — never the URL.**
  `GET /api/resources/images/:storageKey` resolves the key back to its owning item
  (`findImageForServing`) and runs the exact same `assertCanSeeItem` (ancestor-inclusive
  read scope) a direct item read already uses, before a single byte is streamed —
  possessing a URL (copied, guessed, or left over from a closed session in another
  department) is not authorization, confirmed live: signed in as the SE custodian the
  route served the correct bytes and content type; the SAME URL requested with no
  session cookie 401'd; requested signed in as the ChemE custodian (no reach into SE's
  item) 404'd, the identical refusal an out-of-scope item read already gives. A
  category's own `defaultImageKey` (the read path only — no admin UI uploads one this
  phase, see the trims below) is shared vocabulary and skips the item-scope check,
  matching how the category itself is already readable by anyone signed in.

  **Client** — `components/resources/ItemImages.tsx`: `downscale()` ported behaviorally
  from temp_works' own (canvas-based, longest edge capped at 1280px, JPEG quality 0.82,
  skips anything already small), `uploadImageBytes()` (steps 1+2, returning a session id
  for the caller to finalize through the existing `request()`/`usePendingChange` path —
  step 3 stays wherever every other change already lives, no second mutation system),
  `ItemImageGallery` (Inspector: one large picture, a thumbnail strip, add/remove,
  caption, category-icon/`defaultImageKey` fallback with a "Category picture" badge,
  loading/error states) and `ItemThumb` (a read-only small square for the register
  table's new leading "photo" column). `lib/api.ts` gained `putFile()` — a raw-body PUT,
  the one place a Content-Type header is sent as a HINT, matching the server's own
  distrust of it. Inspector.tsx wires the gallery's `onAdd`/`onRemove` into the same
  `request()` every other field already uses — `addImage` stays non-consequential (no
  dialog, matching temp_works' own design), `removeImage` confirms (this project's own
  established policy, stricter than the sandbox's, unchanged by this phase).

  New tests: `image-sniff.spec.ts` (pure — hand-built-but-real PNG/JPEG/WebP headers
  decode correctly; an SVG, garbage bytes, an empty buffer, and a truncated PNG all
  refuse); a DB- and filesystem-backed `images.spec.ts` (18 cases) covering
  session-creation authorization (custodian succeeds, a non-custodian MANAGER and a
  different department's custodian both 404, SYS_ADMIN succeeds anywhere), real
  format/dimension sniffing on receipt (ignoring any declared type), SVG/oversized/
  wrong-actor/already-uploaded/expired rejections, finalizing through `applyChange`
  (server-verified metadata lands on the real row, version bumps, audit line logs,
  double-finalization refused with nothing double-created, cross-item finalization
  refused, a still-`PENDING` session refused, a stale-version write applies nothing and
  leaves the session claimable), and — the load-bearing cleanup cases — a removed
  photo's file is gone from storage only once the removal actually commits, a
  version-conflicted removal leaves the file untouched, and deleting a subtree cleans
  up every finalized photo AND every still-pending upload beneath it.

  Verified: `npx tsc --noEmit` clean; `npm test` — 236 tests (27 new); `npx prisma
  validate`/`migrate status` clean (10 migrations); `npm run build` clean (44 routes,
  +3: the two upload endpoints and the image-serving route) after stopping the dev
  server first. Live in-browser, signed in as the SE custodian: the register's new
  photo column and the Inspector's empty-gallery state both render correctly with the
  category icon (no upload UI exists for a category's own default image yet, so this
  path is exercised structurally by the DB test, not visually here). Native file-picker
  automation is not available through this session's browser tooling, so the actual
  upload round trip was verified via real HTTP calls against the SAME routes the
  browser's own `fetch` calls would hit, using a genuinely valid hand-built PNG (real
  IHDR/IDAT/IEND with a correct zlib stream, not just a header): created a session,
  PUT the bytes (server correctly sniffed 4×4/73 bytes, ignoring the declared
  Content-Type), finalized via `addImage`, confirmed the served bytes matched the
  original file exactly byte-for-byte, confirmed the scope/auth matrix above (200 as
  the custodian, 401 signed out, 404 as the ChemE custodian, 409 on a repeat
  finalization) — then reloaded the actual page live and confirmed the uploaded photo
  rendered correctly in both the table thumbnail and the Inspector gallery, clicked
  "Remove" through the real `ConfirmDialog`, and confirmed live that the photo
  disappeared from the UI, the `ItemImage` row was gone, and the URL that used to serve
  it now 404s. All fixture state cleaned up afterward (`.local-storage/images/`
  confirmed empty; item/category/group counts unchanged) — the Whiteboard item's
  `version` is higher than before from this live pass, left as-is per this project's
  own established precedent.

  **Disclosed trims, not gaps in the underlying capability**: no admin UI uploads a
  category's `defaultImageKey` this phase (the read/fallback/serving path is fully
  wired and tested directly against the database; only the Category Studio control to
  set one is deferred — a small, isolated addition whenever it's wanted, not a
  structural gap); no server-side thumbnail generation — temp_works never had one
  either (its own `ItemThumb` renders the same full (already client-downscaled) image
  small via CSS `object-cover`), and the 1280px-longest-edge client downscale is
  already small enough for both the inspector's larger view and a tiny table cell, so
  adding a second server-generated artifact would be complexity with no behavior gap
  to justify it.

- **2026-09-04 (Phase 10 — the global change log)** — Replaces the `/change-log`
  placeholder with the real thing, behaviorally ported from
  `temp_works/src/components/ChangeLogView.tsx`: search, filtering, ordering and
  pagination all run server-side (`lib/server/resources/changes.ts`'s new `browse`),
  never "load every row and filter in the browser" the way the sandbox's own
  client-store version could get away with.

  **The deleted-item scoping problem, solved with an explicit scope snapshot, not a
  workaround.** The real gap: `ItemChange` already snapshotted `itemName` so a deleted
  item's line still reads, but carried nothing that could authorize a GLOBAL log entry
  once the item itself is gone — `assertCanSeeItem` (what the existing per-item
  history already leans on) requires a live, non-deleted row, so a since-deleted
  item's whole history was unreachable by anyone, including whoever legitimately owned
  it. Fixed at the source: `ItemChange` gained three columns —
  `ownerOrgNodeId`/`currentOrgNodeId`/`custodianId` — populated on EVERY ITEM-targeted
  row at the moment `mutate.ts` writes it (a new `scopeSnapshot()` helper, threaded
  into all nine `itemChange.create`/`createMany` call sites), reflecting the state
  that change itself produces — a `setCustodian`/`setOwnerOrg`/`setCurrentOrg`/
  `transferItem` row snapshots the NEW value, everything else snapshots the item's
  unchanged current state. This is deliberately not just a deletion fix: it also
  means a TRANSFERRED item's pre-transfer history stays visible only to whoever could
  see it back then, never retroactively to whoever holds it now — a transfer of
  custody is not a transfer of the right to read what happened before it, and that
  reads as correct regardless of whether the item involved is ever deleted. A
  CATEGORY-targeted row's three columns stay null by design (categories are shared
  vocabulary, visible to everyone signed in, same rule the category endpoints already
  enforce) — `changeLogScopeWhere`'s predicate always includes `targetKind:
  "CATEGORY"` rows unconditionally, and only global roles ever see a null-snapshot
  ITEM row (the deliberately conservative default for a row genuinely too old, or too
  broken, to know the scope of — proven with a directly-inserted fixture row in
  `changes.spec.ts`, not just asserted).

  **The scope predicate itself re-derives nothing** — `changeLogScopeWhere` calls the
  SAME `scope.defaultModeFor`/`orgScope.visibleNodeIds` every other item read already
  resolves through, just applied against the snapshot columns instead of the live
  `Item` table (which a deleted item no longer has a row in): `UNIVERSITY` mode sees
  everything, `MY_CUSTODY` matches the snapshot's own `custodianId` directly (not
  live-tree descendant expansion, which cannot be replayed against a subtree that may
  itself be gone — a deliberate, disclosed narrowing: the log shows what a custodian
  DIRECTLY custodied at the time, not what happened to sit inside something of theirs),
  `ORG_SUBTREE` matches `ownerOrgNodeId`/`currentOrgNodeId` against `visibleNodeIds`.

  **Existing rows backfilled, conservatively.** A one-off `$executeRaw` UPDATE (run
  once against the dev database, not a replayable migration — this is data, not
  schema) copied the CURRENT item's scope onto every pre-existing row whose item still
  exists (11 rows); rows whose item was already deleted before this column existed
  stay null — genuinely unknowable, correctly left admin-only rather than guessed.

  **Every existing change kind renders sensibly, including the two newest.** Image
  changes show their caption ("Front panel") or the literal word "photo" as the
  before/after when no caption was given; custom-property changes show the property
  key as `field` and its typed value as before/after, identical in shape to a category
  field's own `setProperty` row; category edits already carried their own name
  snapshot in `itemName` (a pre-Phase-10 design choice this phase leaned on rather
  than duplicated — a CATEGORY row's `itemName` IS the category's name snapshot). A
  category's own `defaultImageKey`/deleted-child-part notes ("'Blockable Part' was
  deleted, removing it from this category's default subtree") read correctly as
  ordinary rows, no special-casing needed.

  **Deleted targets never render a broken link.** `browse` resolves, per page (not per
  row — one batched query), which of the page's `itemId`s still name a live row and
  which of the page's `categoryId`s still resolve to a name, returning `itemExists`
  (bool) and `categoryName` (nullable, display-only — `itemName` stays the
  authoritative snapshot) on every entry. The client (`ChangeLogPage.tsx`) renders a
  live item's name as a real button that opens the Inspector; a deleted one renders as
  plain, struck-through, unclickable text — confirmed live via `find` returning no
  interactive match for a known-deleted item's name, only for a live one's.

  **A bulk operation renders as one recognizable operation, not N rows that happen to
  share a badge.** Every row one bulk call produces shares the exact same `at`
  (`mutate.ts` stamps one `Date` per call, before its per-row loop) — `browse` orders
  `at desc, id desc`, which keeps a batch's rows GUARANTEED contiguous within a page
  without any extra grouping query. `ChangeLogPage.tsx`'s `groupEntries` does one
  linear pass over an already-scoped, already-ordered page and collapses consecutive
  same-`batchId` rows into one expandable summary card ("N resources · <kind label> ·
  by <actor> · <time>"), each member row available on demand rather than always
  spelled out — confirmed live and in `changes.spec.ts` (a real two-item bulk edit's
  rows share one `batchId` and an identical database timestamp).

  New route: `GET /api/resources/changes` (query params: `q`, `kind`, `targetKind`,
  `actorId`, `categoryId`, `itemId`, `batchId`, `page`, `pageSize`) — the one door into
  `browse`, mirroring the read-endpoint conventions `items.ts` already established.
  New wire contracts: `ChangeLogEntryDto` (`ItemChangeDto` + `itemExists`/
  `categoryName`), `ChangeLogPageDto`. `components/resources/ChangeLogPage.tsx`
  replaces the `ComingSoon` placeholder at `/change-log`: URL-persisted filters
  (search debounced, matching `FilterBar`'s own pattern), a Kind/Target/Category
  picker row, the grouped table, and page-number pagination:

  New tests: a DB-backed `changes.spec.ts` (9 cases) — SYS_ADMIN sees every
  department plus category rows; a MANAGER (ORG_SUBTREE) sees their own department's
  item rows and category rows, never the other department's; a custodian
  (MY_CUSTODY) sees only rows for items they directly custody; a category-targeted
  row is visible to every role tested, including a custodian with no category-admin
  reach; a directly-inserted null-snapshot row is visible to SYS_ADMIN only, never a
  MANAGER or custodian; a deleted item's earlier entries stay visible to whoever could
  see it, the delete row itself carries `itemExists: false`, and the other
  department never sees any of it; a real bulk edit's two rows share one `batchId`
  and one exact timestamp; full-text search matches item name and actor name; and
  pagination never returns more than `pageSize`, with `total` accurate and no overlap
  between pages.

  Verified: `npx tsc --noEmit` clean; `npm test` — 245 tests (9 new); `npx prisma
  validate`/`migrate status` clean (11 migrations); `npm run build` clean (45 routes,
  +1) after stopping the dev server first. Live in-browser, signed in as the SE
  custodian against the real, accumulated dev-database history (176 rows at the time
  of this pass, most of it earlier phases' own live-verification traffic — left in
  place per this project's established precedent for harmless test-history noise):
  the log rendered every kind correctly (image adds/removes, category edits including
  a collateral-template-removal note, custom-property changes) with working Kind/
  Target/Category filters; searching "Mechanical" (part of a real ChemE-owned item's
  name) returned zero rows signed in as the SE custodian — the exact cross-department
  leakage check, via free-text search rather than a filter dropdown, proving the
  scope predicate applies before search runs, not after; the identical search for a
  real SE item's own name ("Whiteboard") correctly surfaced its whole photo/
  custom-property history; clicking that item's name opened the real Inspector;
  searching a since-deleted SE item's own name ("SE Images Item") showed its complete
  history including the delete row itself, rendered as plain non-clickable text
  (confirmed via `find` returning no interactive match for it, unlike the live
  Whiteboard row). No live fixtures were created during this pass beyond the
  already-existing dev history, so nothing needed cleaning up afterward.

- **2026-09-04** — Re-prioritization: the user is about to push this repo to
  GitHub and host it on Vercel for real lab assistants, department heads and
  university offices to use. That reframes the goal from "work through the
  phase list" to "ship something real custodians can use," and surfaces a
  problem the phase list never caught — **creating a resource was completely
  broken**, for every account including SYS_ADMIN. New plan:
  `~/.claude/plans/three-product-changes-dynamic-thompson.md`, tracked as
  Phase 10a (creation)/10b (university browse)/10c (deferred)/hardening/
  deploy. See the "Not yet done" section above for how this supersedes the
  old phase order.

- **2026-09-04** — Phase 10a: finished and committed the in-flight
  resource-creation work (found already ~90% built, uncommitted, by a prior
  session working the same plan) — category placement rules, the
  container-picker endpoint, and `AddModal`'s owner/current/custodian
  pickers. Fixed three real defects found while finishing it, none of them
  cosmetic:

  **`containers()` was iterating the wrong scope set and could crash.**
  `lib/server/resources/items.ts`'s `containers()` mapped over `closed` (the
  *ancestor-closed* scope set used by list/summary views) instead of `base`
  (the direct scope set) — a destination you can merely see because a
  descendant is in scope is not a legitimate destination, and for SYS_ADMIN
  (whose `writable` filter is `null`, so nothing masked the difference) this
  meant offering containers that were never legal. The same line also did an
  unsound `forest.index.byId.get(id)!` — `custodyItemIdsOf` and `loadForest`
  can disagree about a soft-deleted row (the same class of bug commit
  `bdb849d` fixed for the change log), and the `!` turned that disagreement
  into a crash rather than a dropped id. Fixed both: switched to `base`,
  and replaced the assertion with a type-guarded filter that drops
  unresolvable ids. This is what `items.containers.spec.ts`'s "restricts an
  ONLY_LISTED category" test was actually catching.

  **Four TypeScript errors from a half-finished prop removal.** `Inspector`
  had been changed to fetch its own `moveTargets` via the container-picker
  endpoint instead of receiving a `containers` prop, but the prop wasn't
  actually removed from its signature's call sites — `RegisterPage.tsx` and
  `ChangeLogPage.tsx` still passed `containers=`, and `Inspector.tsx`'s own
  "Position" picker still read the now-nonexistent `containers` variable.
  Fixed all three call sites; `Inspector`'s Position picker now renders
  `moveTargets` with full `path`-qualified names, matching how
  `RegisterPage`'s own "Move to…" already disambiguates.

  **A genuine bootstrap-blocking bug, found only by actually running the
  flow live: `AddModal`'s "Into" picker could look selected while `parent`
  state was still empty, permanently disabling "Confirm & create".** When a
  category cannot be a root (`canOfferRoot` false) and has exactly one (or
  more) legal container, the "Into" `<select>` rendered no `<option
  value="">` at all — just the real container options. A controlled
  `<select value={parent}>` with `parent === ""` and no matching `<option>`
  falls back to the browser's native behavior of *visually* displaying the
  first real option as selected, without ever calling `onChange` — so
  `parent` stayed `""`, `canSubmit` stayed correctly false, and the button
  stayed disabled with no visible reason why. This is not an edge case: it
  is the ordinary path for every custodian adding a second item into their
  one existing lab. Fixed by always rendering an explicit `<option
  value="">Choose…</option>` placeholder whenever root isn't offered,
  regardless of how many containers exist — forces an explicit selection
  and keeps the DOM in sync with React state. Confirmed the same pattern
  does *not* exist in `Inspector`'s Position picker or `RegisterPage`'s
  "Move to…" — both already render an unconditional placeholder — so this
  was localized to `AddModal`'s root/non-root conditional branching, not a
  systemic issue.

  **Root-create policy, as actually enforced by
  `scope.assertCanCreateRoot`** (`lib/server/resources/scope.ts`): SYS_ADMIN
  may create a root anywhere; MANAGER may create a root owned by any unit in
  their own `visibleNodeIds`; CUSTODIAN/STORE_KEEPER may create a root owned
  by their own home node, with themselves as custodian — never an arbitrary
  unit, never naming someone else as custodian. A refused create returns
  403 with a real message ("You are not allowed to create a top-level
  resource here."), not 404 — a create has no existing row for a 404 to
  protect.

  **Also fixed: stale dev seed data.** `prisma/resource-seed.ts`'s
  `CATEGORY_SPECS` already correctly sets `Lab`/`Store` to `canBeRoot: true,
  placement: ONLY_LISTED` (the "a lab is a root and nothing else" rule), but
  the dev database had been seeded before that code landed, so it still had
  `canBeRoot: false, placement: ANYWHERE` in Postgres — the live bootstrap
  test below would have failed on stale data, not a code defect. Re-ran
  `npx tsx prisma/resource-seed.ts`, which only touches `ItemChange`/`Item`/
  `ResourceCategory`/`CategoryGroup` (confirmed by reading the script before
  running it) — org nodes and users, including test fixtures created
  earlier in this same session, were untouched by the rebuild.

  Verified: `npx tsc --noEmit` clean (was 4 errors); `npm test` — 265/265
  (was 264/265); `npm run build` clean; `npx prisma validate` and `migrate
  status` clean (12 migrations, `20260904030044_add_category_placement`
  applied). Live in-browser, the actual acceptance test for this phase: created
  a fresh department ("Bootstrap Test Department") and invited a brand-new
  CUSTODIAN into it with zero resources in scope (invitation token
  hash-swapped locally to bypass SMTP for this dev-only test — the account
  itself and its role/home-node assignment went through the real invite
  flow) — confirmed 0 resources in scope on first login, then created a Lab
  at the top level (owner/current/custodian all correctly defaulted to the
  custodian's own unit/themselves), then created a Table inside that Lab.
  Separately confirmed the refusal path via a direct API call: the same
  custodian attempting to create a root owned by a different department's
  node got back `403 {"error":"Forbidden","message":"You are not allowed to
  create a top-level resource here."}`, not 404. Cleaned up every fixture
  created during this pass (the department, the user, the two items) —
  dev database returned to its prior state (5 org nodes, 5 users, 134
  items) before committing.

- **2026-09-04** — Phase 10b: the university-wide, read-only browse — the
  surface a purchase-approving office or department head uses to answer
  "does any department already have one of these, and is it working?"
  before approving a purchase. The seams were already there
  (`ScopeMode.UNIVERSITY`, `buildItemScopeWhere`'s unrestricted branch,
  `visibleItemWhere`'s `mode` override); this was a gate, a parameter
  threaded through, and a page.

  **The gate**: `assertCanBrowseUniversity` (`lib/server/resources/scope.ts`)
  — SYS_ADMIN/PROPERTY_ADMIN/PROCUREMENT (already global via
  `orgScope.hasGlobalReach`) plus **MANAGER and STORE_KEEPER**, the
  deliberate widening. MANAGER because the org chart *is* the approval
  route here — "approver" means a department head/dean. STORE_KEEPER
  because that role's ordinary reach is already university-wide by design
  (occupies no OrgNode). Refused with 403, matching `assertCanCreateRoot`'s
  own precedent from 10a — a browse attempt has nothing for a 404 to hide.

  **The parameter**: `?scope=UNIVERSITY` threaded through as a `modeOverride`
  on `/items`, `/items/tree`, `/items/facets`, `/items/filter-fields`,
  `/items/summary`, `/items/[id]`, and (not in the original list, but
  required for the Inspector drill-through to actually work — its change
  history is a separate fetch) `/items/[id]/changes`. `resolveScope` and
  `canSeeItem`/`assertCanSeeItem` (`scope.ts`) both gained an optional
  `modeOverride` parameter; `computeScopedIds` (`items.ts`) passes it
  through. **`computeScopedIds` calls `scope.resolveScope` directly rather
  than reading a stored default** — the override had to reach that call,
  not be layered alongside it, exactly the trap the plan's own working
  notes flagged in advance. Every route handler that honours the parameter
  calls `assertCanBrowseUniversity` FIRST, unconditionally — the parameter
  is never trusted on its own.

  **The page**: `/university`, "University resources" in `lib/nav.ts` under
  Resources, gated to the same role set `assertCanBrowseUniversity` checks
  (one of the capability gates that file's own header explicitly permits —
  scope-narrowed data stays ungated everywhere else). **Reused, not
  forked**: `useRegisterState` gained an optional `{ scope: "UNIVERSITY" }`
  option that rides along on every fetch; `FilterBar` gained an optional
  `scope` prop for its own `/filter-fields` call; `ResourceTable` gained a
  `selectable` prop (default `true`) that drops the checkbox column
  entirely when `false` — a selection with no bulk toolbar to act on it
  is not inert, it is misleading. `UniversityPage.tsx` composes all three
  plus a `Panel`-per-`RegisterPage`'s own convention, with **no Add button
  and no bulk toolbar** (never rendered, not hidden by CSS).

  **`Inspector` gained a `readOnly` prop** — the drill-through. Deliberately
  a SEPARATE render branch (`ReadOnlyBody`) rather than `readOnly &&`-gating
  individual fields through the existing 700-line editable body: that body's
  fields are tightly coupled to draft state and commit handlers a read-only
  view has no use for, and threading a condition through each one would
  obscure more than it would share. Shows exactly what an approver needs —
  location, owner, current holder, custodian, condition, specs, photo, and
  history — including **"on loan"** (`currentOrgNodeId ≠ ownerOrgNodeId`)
  called out explicitly, the owner/current split's whole point.
  `ItemImageGallery` gained its own `readOnly` prop (hides "+ Add
  photo"/"Remove", keeps the display) rather than Inspector reimplementing
  a second photo viewer.

  **Fixed the `domainFilterFields` leak while in there** (flagged as an
  aside worth a deliberate decision, not left as a TODO): the custodian
  filter dropdown was built from `prisma.user.findMany({select:{id,name}})`
  — literally every account in the system, regardless of the caller's
  reach, on the ORDINARY register, not just the new university view. Fixed
  by deriving the option list from `scopedItems.map(i => i.custodianId)`
  instead — the custodians who actually appear on items this caller can
  see, which for a FILTER dropdown specifically is also the semantically
  *correct* set (a value that could not match anything you can see has no
  reason to be offered), and needs no extra query since `scopedItems` was
  already loaded. `orgNode` stays unscoped, as decided — the org chart
  itself is not confidential and owner/current-unit filters are useless
  without every unit in them. Confirmed live: an SE MANAGER's *ordinary*
  `/register` custodian dropdown now shows the ChemE custodian ONLY when
  she is legitimately visible ancestor context (SE's own loaned cable sits
  inside her lab) — not as a blanket leak of every account.

  New spec: `lib/server/resources/university-scope.spec.ts` (7 cases,
  DB-backed) — the gate allows SYS_ADMIN/MANAGER/STORE_KEEPER and refuses a
  plain STAFF account and a bare CUSTODIAN with 403; a MANAGER's ordinary
  `search()` excludes another department's item while the same call with
  the `UNIVERSITY` override includes it; `getOne` with the override
  resolves an item that would otherwise 404; `summary()`'s total widens
  under the override; and — the one that actually proves "seeing further
  grants nothing" — `assertCanMutate` still refuses the same MANAGER's
  write to the now-visible item, because that function takes no override
  at all (a fixed, narrower policy independent of read scope by design).

  Verified: `npx tsc --noEmit` clean; `npm test` — 272/272 (7 new); `npm
  run build` clean (`/university` in the route list); `npx prisma
  validate`/`migrate status` clean. Live in-browser, signed in as
  `head.se@astu.edu.et` (MANAGER): the rollup card showed owning-unit ×
  category counts across ALL THREE units (the university root, Chemical
  Engineering, Software Engineering), not just SE's own; the register table
  listed ChemE's own lab and store alongside SE's; opening ChemE's lab
  through the Inspector rendered every field as static text — no input, no
  select, no delete button, photo gallery present with no upload control;
  a direct API write attempt against that same ChemE item, immediately
  after seeing it, got back 404. Separately confirmed both refusal layers
  signed in as `custodian.se@astu.edu.et` (CUSTODIAN + STAFF, no MANAGER):
  no "University resources" nav item; a direct `GET
  /api/resources/items?scope=UNIVERSITY` call got 403 server-side; and
  navigating straight to `/university` by URL hit `RequireRole`'s
  client-side gate ("That area isn't part of your role"). Cleaned up the
  two sessions this pass created afterward.

- **2026-09-04** — Production hardening: the four blockers to an actual
  Vercel deployment, none of which the phase-by-phase replatforming plan
  ever surfaced because none of them are visible in local dev.

  **`argon2` → `@node-rs/argon2`** (`lib/server/auth/auth.ts`,
  `prisma/seed.ts`, `prisma/bootstrap.ts`). The native `argon2` addon ships
  per-platform `.node` binaries that Next's output tracing routinely misses
  on Vercel — the failure mode is nobody can log in, discovered only after
  deploying. `@node-rs/argon2` is prebuilt NAPI, no build step, and — read
  from `node_modules/@node-rs/argon2/index.d.ts` directly rather than
  assumed — has the EXACT SAME `hash(password): Promise<string>` /
  `verify(hashed, password): Promise<boolean>` signatures. Confirmed live,
  not just by reading the types: a hash the OLD `argon2` package produced
  (`admin@astu.edu.et`'s own seeded hash) verifies correctly through the
  NEW library (`argon2.verify(oldHash, 'astu1234')` → `true`), and a full
  `/api/auth/login` round-trip against that pre-existing hash succeeded —
  no migration, no re-hash-on-next-login shim needed, because PHC-format
  hashes carry their own parameters.

  **A Vercel Blob storage driver**
  (`lib/server/resources/storage/vercel-blob-driver.ts`), selected by
  `IMAGE_STORAGE_DRIVER=vercel-blob` alongside the existing `local` driver
  — the seam (`StorageDriver`) was already exactly right, this is the one
  new file the header promised. Uses `access: "private"` throughout — this
  SDK version (`@vercel/blob@2.8.0`) supports it, so there is **no
  residual "leaked-URL bypasses scope" risk** to carry forward, better than
  the plan's own fallback anticipated. The existing image-serving route
  (`app/api/resources/images/[storageKey]`) is unchanged and is still the
  actual security boundary — it re-resolves the key to its item and runs
  `assertCanSeeItem` before ever calling `storage.read`.

  **`prisma/seed.ts` now refuses to run under `NODE_ENV=production`**
  (matching `resource-seed.ts`'s existing guard) — it wipes every
  `User`/`OrgNode`/`Session` on every run, which is correct for a dev
  database and would delete every real custodian account on a production
  one. **New `prisma/bootstrap.ts`**: idempotent upsert-only (never
  delete), creates just a SYS_ADMIN and the UNIVERSITY root from env vars
  (`BOOTSTRAP_ADMIN_EMAIL`/`_PASSWORD`/etc — never hardcoded), safe to
  re-run. Verified live against the real dev database (safe precisely
  because it never deletes): first run created a new admin and found the
  existing "ASTU"-coded university node rather than duplicating it
  (matched id before and after); a second run with a DIFFERENT password
  changed nothing — same admin id, and the ORIGINAL password still
  verified while the new one was correctly rejected, confirming `update:
  {}` really does leave an existing admin's credentials alone on a re-run;
  a third run with `BOOTSTRAP_ADMIN_RESET_PASSWORD=true` did reset it,
  proving the explicit opt-in path also works. Test account removed after.

  **Neon connection config**: `directUrl` added to `schema.prisma`'s
  datasource block (`DIRECT_URL` env var, mirrors `DATABASE_URL` locally,
  points at the unpooled endpoint on Neon) — migrations need the direct
  connection, the app's own queries go through the pooled one, since
  serverless functions opening/closing connections per invocation is
  exactly what exhausts Postgres's connection limit without a pooler in
  front. `npm run prisma:deploy` (`prisma migrate deploy`) added alongside
  the existing `prisma:migrate` (`migrate dev`) — deploys must never use
  `migrate dev`, which can prompt interactively.

  **Copyable invite link** (`lib/server/people/people.ts`'s `create()`/
  `resendInvite()`, new `CreatePersonResultDto`/`ResendInviteResultDto` in
  `lib/shared/people.ts`, `InviteLinkModal` in
  `components/admin/PersonnelPage.tsx`). `mail.send` already never throws
  (logs and swallows), so a broken SMTP path was never actually blocking
  invite CREATION — but the raw link was previously visible nowhere but
  the email itself, so a failed send meant genuinely no way to onboard
  that person. Both functions now also return the raw invite URL (the one
  moment it can be — tokens are one-way hashed, `lib/server/auth/token.ts`'s
  own documented discipline, so it cannot be recovered later), surfaced
  once in a copy-to-clipboard modal after every invite/resend. Verified
  live: invited a test SYS_ADMIN through the real UI, the modal showed a
  real `http://localhost:3000/accept-invite?token=...` link, and the
  person appeared in the register as INVITED with a working "Resend
  Invite" action. Cleaned up afterward.

  **Repo hygiene**: `.env.example` (every variable named, no real values)
  and `README.md` (local setup, migrations, testing, the full Vercel/Neon/
  Blob deploy procedure, project structure) added — this repo is about to
  go public. Audited before this pass ends: `.env` confirmed gitignored
  (`git check-ignore -v .env`), no credential-shaped tracked files
  (`git ls-files | grep -iE "\.env$|credential|secret"` — empty), no
  hardcoded secret patterns in tracked source (`SMTP_PASS=`,
  `BLOB_READ_WRITE_TOKEN=vercel_blob...`, an inline `postgresql://user:pass@`
  — all empty), `.local-storage/` confirmed untracked.

  Verified: `npx tsc --noEmit` clean; `npm test` — 272/272 (unchanged —
  this phase touched auth/storage/ops surfaces the existing suite already
  covers, not new domain logic needing new specs); `npm run build` clean;
  `npx prisma validate`/`migrate status` clean (still 12 migrations —
  `directUrl` is schema-file config, not a migration). Live in-browser as
  SYS_ADMIN after every change in this phase: login, dashboard, and nav
  all still correct, people count back to the pre-test baseline (5) after
  cleanup.

  **Explicitly not done in this pass, flagged for the actual deploy**: no
  Neon/Vercel project has been created yet — this phase made the CODE
  ready, Phase 3 (deploy) is the separate, one-time act of actually
  standing up those services, running `bootstrap.ts` against them for
  real, and the full live-URL verification pass this file's own plan lays
  out.

- **2026-09-04** — Real demo data: the user needs to demo the full breadth of the
  system, and the dev fixture (`prisma/resource-seed.ts`) only ever had one
  representative lab per department. Ported `temp_works`' own real-data importer
  (`src/lib/real-data-seed.ts`/`chem-lab-data.ts`) — three documents the
  departments themselves produced (the SE electricity/network repair survey, the
  ChemE equipment register, the ChemE expired-chemicals list) — onto this app's
  real schema, real org nodes, and real login-capable accounts, **added alongside**
  the existing synthetic fixture rather than replacing it (both now coexist: the
  synthetic SE Lab/computer-hierarchy example for showing templates/criticality/
  derived status, the real data for showing authenticity).

  **New files**: `prisma/chem-lab-data.ts` (the department's own 33 equipment
  records — name, description, experiment list, condition, photo filenames —
  copied verbatim from `temp_works`, only the image paths adjusted from web paths
  to bare filenames); `prisma/real-data-seed.ts` (the structuring logic: real
  people, real category specs, real labs, the equipment→category judgement call,
  the expired-chemicals list, `buildRealDataItems()`); 36 real equipment
  photographs copied into `prisma/seed-assets/equipment/` (1.6 MB, committed —
  small enough, and this is what makes the photos actually work for anyone who
  clones the repo, not just on this machine next to `temp_works`).

  **13 real named people** (11 Software Engineering ARA/SARA lab responsibles, 3
  Chemical Engineering lab responsibles) — their own real names/emails/titles from
  the source documents, seeded as genuine login-capable `CUSTODIAN`+`STAFF`
  accounts (`astu1234`, matching every other seeded account), not funneled through
  the existing two placeholder custodians. `loadOrCreateRealPeople` does its own
  idempotent find-or-create by email — unlike categories/items, a `User` is not
  wiped by `resource-seed.ts`'s own reset, so a second run must not try to insert
  the same email again; verified live by running the script twice in a row (238
  items, 36 photos, 13 people — identical both times, no unique-constraint crash).

  **19 new categories across 4 new groups** (Mechanical Unit Operations, Reaction
  & Biochemical Engineering, Process Control & Fluid Mechanics, Heat & Mass
  Transfer — the department's own real classification, not invented) plus one
  Chemical-group addition (`Chemical Container (Expired Inventory)`, distinct from
  the existing `Chemical` category — different concern, active stock vs.
  disposal-pending inventory). `resource-seed.ts`'s `CategorySpec.group` widened
  from a closed 5-name union to `string`, `createCategories()` now builds from
  `ALL_CATEGORY_SPECS`/`ALL_GROUP_NAMES` (synthetic + real merged), and now returns
  its `idByKey` map directly rather than having `buildItems()` re-derive it by
  name+group lookup — `buildRealDataItems()` needed that same map and re-deriving
  it twice was pointless duplication.

  **15 real Software Engineering lab rooms** (up from 1) — the survey was about
  electrical/network repairs, not an equipment inventory, so these seed as real
  rooms with real custodians and no equipment inside; still real, useful demo
  content in its own right (every SE lab the survey named, each with its actual
  responsible person). **4 named Chemical Engineering labs** (Mechanical Unit
  Operation, Chemical Reaction and Biochemical Engineering, Process Control and
  Fluid Mechanics, Heat and Mass Transfer), populated with **33 real machines** —
  descriptions, full experiment/teaching-use lists, and the department's own
  condition assessment (non-"Functional" machines seed as `UNDER_MAINTENANCE`,
  matching the register's own "this is what needs attention" convention). **One
  expired-chemical store**, 51 containers, all correctly showing as needing
  attention.

  **Real photographs, through the real pipeline, not a shortcut.** Images cannot go
  through `lib/server/resources/storage/**` directly (that module's `import
  "server-only"` throws outside a bundler, same reason `mutate.ts`'s
  `itemCreateData` is duplicated rather than imported) — so
  `persistRealImages()` mirrors `local-fs-driver.ts`'s own `IMAGE_STORAGE_DIR`
  resolution and reuses `lib/server/resources/image-sniff.ts` (dependency-free, no
  `server-only` guard) to sniff the REAL format/dimensions from the bytes, exactly
  as a genuine upload's `receiveUpload()` does — never trusting the `.jpg`
  extension as proof of anything. Storage keys are deterministic
  (`seed-chem-<filename-without-extension>`, not a fresh `randomUUID()` per run) so
  re-seeding overwrites the same file instead of accumulating orphans on disk.
  `ItemImage.sourceSystem`/`sourceKey` (schema fields that had sat unused since
  Phase 9, with a doc comment literally anticipating "the real ASTU equipment
  photographs") record provenance: `"temp_works-chem-lab"` / the original filename.
  Verified live: opened "Jaw Crusher" in the register — its real photograph
  rendered through the actual `/api/resources/images/[storageKey]` route (not a
  static asset reference), confirming the full chain — seed script → local
  storage → the auth/scope-checked image route → the Inspector — is the same path
  a genuine upload would take, not a seed-only bypass.

  Verified: `npx tsc --noEmit` clean; `npm test` — 272/272 (unchanged — this is
  data, not new domain logic); `npm run build` clean. Live in-browser as
  SYS_ADMIN: searched "Jaw Crusher" — found under Chemical Engineering, category
  "Size Reduction Equipment", custodied by Addisu Amsalu, photo rendering
  correctly; the Category and Custodian filter dropdowns list every new category
  and every real named person; a direct API fetch of "Software Laboratory — B508-
  R11" confirmed room `B508-R11`, custodian Shambel Lemma Gadisa, source
  "Electricity and Network Repair Survey" — an exact match to the source document.
  `/university`'s rollup-by-owning-unit×category card shows the full breadth
  across both departments in one place, which is exactly the surface this data was
  added to make worth demoing. DB counts confirmed directly: 18 users total (5
  original + 13 real), 36 `ItemImage` rows, 238 items, all unchanged across a
  second run of the script (idempotency).

- **2026-09-04** — Small resource-modal usability pass: the Item Details gallery no
  longer renders a large icon/"No photograph" placeholder when neither the item nor
  its category has an image (editable details retain the compact Add photo action;
  read-only details render no empty media section). Replaced Add resources' native
  category select with a searchable, keyboard-accessible combobox styled in the
  project's existing design tokens. It filters by both category and group, retains
  the selected value, and shows an Add category action that closes the modal and
  routes to Category Studio whenever the search has no matches.

- **2026-09-04** — Extended Add resources with item-specific optional properties at
  creation time. A creator can add any number of key/type/value rows (text, number,
  or yes/no); for a multi-create batch the same bag is applied to every requested
  root, while template-generated children remain unchanged. `CreateItemChange` now
  carries the existing typed `CustomProps` wire shape, and the write path reuses the
  Inspector's server rules for key safety, category-field/duplicate collisions, and
  value types. Added DB-backed coverage for batch persistence and refusal cases.

- **2026-09-04** — Restored the source dashboard's shared-filter behavior: Dashboard
  now hosts the full register filter bar and the same expandable containment/category-
  cluster hierarchy used by Register beneath its status statistics. Both surfaces
  share URL-backed filter state,
  and `/items/summary` now parses the same core and advanced filter query as
  `/items`, counting only genuine direct-scope matches rather than tree-only context
  ancestors. Opening a dashboard row uses the normal editable Inspector. Added a
  DB-backed assertion that filtered summary totals equal filtered search totals.
  Verified: `npx tsc --noEmit`, all 292 tests, and `npm run build` clean.

- **2026-09-04** — Follow-up UI correction: Add resources' searchable category list
  now renders through a body portal and positions itself against the input, matching
  shadcn Popover behavior, so the modal's independent scrolling can no longer crop
  the list. It flips above the input when there is insufficient room below and
  tracks modal/page scrolling and window resizing.

- **2026-09-04** — Restored temp_works' live dashboard charts above the Register
  hierarchy: a condition donut, a switchable owner/current-unit/location/custodian/
  category condition breakdown, category rankings, and problem-location rankings.
  Chart marks, legends, rows, status tiles, and ranked bars all drill into (or toggle
  out of) the same URL-backed filter state used by the filter bar, stat totals, and
  hierarchy. The summary response now computes every aggregate from direct-scope,
  genuine matches and resolves display labels server-side; navigation-only tree
  context never inflates a chart. The Needs attention tile applies all four attention
  statuses together. Verified after the modal and hierarchy corrections: TypeScript,
  all 292 tests, production build, and diff whitespace checks are clean.

- **2026-09-06** — Milestone check-in: the app has been live on Vercel/Neon and
  demonstrated to investors since the 2026-09-04 deploy. The user is now feeding it
  real categories and registering the actual personnel who will use it day to day —
  reframing the remaining work from "ship something working" back to "build out to a
  verified MVP." Read through the full current-state and re-planned continuation at
  `~/.claude/plans/lets-merge-the-work-memoized-journal.md`: `master` was 2 commits
  behind the working branch (the dashboard-charts/AddModal-combobox/item-creation-
  custom-props work) with nothing of its own — fast-forwarded and pushed
  (`ccc8f23`), no merge conflicts. Confirmed the actual MVP gap against
  `Direction.md`'s asks: access views, approval chains, transfers, purchasing, and
  bookings all have complete Prisma models, Zod contracts, and (for views/approvals/
  purchasing) ported pure domain logic with tests, but **zero server modules, zero
  API routes, and zero UI** — confirmed by grep, no code outside `schema.prisma`
  referenced `prisma.accessView`/`approvalPolicy`/`changeRequest`/`chainStep`/
  `needLine`/`purchaseRequest`/`purchaseLine`/`purchaseEvent` before this round.
  Agreed to build one track at a time, each planned to granular detail when reached;
  access views first, since it's Direction.md's first ask and the seams
  (`visibleItemWhere`'s mode/explicitNodeIds overrides, `MeContextDto.views`,
  `computeScopedIds`'s override parameter) were already deliberately left open for
  it.

- **2026-09-06 (Track 1 — access views)** — Direction.md's first headline ask, done:
  "admin can create views; and then he can give personnel types specific views" so a
  custodian is filtered to their own custody, a department head to their subtree, an
  office to everything or a deliberate slice of it — server module, API, admin UI,
  and the sidebar picker that had sat inert since Phase 5.

  **One invariant, stated in `views.ts`'s header and proven by test**: a view may
  WIDEN reads; it may never widen writes. `scope.assertCanMutate`/
  `assertCanCreateRoot` take no view input at all and stay the write floor
  regardless of what a person can see — the only thing a view can do to a write is
  narrow it further via `canEdit: false`.

  **`lib/server/resources/views.ts`** (new, `import "server-only"`) —
  `resolveEffectiveView(userId, chosenViewId)` is the one resolution point every
  read and write threads through: loads `AccessView`+`AccessViewAudience` rows,
  adapts them to `lib/domain/views.ts`'s shape, and runs that module's EXISTING
  `resolveView`/`viewsForPerson` rather than re-implementing specificity ranking
  (PERSON beats ROLE beats EVERYONE — load-bearing and already tested). Returns
  `null` when the person has no matching views at all, which is what makes this
  safe to ship onto a live system: with zero `AccessView` rows (today's production
  state until an admin acts), every existing caller's default-scope resolution is
  byte-identical to before this track existed. `resolveReadOverride(userId, sp)`
  is the one place `?scope=UNIVERSITY` (10b, untouched, always gated first) and
  `?view=<id>` (this track) both resolve into a single override — at most one is
  ever honoured. Admin CRUD (`list`/`getOne`/`upsert`/`remove`) mirrors
  `categories.ts`'s own pattern (audiences replaced wholesale on save, same as
  `CategoryField` rows), gated `SYS_ADMIN`/`PROPERTY_ADMIN` — open item 4 of the
  original replatforming plan, settled the same way as categories.

  **Threading it through the read model** — `lib/server/resources/scope.ts`'s
  `resolveScope`/`canSeeItem`/`assertCanSeeItem` gained an additive
  `explicitNodeIds` parameter (existing 1-/2-arg call sites unaffected; the new
  EXPLICIT_NODES branch only triggers when explicitly asked for, which nothing did
  before). `items.ts`'s `computeScopedIds` — the one choke point — now takes a
  `ScopeOverride` object (`{mode, explicitNodeIds}`) instead of a bare `ScopeMode`,
  plus an `extraFilters` parameter applied as a mandatory server-side AND (an
  `matchItems` pass over the view's saved `FilterState`, intersected into `base`
  BEFORE `closed` is derived from it — never merged into the caller's own editable
  filter state). `search`/`tree`/`facets`/`filterFields`/`summary`/`getOne` all
  take the new shape; the 7 existing route handlers were mechanically updated from
  `university ? "UNIVERSITY" : undefined` to `resolveReadOverride`'s result, with
  `university-scope.spec.ts`'s own call sites updated to match (`"UNIVERSITY"` →
  `{ mode: "UNIVERSITY" }`) — its 8 tests still pass, confirming zero behavior
  change to the already-shipped 10b feature. `containers()` (the create/move
  destination picker) deliberately does NOT take a view override — a write-adjacent
  endpoint must never be widened by a view, matching the invariant.

  **The write door** — `mutate.ts`'s `applyChange`/`previewChange` gained an
  optional `viewId` and a new `assertViewAllowsEdit` check, run FIRST, before even
  the SYS_ADMIN early-return. This is deliberate, not an oversight of "SYS_ADMIN
  acts on anything unconditionally": choosing a read-only view (switching the
  sidebar picker to "Browse university-wide") is the person's own reversible UI
  choice, and it should mean "look but do not touch" regardless of role — switching
  back immediately unblocks them. The write endpoint carries `?view=<id>` the same
  way reads do.

  **Wire/client** — `MeContextDto.views` returns real rows now (was hardcoded
  `[]`). `lib/register/active-view.ts` (new) — a plain module-level store with
  `useSyncExternalStore` (not a Context: the sidebar picker, `useRegisterState`,
  and `useItemChange.ts`'s plain non-hook submit functions all need the same value
  without a wrapper every one of them would sit under), localStorage-backed,
  server snapshot always `null` — the same "match the server default first"
  discipline `theme-context.tsx` established, avoiding that class of hydration
  bug. `Sidebar.tsx`'s picker `<select>` (previously inert since Phase 5) is now
  controlled and wired to it. `RegisterPage.tsx` derives `canEdit` from the
  active view exactly the way the server resolves it, and hides "+ Add
  resources"/the bulk toolbar (via `ResourceTable`'s existing `selectable` prop)
  and passes `Inspector readOnly` when a canEdit:false view is active — the same
  pattern 10b's `UniversityPage.tsx` already established, not a second one.

  **A real bug found and fixed during live verification, not by inspection**:
  `Inspector.tsx` computed its own fetch's scope param as `readOnly ? "?scope=
  UNIVERSITY" : ""` — written back in 10b when `readOnly` and "viewing via the
  university browse" were the same thing. Once `RegisterPage.tsx` ALSO sets
  `readOnly` for a canEdit:false ACCESS VIEW (a different reason), opening any
  item while "Browse university-wide" was active sent `scope=UNIVERSITY` and hit
  `assertCanBrowseUniversity`'s real 403 for any account that isn't MANAGER/
  STORE_KEEPER/a global role — a plain CUSTODIAN like the test account could not
  drill into ANY item, including its own read-only-widened ones. Fixed by giving
  `Inspector` an explicit `scope?: "UNIVERSITY"` prop (mirroring `FilterBar`'s own
  established pattern) decoupled from `readOnly`; only `UniversityPage.tsx` sets
  it. Everywhere else — including a read-only access view — Inspector now sends
  the person's active view id instead, resolved through the exact same
  `resolveReadOverride` path every other read uses.

  **Rollout safety on a live system with real accounts already in it** —
  `lib/domain/views.ts`'s `SEED_VIEWS` (one view per stakeholder level: custodian,
  department head, the university offices, store keepers, read-only staff, plus
  the university-wide browse everybody gets) is real production seed content but
  is never auto-applied. New `lib/server/resources/views-rollout.ts` (deliberately
  no `import "server-only"`, same reason `image-sniff.ts` carries none — it has to
  run from a plain `tsx` script; the 3-line piece of `defaultModeFor` logic it
  needs is duplicated rather than imported across that boundary, the same
  trade-off `mutate.ts`'s own `itemCreateData` duplication already made) exports
  `previewRollout`, and `prisma/seed-views.ts` (new, `npm run seed:views`) is
  idempotent (upsert by the views' own stable ids, never deletes) and defaults to
  a DRY RUN — always prints, per real account, which view they'd land on and
  whether that NARROWS their current (zero-views) reach, and refuses to `--apply`
  if anything narrows unless `--force` is also given. Run against the real dev
  database (18 accounts): 0 would narrow — every role landed exactly on its
  matching SEED_VIEWS entry.

  New admin screen `components/admin/AccessViewsPage.tsx` at
  `/admin/access-views` (`SYS_ADMIN`/`PROPERTY_ADMIN`, added to `lib/nav.ts`'s
  Administration group): name/description, a `ScopeMode` picker with
  `SCOPE_HELP` text, a unit checklist for EXPLICIT_NODES, an audience editor
  (Everyone/Role/Person rows, add/remove), canEdit/active toggles, backed by new
  `GET/POST /api/resources/access-views` and `GET/PATCH/DELETE .../[id]` routes.
  **Disclosed scope trim, not a capability gap**: does not yet author a saved
  `extraFilters` query through the register's own `FilterBar` — the four
  `ScopeMode`s plus an explicit node list already cover every case Direction.md
  actually asked for, and the server/wire layers already carry `extraFilters` in
  full (proven by `views.spec.ts`'s own DB-backed test), so a saved-query
  authoring UI is a self-contained follow-up whenever wanted, not missing
  capability. `GET /api/people` widened from `SYS_ADMIN`/`MANAGER` to also allow
  `PROPERTY_ADMIN` (POST/invite untouched) — needed for the PERSON-audience
  picker, and PROPERTY_ADMIN already has university-wide reach via
  `orgScope.hasGlobalReach`, so `people.list()`'s own scoping already returns
  everyone for that role with no change to `people.ts` itself.

  New tests: `lib/server/resources/views.spec.ts` (11 cases, DB-backed) — the
  zero-views regression guard (a fresh account with no matching row resolves to
  `null`, run FIRST in the file before any other test creates a view, since an
  EVERYONE-audience fixture would otherwise contaminate it); PERSON beats ROLE
  beats EVERYONE with no explicit choice; an explicit valid choice is honoured; an
  invalid/foreign id falls back silently; `listSummariesForPerson`'s ordering;
  EXPLICIT_NODES widening past a person's own MY_CUSTODY default; a saved
  `extraFilters` query narrowing `search`/`summary` identically; a `canEdit:false`
  view refusing a write the same account succeeds at without it — THE load-bearing
  case; a UNIVERSITY canEdit:true view granting a non-custodian nothing on
  someone else's item (`assertCanMutate` unaffected by read scope, by design).
  One real test-isolation lesson worth keeping: this suite's spec files run
  concurrently against the SAME shared dev database, so an EVERYONE-audience
  fixture with `canEdit: false` — even created just to test specificity RANKING,
  not canEdit — transiently refused every OTHER concurrently-running spec file's
  SYS_ADMIN-driven writes, since EVERYONE literally matches the single shared
  seeded admin account too. Fixed by keeping every SHARED-audience-type test
  fixture (ROLE, EVERYONE) `canEdit: true`; only PERSON-scoped fixtures (which by
  construction can never match an account outside the test's own cleanup list)
  are ever `canEdit: false` in this file.

  Verified: `npx tsc --noEmit` clean; `npm test` — 303/303 (11 new); `npm run
  build` clean (`/admin/access-views` in the route list, `/api/resources/access-
  views` × 2); `npx prisma validate`/`migrate status` clean (still 12 migrations —
  the full `AccessView`/`AccessViewAudience` schema already existed from
  replatforming Phase 2, so this track needed no new migration). Live in-browser,
  the real acceptance test: applied `SEED_VIEWS` to the local dev database via
  `seed-views.ts --apply`, signed in as the SE custodian (Girma Wolde, CUSTODIAN+
  STAFF) — the picker offered exactly "My laboratories"/"My department"/"Browse
  university-wide" in that order; switching to "Browse university-wide" widened
  the dashboard from 186 to 740 resources (every department) and the register
  correctly hid "+ Add resources" and every selection checkbox; opening a Chemical
  Engineering item (this SE custodian's own department has no reach into it
  otherwise) rendered fully read-only with complete history, no editable field, no
  delete button (this is what caught the `Inspector` scope bug above); a direct
  `fetch()` POST to `/api/resources/items/changes?view=view-browse` attempting to
  rename that same item got back `403 {"message":"\"Browse university-wide\" is a
  read-only view — switch views to make changes."}`, and the item's name/version
  in the database were confirmed unchanged. Switching back to "My laboratories"
  restored normal edit behavior — a real inline rename through the UI round-
  tripped correctly (`POST .../changes?view=view-custodian` → 200), confirmed
  applied via direct DB read, then reverted to its original value. Signed in
  separately as `head.se@astu.edu.et` (MANAGER) and confirmed `/university`'s own
  drill-through — untouched by this track except for the `Inspector` prop
  rename — still worked correctly with `?scope=UNIVERSITY` (not `?view=`) after
  the fix. Exercised the admin screen fully: created "Track1 Test View" (ORG_
  SUBTREE, ROLE=SYS_ADMIN) through the real UI, confirmed it appeared correctly
  in the list, deleted it through the real `ConfirmDialog`, confirmed it was gone.
  **All fixtures created during this pass were cleaned up afterward**: the
  applied `SEED_VIEWS` rows were removed from the local dev database (Track 1
  ships disabled by default — an administrator applies them deliberately when
  ready, not as a side effect of this session's own verification), restoring
  `accessView` to 0 rows; a stray `__test-create-item-*` category/group pair
  (2 rows, 0 items) left behind by an EARLIER, differently-interrupted test run
  was also found and removed while checking dev-database state during this
  pass — unrelated to this track's own tests, which clean up correctly on every
  run, confirmed by 303/303 passing consistently across three consecutive full
  suite runs afterward. Final counts: 18 users, 740 items (real data the user has
  been adding since the 2026-09-04 baseline of 238 — not something this session
  added), 0 access views, 5 org nodes.

- **2026-09-07/08 (Track 2 — lab draft/visible/ideal states)** — Started as "wire up
  the already-built multi-office approval-chain engine" (`lib/domain/approvals.ts`,
  511 lines/45 tests, `ApprovalPolicy`/`ChangeRequest`/`ChainStep` in Prisma). Three
  rounds of clarification with the user revealed the actual day-to-day workflow
  wanted is different: a **draft/publish model with exactly one decider (the
  department head)**, plus a separate **ideal-vs-actual planning concept** feeding
  procurement — not a multi-office walked chain for ordinary lab edits. That engine
  is retargeted, not wasted: it is now understood to be Track 3's tool (cross-lab
  transfers: owner head → target head → receipt) and Track 4's (the procurement
  review chain — department → dean → AVP → procurement office, "confirming a
  purchase ask is not outrageous"). Confirmed directly against the live database
  before finalizing the design: **no `OFFICE`-kind `OrgNode` and no
  `PROCUREMENT`-role account exist yet**, which is exactly why `SEED_POLICIES`'
  `"proc-office"` placeholder could not have been applied safely — a real finding
  that shaped deferring the whole chain-engine wiring to Track 4, once that office
  exists. Full design at `~/.claude/plans/lets-merge-the-work-memoized-journal.md`
  §5. Built on a dedicated branch, `track-2-lab-drafts`, off `master` — the user
  asked that remaining tracks stop landing on `master`/`origin` directly the way
  Track 0/1 had.

  **The model**: every lab (a root `Item` a custodian custodies) has three views of
  its own subtree — VISIBLE (today's live `Item` rows, unchanged), DRAFT (free
  CRUD within the lab, no approval to stage), and IDEAL (a per-category target
  quantity, e.g. "8 Computers"). Committing publishes to VISIBLE (default) or
  IDEAL; both need exactly one approval — the lab's owning department's head,
  resolved LIVE (a vacant post blocks, a headship change redirects who decides,
  with no rebuild — the same invariant the untouched chain engine already proves,
  applied here to a single step). Rejecting leaves the draft intact for revision
  (the user's explicit choice) rather than discarding it. Procurement's input is
  derived, not authored: per lab/category, a quantity gap (ideal − actual) and a
  list of currently BROKEN/IMPAIRED items — Track 4 will let a head adjust this
  before it becomes a real `PurchaseRequest`.

  **Schema** (additive migration `20260907183910_track2_lab_drafts`):
  `OrgNode.draftWorkflowEnabled` (default `false` — the per-department rollout
  switch), `ItemDraftChange` (one staged operation; `payload` is an
  `ItemChangeInput` for VISIBLE or `{categoryId, qty}` for IDEAL — deliberately
  NOT unioned into `ItemChangeInput` itself, since an ideal-target proposal never
  reaches `applyChange`), `LabCommitRequest` (reuses the existing `RequestStatus`
  enum verbatim, including `STALE` for a version conflict at approval time), and
  `LabIdealTarget` (the approved target quantities). A NEW, smaller pair of tables
  rather than reusing `ChangeRequest`/`ChainStep`: those are shaped for one
  operation decided by a WALKED multi-step chain; a lab commit is MANY
  heterogeneous operations decided by exactly ONE fixed person.

  **`lib/server/resources/lab-drafts.ts`** (new, `import "server-only"`) —
  `stageChange` (custody-checked; for VISIBLE, runs the existing `previewChange`
  first so a doomed edit is caught before it's even staged; only
  setName/setStatus/setQuantity/deleteItem/moveInTree-within-the-lab/createItem-
  into-the-lab are stageable — `transferItem`/`setOwnerOrg`/`setCurrentOrg`/
  `setCustodian` and a brand-new root are explicitly excluded, matching the user's
  own line: "within his own lab, everything is in his power... but move to other
  people's owned things are an issue"), `submitDraft` (groups OPEN rows under one
  `batchId`, snapshots `expectedVersions` into `baseVersions` — the SAME
  optimistic-concurrency map `assertVersionsMatch` already uses, so staleness at
  approval time is the identical mechanism as a direct edit, no new check
  invented), `decideCommit` (resolves the decider directly via `OrgNode.userId`,
  no chain walk; REJECT resets covered rows to `OPEN`; APPROVE+VISIBLE pre-flights
  every staged operation as a dry run before applying any for real — "nothing
  partially applies" in practice, though not FORMALLY atomic across N separate
  `applyChange` transactions, documented as a known, narrow residual race;
  APPROVE+IDEAL upserts `LabIdealTarget` directly, no `Item` write at all),
  `getIdealVsActual` (per category: target, live count via the exact same
  `computeStatuses`/`NEEDS_ATTENTION` the register/dashboard already use — not the
  raw stored status column, so a container rolled up as IMPAIRED is caught too).

  **A real authorization gap found live, not by inspection.** Verifying the full
  flow in-browser (stage → submit → approve as `head.se@astu.edu.et` → confirmed
  in Postgres) surfaced that the ORDINARY direct-write endpoint
  (`POST /api/resources/items/changes`) was completely unaware of
  `draftWorkflowEnabled` — a department could opt in and custodians could just
  keep calling the old endpoint, making the toggle purely cosmetic. Fixed with
  `mutate.ts`'s new `assertDraftWorkflowNotBlocking`, run for every non-SYS_ADMIN
  actor right after the SYS_ADMIN bypass: if any touched item's owning unit has
  the workflow on, the direct write is refused with a message pointing at
  staging. This in turn required a `bypassDraftWorkflowBlock` opt threaded through
  `applyChange`/`previewChange`, used ONLY by `lab-drafts.ts`'s own three internal
  calls (the pre-stage preview, the pre-flight loop, and the real apply loop) —
  those ARE the legitimate conclusion of the workflow the block exists to
  require, not a bypass attempt. Deliberately re-implemented rather than imported
  from `lab-drafts.ts` (which already calls `applyChange`/`previewChange`) to
  avoid a circular module dependency. Added as its own regression test
  (`lab-drafts.spec.ts`'s "toggle on — the direct write door refuses to be
  bypassed") the moment it was found, alongside every other case.

  **UI**: Org Studio's node inspector gained a "Resource drafts" checkbox
  (reversible, purely additive — applies immediately with no confirmation,
  matching this app's own rule for that class of action).
  `components/resources/LabDraftPanel.tsx` (new) is the custodian's staging area
  — opened via Inspector's new "Manage draft…" button (shown only when viewing a
  lab root you yourself custody): a form to stage the four common corrections
  against any item in the lab (fetched via the existing `/items/tree` and
  filtered client-side to the lab's own subtree), a list of OPEN staged changes
  with per-row Withdraw and a batch "Submit for approval", and an "Ideal state"
  section (stage a target quantity per category, plus a live ideal/actual/gap/
  needs-attention table). `components/resources/ApprovalsPage.tsx` replaces the
  `/approvals` `ComingSoon` with "Routed to me"/"Raised by me" tabs over
  `LabCommitRequestDto`, each request showing its full staged diff and
  Approve/Reject through the existing `ConfirmDialog` pattern — createItem/
  moveInTree/images/custom-properties staging exists server-side already but has
  no UI affordance yet, a disclosed trim rather than a capability gap.

  **`lib/server/resources/lab-drafts.spec.ts`** (new, DB-backed, 11 cases,
  isolated on a freshly created orphan test `OrgNode` rather than the shared
  seed departments — Track 1's `views.spec.ts` had briefly collided with
  concurrently-running spec files by mutating a SHARED node's state; this file
  creates and deletes its own): the toggle-off regression guard (direct staging
  refused, byte-identical to pre-Track-2 otherwise), the toggle-on direct-write
  block and its bypass-for-legitimate-callers counterpart, staging accumulates
  heterogeneous changes untouched until approval, a vacant headship blocks
  everyone including the requester and self-heals the instant someone is
  appointed, approval-to-VISIBLE applies through the unmodified write door with
  correct audit attribution, approval-to-IDEAL touches only `LabIdealTarget`,
  rejection resets to `OPEN` rather than discarding, and `getIdealVsActual`
  matches the user's own worked example exactly (ideal 8, actual 6 → gap 2).

  **Verified live**, signed in as `custodian.se@astu.edu.et` and
  `head.se@astu.edu.et` against the real dev database (not a throwaway fixture):
  enabled the toggle for Software Engineering as SYS_ADMIN through the real Org
  Studio UI; as the custodian, opened "SE Lab X Software Lab 3" (their own real
  lab), staged a status change on a real RAM item to BROKEN through the real
  `LabDraftPanel`, confirmed the live item was untouched while staged, submitted;
  as the head, saw the pending request in a real Approvals inbox with the
  correct diff and requester name, approved it through the real `ConfirmDialog`
  — confirmed in Postgres directly that the RAM item's status flipped to BROKEN
  (version bumped) and its `ItemChange` row's `actorId` is the ORIGINAL
  REQUESTER (Girma Wolde), not the approving head, proving "a routed-and-
  approved change produces a record identical to applying it directly" holds
  for this simpler model too. Separately verified rejection end-to-end (staged a
  rename, submitted, rejected as the head with a note, confirmed as the
  custodian that the draft was back at `OPEN` and the live item's name was
  unchanged) and the direct-write block itself (a raw `fetch()` POST to the
  ordinary write endpoint while the toggle was on got back `403` naming the
  department by name). `npx tsc --noEmit`, `npm test` (314 tests — the pre-
  existing shared-dev-database test-concurrency flakiness this file already
  documented elsewhere surfaced twice during this round, in files this track
  never touched; both times a clean immediate re-run confirmed it was transient,
  not a regression), `npm run build`, `npx prisma validate`/`migrate status` all
  clean. **All fixtures cleaned up afterward**: `draftWorkflowEnabled` reset to
  `false` on every `OrgNode` (confirmed via direct query), the RAM item reverted
  to `WORKING` through a real audit-logged update (not a raw revert) rather than
  left as demo-data noise, the two `LabCommitRequest`/one `ItemDraftChange` test
  rows deleted (working-state tables, not a permanent audit log — unlike
  `ItemChange`, leaving them would show as stray entries in a real person's own
  "Raised by me" tab), and a stray `__test-views-*` category/group pair (0 items)
  left behind by an earlier, differently-interrupted `views.spec.ts` run —
  unrelated to this track — found and removed while auditing dev-database state
  during this pass. Final counts unchanged from before this round: 18 users, 740
  items, 6 access views, 5 org nodes, all `draftWorkflowEnabled: false`.

- **2026-09-08** — Track 3 (cross-lab transfers) planned and implemented, on its own
  branch (`track-3-transfers`, off `master` — deliberately NOT off `track-2-lab-
  drafts` initially, since transfers needed none of Track 2's schema). Once both
  tracks were independently complete and verified, `track-2-lab-drafts` was merged
  INTO `track-3-transfers` (a real three-way merge — `mutate.ts`'s two independent
  `assertAuthorized` extensions, `Inspector.tsx`'s two independent action buttons,
  and `ApprovalsPage.tsx`'s two independent panels all had to be reconciled by hand,
  not auto-resolved), so both features now live together on one branch — still not
  `master`, which this cycle never touches, per explicit instruction.
  Full design at `~/.claude/plans/lets-merge-the-work-memoized-journal.md` §6.

  **No new Prisma models** — `ApprovalPolicy`/`ChangeRequest`/`ChainStep` have existed
  since replatforming Phase 2 and `lib/shared/resources/approvals.ts`'s wire contracts
  were already complete; a repo-wide search confirmed zero server code read any of it
  before this track. `lib/domain/approvals.ts` (561 lines, 45 tests, unmodified) was
  the reference the new server module (`lib/server/resources/approvals.ts`) wires
  against live Prisma data — ported from `temp_works/src/lib/store.ts`'s `route()`/
  `decideRequest()`, the same reference implementation the domain tests were written
  against, the same porting discipline `lab-drafts.ts` used for Track 2.

  Deliberately narrow scope: only `transferItem` reads `ApprovalPolicy` rows now.
  `prisma/seed-policies.ts` (new, `npm run seed:policies`, idempotent upsert by each
  policy's stable id — mirrors `seed-views.ts`'s convention) seeds the FULL 52-rule
  `SEED_POLICIES` set, which is safe because every other operation (`setStatus`,
  `setProperty`, `createItem`, ...) still applies directly through `mutate.ts`,
  completely unaffected — Track 4 (procurement) will be the second, not the reason
  this track had to seed narrowly.

  **A loophole closed by design, not discovered after shipping**: `mutate.ts`'s
  `assertAuthorized` previously let a `transferItem` call apply directly, instantly,
  for anyone who already custodied BOTH the item and the destination — the code's own
  comment already called this "SYS_ADMIN-only for now, by design," since nobody in
  production could do a real cross-department transfer at all. Adding the routed path
  alongside that unchanged would have left the direct door open as a bypass — the same
  shape of gap Track 2 found live and fixed for its own draft-workflow toggle. Fixed
  here proactively: `assertAuthorized` gained `assertTransferGoesThroughApprovals`,
  refusing a direct `transferItem` call for anyone but SYS_ADMIN unless a new
  `opts.viaApprovalEngine` flag is set — set only by `approvals.ts`'s own settle-and-
  apply call once a chain (or an AUTO policy, or an all-self-held chain) has resolved
  it. The one deliberate behavior change: a person who custodies both ends of a
  transfer can no longer do it instantly — they go through the same routed path as
  everyone else, which itself still applies immediately when every resolved step
  turns out to be a post they themselves hold.

  `lib/server/resources/approvals.ts`: `requestTransfer` custody-checks the SOURCE
  only (never the destination — asking for a transfer must not require already
  custodying where it's going), resolves policy with worst-outcome-wins across a bulk
  selection's categories (DENY beats CHAIN beats AUTO, ported verbatim from `route()`),
  and for a CHAIN outcome builds the chain against a lightweight live `OrgNode`
  projection (no `org-chain.ts` ancestor walk needed — a transfer's own policies only
  ever use `ITEM_CUSTODIAN`/`OWNER_HEAD`/`TARGET_HEAD`/`REQUESTER_RECEIPT`, all direct
  lookups). `decideStep` re-resolves the current step's approver against FRESH org
  data on every call (a headship change mid-flight redirects who decides, never a
  frozen id); `REJECT` ends the whole request outright (no draft to preserve, unlike
  Track 2's lab commits); `APPROVE` arms the next step and, critically, **the actual
  `Item` write does not happen until the `REQUESTER_RECEIPT` step is itself approved**
  — it's just another step in the same chain, so the register only reflects a
  transfer once physical delivery is confirmed, with no need to model an "in transit"
  state. The eventual `applyChange` call is attributed to the ORIGINAL REQUESTER
  (never the last approver), passing the request's snapshotted `baseVersions` as
  `expectedVersions` so a stale write surfaces as the existing `VERSION_CONFLICT`
  path (caught, marks the request `STALE`) rather than a bespoke check.

  New read endpoint, `items.ts`'s `transferDestinations` (`GET /resources/transfers/
  destinations`) — deliberately the inverse of the existing `containers()`: no
  custody filter (the whole point is a destination OUTSIDE the requester's custody)
  and no `assertCanBrowseUniversity` gate (today `MANAGER`/`STORE_KEEPER`-only, which
  would have shut an ordinary custodian out of naming a transfer target at all).
  Narrowed instead by requiring a ≥2-character search query and capping results at
  25 — a "name the place you already have in mind" search, never a full cross-
  university browse/dump.

  UI: `TransferModal` (new) on Inspector's action row, next to the existing same-lab-
  only "Position" control — searches a destination, previews the resolution
  (`POST /resources/transfers/preview`, side-effect-free) before committing, shows
  "applies immediately" or the pending chain's labels. Deliberately keeps the current
  custodian (`targetCustodianId: null`) rather than adding a cross-department people
  picker in this first pass — once a transfer lands, the receiving side can reassign
  custody directly like any other item in their own custody chain. `/approvals` (was
  `ComingSoon` on this branch, since Track 2's own build-out of that page lives only
  on the unmerged `track-2-lab-drafts` branch) now renders a real `ApprovalsPage` with
  one "Transfers" panel, inbox/mine tabs, a chain-trail visualization per request
  (labels joined by →, current/waiting/approved/rejected/skipped/vacant distinguished
  by tag tone), and a `REQUESTER_RECEIPT` step's action button reading "Confirm
  receipt" rather than "Approve".

  Tests: `lib/server/resources/approvals.spec.ts`, 12 cases, DB-backed, every org node
  a freshly created ORPHAN node (no parent edges) rather than the shared seeded SE/
  ChemE departments — Track 2's lab-drafts.spec.ts had already found the hard way
  that mutating a shared node's occupancy breaks other concurrently-running spec
  files, and this file follows that lesson from the start rather than rediscovering
  it. The closed-loophole regression guard, run first; AUTO applies immediately with
  no `ChangeRequest` row; a CHAIN request's own custodian step is built `SKIPPED`
  (not `PENDING`) when the requester IS the custodian — the common real case; a
  vacant `OWNER_HEAD` blocks and an appointment unblocks immediately; a headship
  change mid-flight redirects the decision; the full happy path proving the `Item`
  untouched until `REQUESTER_RECEIPT`, then updated atomically and attributed to the
  requester; `REJECT` ending the request outright with the `Item` never touched; a
  version conflict at final settle marking the request `STALE`; `cancelRequest`
  requester-only; the existing custody floor for requesting a transfer of something
  not held.

  Verified: `npx tsc --noEmit` clean (after clearing a stale `.next/` type-cache and
  regenerating the Prisma client for this branch's own schema — a stale client from
  switching branches surfaced phantom `LabIdealTarget`-shaped errors that had nothing
  to do with this track); `npm test` — 315/315 (12 new); `npm run build` clean (all
  six new `/api/resources/transfers/**` routes present); `npx prisma validate`/
  `migrate status` clean, confirming no schema drift despite the branch switch.

  **Live, full end-to-end pass**, not just automated tests: seeded `ApprovalPolicy`
  (52 rows) against the local dev database via `seed-policies.ts --apply`. As the SE
  custodian (Girma Wolde), requested a transfer of a real item ("Whiteboard") into
  Chemical Engineering's "Mechanical Unit Operations Laboratory" through the actual
  `TransferModal` UI — the preview correctly showed "Head — Software Engineering →
  Receiving head — Chemical Engineering → Confirm receipt" (the `ITEM_CUSTODIAN` step
  correctly invisible, self-skipped, since the requester IS the item's custodian).
  Confirmed the new request appeared in the SE head's "Routed to me" tab and, once
  approved, the ChemE head's — both real accounts, not test fixtures. Approved as
  both heads via direct authenticated API calls; confirmed via a direct item read
  that `currentOrgNodeId` had NOT changed after either approval; confirmed receipt as
  the original requester and watched it flip atomically to Chemical Engineering, with
  `ownerOrgNodeId` unchanged (borrowing, not selling) and the audit log's `actorName`
  correctly reading "Girma Wolde" — the requester, not either approving head. Ran a
  second live transfer request, then vacated the SE headship mid-flight via the real
  `assign-node` endpoint: confirmed the pending request became undecidable (a direct
  decide attempt by the now-former head refused with 403, the step's live
  `approverId` reading `null`), reassigned the same head back, and confirmed it
  became immediately decidable with no rebuild. Rejected that same request at the
  ChemE head's step and confirmed it ended outright (`REJECTED`, the item never
  touched, a second decide attempt refused `409`). **All fixtures cleaned up
  afterward**: the two test `ChangeRequest`/`ChainStep` rows deleted directly: the
  "Whiteboard" item's real move was reverted via two ordinary SYS_ADMIN-attributed
  corrections (`moveInTree` back to its original parent, `setCurrentOrg` back to
  Software Engineering) rather than left in its moved state — restored to byte-
  identical `currentOrgNodeId`/`ownerOrgNodeId`/`path`/`custodianId` as before this
  session touched it. The seeded `ApprovalPolicy` rows were deliberately LEFT in
  place (unlike Track 1's own `AccessView` rollout, which was rolled back after
  verification) — they are inert for every operation except `transferItem`, which is
  this track's own point, so leaving them matches the "ship it seeded, safe by
  construction" design rather than requiring a second manual step before the feature
  actually works locally.

- **2026-09-08 (later)** — `track-2-lab-drafts` merged into `track-3-transfers` (the
  user was explicit: not into `master`, not this cycle). A real three-way merge with
  four genuine conflicts, each resolved by hand rather than picking one side:
  - `mutate.ts`: both tracks independently extended `assertAuthorized`'s signature
    and inserted a new check right after the `SYS_ADMIN` early-return. Combined into
    one signature carrying both `bypassDraftWorkflowBlock` and `viaApprovalEngine`,
    with Track 3's transfer-loophole check running first, Track 2's draft-workflow
    check second. **A real interaction bug found DURING the merge, not after**: Track
    2's `assertDraftWorkflowNotBlocking` would have checked a `transferItem`
    payload's SOURCE item's owning department for `draftWorkflowEnabled` — meaning an
    approved transfer's own finalizing `applyChange` call (which carries
    `viaApprovalEngine: true` but not `bypassDraftWorkflowBlock: true`) would have
    been incorrectly refused whenever that department happened to have draft mode
    on. Fixed by exempting `transferItem` from that check outright — it already has
    its own dedicated approval path (Track 3) entirely separate from a department's
    draft toggle, matching `lab-drafts.ts`'s own `NOT_STAGEABLE` set, which already
    excluded `transferItem` for the identical reason.
  - `Inspector.tsx`: one import line and one `useState` line each, from the two
    tracks' independent UI additions (`TransferModal` / `LabDraftPanel`) — both kept,
    trivial.
  - `components/resources/ApprovalsPage.tsx`: an add/add conflict — both tracks
    built this file from scratch with genuinely different shapes (Track 3's
    multi-step `ChangeRequestDto` chain vs. Track 2's single-decider
    `LabCommitRequestDto`). Rewritten as two independent panels (`TransfersPanel`,
    `LabCommitsPanel`, each with its own tab state and endpoint) stacked on one
    `Screen`, per the original plan's own §6.6 description of the target shape —
    not a guess made during the merge.
  - `PROGRESS.md`: both tracks appended a Timeline entry at the same point;
    reordered chronologically (Track 2's 2026-09-07/08 entry before Track 3's) and
    corrected Track 3's own opening paragraph, which had (accurately, at the time it
    was written) said Track 2 wasn't merged in yet.

  Regenerated the Prisma client for the merged schema (Track 2's `ItemDraftChange`/
  `LabCommitRequest`/`LabIdealTarget`/`OrgNode.draftWorkflowEnabled` now present) —
  `npx prisma generate` initially hit the known Windows file-lock issue from a dev
  server still holding the query-engine DLL; stopped it first. Verified: `npx tsc
  --noEmit` clean (after clearing `.next/`'s stale type cache again); `npm test` —
  **326/326**, both tracks' DB-backed suites passing together in the same run
  (`lab-drafts.spec.ts` 11, `approvals.spec.ts` 12); `npm run build` clean, every
  route from both tracks present (`/api/resources/lab-commits/**`,
  `/api/resources/labs/**`, `/api/org/nodes/[id]/draft-workflow` from Track 2;
  `/api/resources/transfers/**` from Track 3); `npx prisma validate` clean;
  `npx prisma migrate status` — up to date at 13 migrations, confirming Track 2's
  migration had already been physically applied to this shared local dev database
  (branches share one Postgres instance; only the migrations FOLDER differed by
  branch) rather than needing a fresh `migrate deploy`.

  Then, per the user's explicit request, flipped Software Engineering's
  `draftWorkflowEnabled` to `true` on the local dev database via Org Studio's own
  toggle (Track 1/2's existing admin affordance) — the first real department running
  with it on outside a verification pass. Girma Wolde (SE custodian) briefly staged
  changes instead of applying them instantly; `head.se@astu.edu.et` decided them via
  the "Lab commits" panel on `/approvals`, alongside the "Transfers" panel from
  Track 3.

  **Correction, same day**: leaving the toggle on turned out to have a real cost —
  running the full test suite afterward failed 25 tests across 5 files
  (`views.spec.ts` among them), all for the same reason: those older spec files
  write directly against the REAL seeded Software Engineering `OrgNode` as a shared
  fixture (predating the "always use an isolated orphan node" lesson Track 2/3's own
  newer specs already learned), and every one of their direct-write assertions
  assumed SE behaves as it does in today's production state — direct edits succeed.
  With the toggle genuinely on, those direct writes now correctly refuse (the
  feature working exactly as designed), which the old fixtures read as failure.
  Reverted SE's `draftWorkflowEnabled` back to `false` via
  `prisma.orgNode.updateMany` (not `update` — `name` isn't a unique field) to
  restore a clean, all-green baseline before continuing other work; confirmed
  326/326 passing again immediately after. **Still open**: enabling this toggle for
  any real department will keep breaking those 5 older files' fixtures until they're
  hardened to use isolated org nodes the same way `lab-drafts.spec.ts`/
  `approvals.spec.ts` already do — a well-scoped, self-contained follow-up, not done
  as part of this correction. The toggle is off for every department again, matching
  today's actual production state.

- **2026-09-08 (later still)** — Inspector reworked into `temp_works`' own
  click-through-the-hierarchy-then-pick-a-change-kind pattern, at the user's
  explicit request after they pointed at that sandbox's `Inspector.tsx`/
  `ItemActionModal.tsx` as the reference. Read all four of `temp_works`' editing
  components (`Inspector`, `ItemActionModal`, `ItemEditModal`, `RouteNotice`) before
  scoping down: `ItemEditModal`'s "Category type" tab duplicates this app's own
  standalone Category Studio (kept as the one place for that, not re-added here),
  and `ItemActionModal`'s per-tab live route preview only makes sense where a real
  approval chain exists — here that's `transferItem` alone (Track 3), so it was
  deliberately left out; every other kind still applies directly, exactly as it did
  before this round. Two scoping questions put to the user directly rather than
  guessed at: keep transfer preview out of scope entirely (confirmed — it already
  has its own dedicated `TransferModal`), and keep Inspector as today's centered
  Modal rather than temp_works' slide-over Sheet, but add the children/parent
  navigation itself (confirmed).

  `lib/shared/resources/item.ts` gained `ItemChildDto` and `ItemDetailDto.children`
  — direct children only, computed in `items.ts`'s `getOne` from the forest's
  already-loaded `TreeIndex.childrenOf`, filtered to the SAME `closed`
  (ancestor-closure) visibility a list read already grants, so clicking one to
  navigate never lands on a 404 the child's own scope would have refused anyway.

  New `components/resources/ChangeModal.tsx` — the `ItemActionModal` port: six tabs
  (Status / Custody / Ownership / Current unit / Position / Delete — Name stays an
  instant inline correction, matching this app's own `CONFIRMED_CHANGES` rule rather
  than temp_works' divergent one), each showing current → new before submitting,
  submitting directly against the existing write door (no second `ConfirmDialog`
  layered on top — the modal's own clear current→new framing and explicit submit
  button ARE the confirmation step, matching temp_works' own design exactly).

  `Inspector.tsx`: removed the five scattered inline `<select>`s for Custodian/
  Owning unit/Current unit/Position (each with its own `requestX` function feeding
  `usePendingChange`'s `ConfirmDialog`) and the standalone "Delete resource" button,
  replacing all of them with one "Change this…" entry point into the new modal —
  Transfer stays its own separate button (Track 3's own flow, deliberately excluded
  from the new modal per the scoping decision above). Added a new "Contains (N)"
  section (both the editable body and `ReadOnlyBody`, via a shared `ContainsSection`
  — the row shape and behavior are identical, only the enclosing screen's edit
  rights differ, which this section has no part in) listing direct children as
  clickable rows; clicking one calls a new `onNavigate?: (id: string) => void` prop
  that all four call sites (`RegisterPage`/`DashboardPage`/`ChangeLogPage`/
  `UniversityPage`) wire to their own existing `setInspectId` — Inspector itself
  keeps no navigation history, it just re-renders against whatever id the parent
  page's own state points at, which its existing `useEffect(load, [itemId])` already
  handled correctly with no change needed there. "Go up" is the breadcrumb path
  itself, now a button when `item.parentId` exists, navigating to it directly (the
  immediate parent only, not full ancestor-chain clickability, per what was asked
  for) — `usePendingChange` stays wired for the corrections that remain (name,
  quantity, properties, custom properties, image add/remove), unaffected by any of
  this.

  Verified: `npx tsc --noEmit` clean, `npm test` — 326/326 unaffected (confirming
  the earlier toggle-related failures were unrelated to this change, not masked by
  it), `npm run build` clean. Live in-browser as the SE custodian: opened "SE Lab X
  Software Lab 3", confirmed the new Accountability/Contains sections and the
  "Change this…"/"Transfer to another unit…" button pair render correctly with no
  standalone Delete button left over; clicked into a child ("Switch Rack") and
  confirmed the Inspector navigated to it in place with a working "Go up to SE Lab X
  Software Lab 3" link back; opened "Change this…", switched between Status and
  Custody tabs and confirmed the blurb/current-new/options all update correctly per
  tab; ran a REAL status change end to end (Working → Broken, applied, version
  bumped, modal closed and Inspector auto-reloaded showing the new chip) and
  reverted it the same way (Broken → Working) — confirmed the final derived state
  (Working/Impaired, matching Switch Rack's own Impaired status rolling up)
  byte-identical to before the test, only the version counter legitimately higher
  from the two real edits. Checked the Delete tab's own rendering (danger styling,
  current→new, warning copy) without submitting it.

- **2026-09-10** — Track 4 (purchasing/procurement) planned and implemented, on
  `track-3-transfers` (continuing the same branch, at explicit instruction — not a
  fresh branch off `master`). Full design at
  `~/.claude/plans/replicated-sparking-gray.md`.

  **The approval ladder is the org chart itself, not a fixed named sequence** — the
  one real design departure from `temp_works`' own `PURCHASE_LADDER` (which
  hardcoded fixture ids like `"cmd-office"`/`"proc-office"`, meaningless against a
  real chart). Resolved directly with the user: a department's request walks
  `OWNER_HEAD` → `HIERARCHY` all the way to `UNIVERSITY` (both branches of a
  multi-parent department required, not a choice between them — confirmed live with
  a two-college test department) → `NODE_OCCUPANT` on the real "Procurement Office"
  node, reusing `lib/domain/approvals.ts`'s existing selectors completely unchanged.
  The university root's own occupant fills the AVP role implicitly — no separate
  office needed. Sequential arming (today's shared-engine behaviour) was kept
  deliberately, not made simultaneous, per explicit instruction: "keep the
  sequential one... if it feels off I will make it simultaneously" — a real
  discovery surfaced en route was that `OrgNode.userId` is unique, so "simultaneous"
  would need a genuinely different mechanism than today's engine provides, not a
  toggle.

  **No changes to the shared chain engine.** `PurchaseStep` (new Prisma model) is a
  sibling of `ChainStep`, not a variant — `ChainStep` is hard-tied to
  `ChangeRequest`'s Item-shaped payload/`baseVersions`, which a purchase request has
  no use for (it has no item to point at yet). Fed through the exact same pure
  `buildChain`/`activate`/`canDecide`/`resolveApprover`/`chainSettled` functions
  Track 3's own `lib/server/resources/approvals.ts` already proved live — new
  `lib/server/resources/purchasing.ts` mirrors that module's pattern closely.
  `lib/shared/resources/purchasing.ts`'s `PurchaseRequestDto` gained one field,
  `steps: ChainStepDto[]`, reusing the already-generic `ChainStepDto` verbatim.

  Server module covers the full lifecycle: `raiseNeed`/`listOpenNeeds`/
  `listMyNeeds`/`declineNeed` for `NeedLine`; `compilePurchaseRequest` (builds the
  chain, straight into `APPROVING` — no separate draft-then-submit step in this
  first pass) and `reviseAndResubmit` (REVISE clears the in-flight `PurchaseStep`
  rows and rebuilds fresh, since they're working state, not an audit log, matching
  Track 2/3's own established discipline) for `PurchaseRequest`; `decideStep` with
  three outcomes (`APPROVE`/`REJECT`/**`REVISE`**, the one decision transfers don't
  have); `advanceStage` for the four-stage reporting pipeline; `receivePurchaseLine`
  as the one seam back into the register (`applyChange`'s ordinary `createItem` —
  SERIALIZED receives one root item per unit, BULK receives one root at `count: 1`
  then a follow-up `setQuantity` to the received amount — cumulative across several
  deliveries, auto-closing the request once every line's own received amount meets
  its ordered amount). `listForActor` gained two boxes beyond transfers' own
  `inbox`/`mine`: `pipeline` (procurement's university-wide view of everything it's
  running) and `receiving` (the store keeper's own view of what's at `IN_STORE`) —
  a gap found while building the UI, not anticipated in the original plan.

  A real bug found and fixed during the FIRST live pass, not by inspection: `decideStep`'s
  REVISE branch and `receivePurchaseLine` both called the public, access-gated
  `getRequest` to return their own result — but `getRequest`'s "who may read this"
  check (requester, or a step's live approver/decider) doesn't recognize a REVISE
  decider once every step is cleared, or a receiving STORE_KEEPER who was never a
  chain-approval party at all, so both actions incorrectly 404'd on their own output.
  Fixed by adding a private `loadDto` (no access check) that every mutating function
  returns through, keeping the public `getRequest` — used only by the GET route — as
  the sole place enforcing that gate.

  UI: `components/resources/PurchasingPage.tsx` (new, wired at `/purchasing`,
  replacing its `ComingSoon`) — raise-a-need form, a head's compile-a-request panel
  (an open-need dropdown per line auto-fills name/qty/unit/category), "My requests"
  with inline revise-and-resubmit and withdraw, a procurement-only Pipeline panel,
  and a store-keeper-only Receive panel (reusing the existing `/resources/items/
  containers` picker behind Add-resource/Move, exactly as the plan intended — no new
  picker built). `ApprovalsPage.tsx` gained a third panel, `PurchasingPanel`,
  alongside the existing Transfers/Lab-commits ones, with the extra REVISE button
  the other two panels don't need. `lib/nav.ts`'s pre-existing `"purchasing"` entry
  gained a `roles` list excluding STUDENT, matching `canRaiseNeed`'s own gate.

  Tests: `lib/server/resources/purchasing.spec.ts`, 15 cases, DB-backed, every org
  node a freshly created orphan (including a genuine two-college department for the
  multi-parent case) — plus one wrinkle neither Track 2 nor Track 3 had to handle:
  `findProcurementOffice` resolves by NAME across the whole org chart, so the test
  file temporarily deactivates any real "Procurement Office" for its own run and
  restores it in `afterAll`, rather than risking an "ambiguous" refusal against
  whatever this track's own live-verification pass leaves behind. A first full run
  surfaced `OrgNode.userId`'s uniqueness the hard way (a fixture tried to make one
  person head three nodes at once) and several decide-sequence bugs where a test
  assumed the compiling head's own self-skipped step was still decidable — both
  fixed in the fixtures, not the product code.

  **Verified live**, end to end, on the real dev database: as SYS_ADMIN, created a
  real "Procurement Office" `OFFICE`-kind node and invited a real Procurement
  Officer account to it (catching and correcting an actual invite-form slip along
  the way — a double-click on the role toggle left them as `manager` instead of
  `procurement`, fixed via Manage before continuing) — this is genuine new
  infrastructure this track needs going forward, left in place afterward, matching
  Track 3's own precedent for its seeded `ApprovalPolicy` rows. Invited a temporary
  CoEEC Dean to unblock the college-level step (Software Engineering's own college
  was headless in the seed data) and a temporary store-keeper account. As the real
  SE custodian, raised a need through the actual UI; as the real SE head, compiled a
  request carrying it — confirmed the resolved chain live: dept head self-skipped,
  dean/AVP/Procurement all correctly resolved against the real chart. Approved each
  real step as the correct real accounts in sequence through the real Approvals
  page; advanced the real pipeline through all four stages as Procurement; received
  the line as SYS_ADMIN (who also satisfies `canReceive`) into the real "ASTU Main
  Store" — confirmed a genuine new `Item` row in the register and the request
  auto-closing to `CLOSED`.

  **A second real bug found only by reading the resulting register row, not by
  re-reading the code**: the received item was named after its *category*'s own
  generic auto-numbering ("Computer 01") rather than what was actually purchased
  ("Oscilloscope") — `receivePurchaseLine` built its `createItem` change without
  ever passing the purchase line's own `name` through. Fixed by passing `name:
  line.name`; added a regression assertion to both the SERIALIZED and BULK
  automated tests, re-ran (15/15 clean) — the fix was verified by the test suite,
  not re-driven through the browser a second time, since the live pass had already
  exhausted the wiring/UI/auth path the bug lived outside of.

  A genuine, pre-existing gap found along the way, unrelated to this track: the
  Inspector's own "Change this… → Custody" picker is derived from custodians already
  visible in the currently-loaded item forest, not a live people search — a
  brand-new `STORE_KEEPER` who has never custodied anything cannot be assigned
  custody of an existing item through that UI at all (a chicken-and-egg gap). Not
  fixed here (out of scope for this track); worked around during verification by
  having SYS_ADMIN receive directly, since `canReceive`/`assertCanMutate` both
  already permit that.

  All verification fixtures cleaned up afterward: the two mis-named test items
  (and their full auto-instantiated category subtree — "Computer" carries default
  children) deleted, the test `PurchaseRequest`/`NeedLine` deleted, the CoEEC
  Dean's headship vacated and the account **disabled** rather than deleted
  (`OrgNodeAssignment` is a permanent occupancy ledger; hard-deleting the user
  would have violated it — the same "someone's tenure ended" handling Personnel's
  own Deactivate already uses), the unused store-keeper test account removed
  outright. Final state confirmed by direct query: 741 items (unchanged from
  before this round), zero `PurchaseRequest`/`NeedLine` rows, and the Procurement
  Office node/occupant the only lasting change — exactly the real infrastructure
  this track was meant to add. `npx tsc --noEmit`, `npm test` (**341/341**),
  `npm run build`, `npx prisma validate`/`migrate status` all clean throughout.

- **2026-09-13** — End-to-end lab lifecycle: gaps closed, then the whole loop walked
  on real data. Plan: `~/.claude/plans/i-have-added-multiple-federated-reddy.md`; full
  scene-by-scene log: `docs/e2e-lifecycle-run.md`. Still on `track-3-transfers`.

  The user wanted one continuous process working before lab booking:

  - custodian sets ideal, then current data in drafts;
  - the head approves;
  - cross-department transfer;
  - the head computes purchasables from ideal vs current;
  - the college (and every higher office) sends it back and the head reduces;
  - procurement runs the pipeline, visible to everyone involved;
  - the store receives;
  - the store hands stock to labs.

  Reading the code against that found 3 missing and 3 partial pieces. User decisions:

  - build the gaps first, then test;
  - the department head (not admin) approves drafts;
  - the **store keeper pushes** stock, with the receiving head approving and the
    receiving custodian accepting;
  - run on the real SE/ChemE data and clean up afterwards.

  **Part A (commit `a492fbc`)**:

  - **(A1)** `LabDraftPanel` stages "Add resource" (`createItem`); the approvals diff names
    category and count.
  - **(A2)** `lib/domain/purchasables.ts` plus `lab-drafts.ts`'s
    `getDepartmentPurchasables`, served at
    `GET /api/resources/departments/:nodeId/purchasables`. It rolls every owned lab's
    ideal-vs-actual up per category, with gaps floored per lab so one lab's surplus never
    cancels another's shortage. The head's compile panel computes it and prefills lines
    with per-lab justifications.
  - **(A3)** `PurchaseEvent` written for every submit, decision, resubmit and cancel, so
    send-back cycles survive REVISE deleting the steps. `readableRequestWhere` (unit
    members, occupants of the unit or any ancestor via `OrgClosure`, chain offices, need
    raisers, purchasing roles) backs `getRequest` and a new `box=tracking`. The Purchasing
    page gained a status panel, a history timeline and decision notes; needs show which
    request carried them.
  - **(A4)** `pol-store-transfer` now routes `[TARGET_HEAD, TARGET_CUSTODIAN]`
    (re-seeded). `transferItem.transfer.transferOwnership` (store keeper/SYS_ADMIN only)
    moves owner and custody with audit lines. `TransferModal` is multi-item with a
    store-keeper "Hand over" option, and the Register bulk toolbar gained "Transfer…".
  - **(A5)** The Custody picker offers every active custodian, store keeper or head, not
    only people already holding something.

  **Part B**: `prisma/e2e-workflow-fixture.ts` is dev-only and reversible
  (`--setup` / `--teardown` / report). It reactivates the CoEEC dean, creates a store
  keeper and sets known passwords. Teardown removes every workflow row and soft-deletes
  every item the cast created (never admin's). Its state file is gitignored.

  All 11 scenes (S0–S10) passed. How it was driven:

  - Nobody had this session's window open, so the Browser pane could not draw.
  - Another session's `next dev` already held :3000 for this folder, and a second
    `next dev` refuses to start.
  - The UI was therefore driven by dispatching real DOM events on the rendered React
    components, with every outcome read back from the page and confirmed in Postgres.

  **Two real defects found and fixed live, each with a regression test**:

  1. A tree selection ticks a row's whole subtree, and bulk Transfer — and the
     pre-existing bulk Move — treated every ticked id as a root. That would pull nested
     parts out into the destination.
     - The server now collapses move/transfer selections to top-most items
       (`mutate.ts` `topMostItemIds`).
     - The Register sends and labels top-most ids only.
     - The modal had not been submitted before the fix.
  2. Purchase history notes duplicated the stage label.

  **Open findings for the user**:

  - Each delivery restarts receipt numbering at 01 (medium).
  - The Receive "Into" picker lists every nested container (low).
  - A rejected lab commit card no longer lists its changes (low).
  - A borrowed item is editable by the host lab's custodian, because custody resolves
    through containment (design question).

  Teardown restored the baseline: 750 items, 0 workflow rows, SE draft mode off, dean and
  store keeper disabled, CoEEC vacant, Main Store back with admin. (750 rather than
  2026-09-10's 747: the 3 extra are leftovers from the test suite's placement specs.) The
  approval policies stay re-seeded with the new store chain. `tsc` clean,
  `npm test` 353/353 (one run hit the documented `views.spec.ts` shared-DB flake, then
  green), `npm run build` clean.

- **2026-09-14** — Planned the next four tracks, then built Track 5 (pull transfers). Plan:
  `~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md`. New branch
  `track-5-scheduling`, cut from `track-3-transfers`. The four tracks:

  - **Track 5**: transfers become pull-initiated, and custodians can browse the whole
    university.
  - **Track 6**: the scheduling core. Weekly class slots, staff bookings approved by the
    lab's custodian, and a Postgres exclusion constraint against double-booking.
  - **Track 7**: a public portal (counts of flagged categories only) and the external
    booking workflow. Requester → AVP → department heads (Google Sheet quote link) → quote
    → tentative HELD reservations.
  - **Track 8**: payment verification through a self-hosted `Vixen878/verifier-api`,
    behind a driver interface, with manual fallback; verified payment confirms the holds.

  User decisions:

  - Push is kept only for the store keeper's handover.
  - Timetable slots carry their own date range; there is no academic-term model.
  - External holds are placed at feasibility time and expire if unpaid.
  - The verifier is self-hosted.
  - Only admin-flagged categories are public.
  - The lab custodian approves staff bookings.

  **Track 5, what changed**:

  - **Browse**: `UNIVERSITY_BROWSE_ROLES` gains `CUSTODIAN` (the nav entry too).
  - **Pull request**: `approvals.ts` has a new `assertTransferParties`. A non-handover
    request is checked against the destination: the requester must be able to write it,
    and must not already hold the source (that's a Move, 400). The receiving unit comes
    from the destination's `currentOrgNodeId`, not the client. `targetCustodianId` stays
    null, so it's still a borrow and the lender keeps custody.
  - **Handover**: the store keeper/SYS_ADMIN path is unchanged.
  - **Destination search**: `transferDestinations` is now store keeper/SYS_ADMIN only.
  - **Chain**: `pol-transfer-cust` already fits pull with no re-seed. The item's custodian
    now genuinely decides first, then the owning head, the requester's head, and the
    requester's receipt.

  **A real apply-time bug avoided by reading, before shipping**:

  - The settle call `applyChange(requester, …, {viaApprovalEngine})` fell through to
    `assertCanMutate(requester, sourceItems)`, and `applyTransferItem` re-ran
    `assertSubtreeInScope` against the requester.
  - Every approved pull would therefore have gone STALE ("Resource not found") at the
    receipt step, because the requester by definition doesn't hold what they asked for.
  - Fix in `mutate.ts`: a non-ownership `transferItem` arriving via the approval engine is
    authorized by its settled chain. It re-checks only that the requester still holds the
    destination, and skips the source-subtree custody check. A handover keeps both checks.
  - A new regression test covers losing custody of the destination mid-flight: the request
    goes STALE instead of landing somewhere the requester no longer holds.

  **UI**:

  - Inspector's "Transfer to another unit…" and the Register's bulk "Transfer…" render
    only for STORE_KEEPER/SYS_ADMIN, relabelled "Hand over…". `TransferModal` is now
    handover-only.
  - New `PullTransferModal`:
    - "Into" is one of my containers, from `/items/containers` intersected across
      categories and sorted by path;
    - optional note;
    - live chain preview showing approver names.
  - `UniversityPage` rows are selectable, with a "Request transfer to my lab…" toolbar.
    Selections collapse to top-most items and exclude rows the viewer already holds.
    Inspector gets a `canRequestPull` prop that shows "Request to my lab…" in its
    read-only body.
  - Fixed a pre-existing duplicate React key in the university rollup: rows were keyed by
    unit and category names, and leftover test categories share names. They're now keyed
    by ids.

  **Tests**: `approvals.spec.ts` was rewritten to pull shape. Every request is raised by
  the destination's custodian against a lender's item. Added cases:

  - the lender's custodian step is armed first;
  - the receiving unit is derived even when the client sends a decoy;
  - losing destination custody → STALE;
  - pulling into a destination you don't hold → 404 (request and preview);
  - pulling your own item → 400.

  `university-scope.spec.ts` now expects CUSTODIAN allowed and STAFF refused.

  **Verified**: `tsc` clean, `npm test` 356/356 (DB-backed hooks need
  `--hookTimeout 60000` on a cold run; the default 10s timed out once, before any test ran),
  `npm run build` clean.

  **Live walkthrough on the real dev DB.** Password entry into forms isn't allowed for this
  session, so dev sessions were minted directly into `Session` for the seeded accounts and
  deleted afterwards.

  - As Hanna Bekele (ChemE custodian), University resources showed the new nav entry and
    checkboxes. Searched "Whiteboard", ticked SE's Whiteboard and opened the modal. The
    preview read "Current custodian (Girma Wolde) → Head — SE → Receiving head — ChemE →
    Confirm receipt (Hanna Bekele)". Requested into "Mechanical Unit Operations
    Laboratory".
  - The DB showed PENDING, with `targetOrgNodeId` filled server-side.
  - As Girma, saw it under Approvals → Routed to me and approved through the real dialog.
  - SE head approved. Hanna trying to decide early → 403. ChemE head approved. Hanna
    confirmed receipt → **APPLIED**, the Whiteboard in her lab, still SE-owned and
    Girma-custodied.
  - As Girma: the handover destinations endpoint → 403. A direct push request of his own
    lab into ChemE → 404. His Inspector shows "Change this…" with no transfer or hand-over
    button.

  **Cleanup**: the Whiteboard was restored via two SYS_ADMIN corrections (`moveInTree` back
  to SE Lab X, `setCurrentOrg` back to SE), leaving the parent, units and custodian as they
  were before the walkthrough. The test `ChangeRequest`/steps and the 5 minted sessions were
  deleted. Counts: 750 items, 0 change requests.

  **Still open (pre-existing)**: the "Into" picker lists every nested container (e.g. a
  whiteboard "inside Acetone"). It's now sorted shallow-first, but not filtered.

- **2026-09-14 (later)** — Track 6: the scheduling core. Weekly class slots, staff
  bookings approved by the room's custodian, and a real double-booking guard. Plan:
  `~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md`. Same branch
  (`track-5-scheduling`).

  **Bookability is configured, not inferred.**

  - `ResourceCategory` gains `bookingMode` (`NOT_BOOKABLE` default | `ROOM` |
    `EQUIPMENT`) and `publicListed` (for Track 7).
  - Category Studio has a "Scheduling and the public portal" section, and category tags
    show both.
  - `categories.ts` refuses a bookable BULK category with a 400, and audits each flag
    change ("booking mode", "public portal").
  - `CreateCategoryInput` takes both as optional, not defaulted, so the 15 existing
    `categories.create` callers didn't need changing.

  **Schema** (migration `20260914090000_scheduling_core`):

  - Models: `ScheduleSeries`, `ScheduleSeriesResource`, `ScheduleSeriesException` (keyed
    by civil date), `Reservation` and `ReservationResource`.
  - `Reservation` is one calendar table. Sources are CLASS/STAFF/EXTERNAL/MAINTENANCE;
    states are REQUESTED/HELD/CONFIRMED/DECLINED/CANCELLED/EXPIRED. Instants are
    `timestamptz`; `occursOnLocal` is a DATE.
  - `ReservationResource` denormalises the window, plus a `blocking` flag that tracks
    "parent HELD or CONFIRMED".
  - Raw SQL in the same migration:
    - `btree_gist`;
    - a generated `period tstzrange` (half-open);
    - `EXCLUDE USING gist ("itemId" WITH =, period WITH &&) WHERE (blocking)`;
    - time-order CHECKs on both tables.
  - `period` is declared as `Unsupported("tstzrange")` with the exact `dbgenerated(...)`
    default introspection reports. `migrate diff` now shows no drift. The first attempt
    without it would have made a future migration drop the generated column.

  **Pure domain**:

  - `lib/domain/civil-time.ts`: civil↔instant via `Intl` with two-pass DST handling,
    ISO weekdays, `expandSeries` with exceptions and `fromDate`.
  - `lib/domain/availability.ts`: the hierarchical clash rule. Same item, or a room and
    anything inside it; sibling machines never clash; windows are half-open;
    blocking vs contending.
  - Specs cover both, including the sandbox's 3-hour Addis shift as a regression case
    (08:00 local = 05:00Z).

  **Server** (`lib/server/scheduling/**`):

  - `context.ts`:
    - lineage and subtree recursive CTEs;
    - `resolveBookingTarget` (bookable, WORKING, one room);
    - `lockTree` (`pg_advisory_xact_lock(hashtext(root))`);
    - `expireHolds`, swept inside every write's lock and in preview;
    - `loadClaims`, clash DTOs, 23P01 → 409, DTO mapping with `canDecide`/`canCancel`.
  - `reservations.ts`:
    - `previewBooking`;
    - `createStaffBooking`: REQUESTED, or CONFIRMED when the actor custodies the room;
    - `decideBooking`: the room's custodian re-checks under the lock;
    - `cancelBooking`: requester or custodian; cancelling a CLASS occurrence also writes
      a series exception;
    - `listCalendar`, `listBookings` (mine/inbox), `searchBookables` (≥2 chars, 25 max),
      `myLabs`, `getLab`.
  - `series.ts`:
    - create/update/remove;
    - generation replaces only future occurrences and bumps `generation`;
    - it refuses with a 409 carrying `clashes` and writes nothing, never evicting a
      confirmed booking;
    - add/remove exception.
  - Booking roles: SYS_ADMIN, MANAGER, CUSTODIAN, STAFF. Students are booked through the
    "on behalf of" note.
  - 11 routes under `/api/scheduling/**`.

  **UI**:

  - New sidebar entry "Schedule" (`/schedule`).
  - `components/scheduling/WeekCalendar.tsx`: CSS-grid week, 07:00–21:00, greedy lanes
    for overlaps, colour by source, dashed when not settled, click an empty hour to book.
  - `SchedulePage.tsx` tabs:
    - **My labs** (only if you keep a room): calendar, "Book this room…", "Add weekly
      class…", requests waiting on you, weekly classes with Remove.
    - **Book**: search → the room's week → form with room vs specific machines,
      date/times, purpose, people, on-behalf-of, and a live preview (free / already
      taken / others also asked).
    - **My bookings**.
  - `ApprovalsPage.tsx` gains a "Lab bookings" panel.

  **Tests**: `scheduling.spec.ts` (11, DB-backed, orphan node/categories/items) plus 18
  pure cases. The DB cases:

  - the constraint refuses overlapping blocking claims, but allows non-blocking and
    back-to-back ones;
  - inverted range refused;
  - staff REQUESTED vs custodian CONFIRMED;
  - room↔machine clashes both ways;
  - contending requests, with approving the second refused;
  - cancel permissions;
  - student, non-bookable, past and inverted bookings refused;
  - a lapsed hold stops blocking;
  - series generation, exception, regeneration keeping the exception, removal;
  - series refused on a clash with nothing written;
  - custodian-only timetable.

  One fixture collision surfaced on the first run: two tests used the same future day.
  It was the product correctly reporting a real clash, and the fix was in the fixture.

  **Verified**: `tsc` clean, `npm test` **385/385**, `npm run build` clean (all 11
  scheduling routes plus `/schedule`), `prisma migrate status` up to date. The
  `migrate diff` against the live DB is empty.

  **Live walkthrough on the real dev DB** (dev sessions minted, as in Track 5):

  - As SYS_ADMIN in Category Studio, set Lab → "Bookable room" through Review → Apply.
    The change log shows "booking mode NOT_BOOKABLE → ROOM".
  - Set Computer → EQUIPMENT via the same PATCH. A bulk category (Chemical) set to ROOM
    → 400.
  - As Girma (SE custodian), Schedule opened on My labs → SE Lab X. Added "SE3102
    Operating Systems Lab · A", Mon+Wed 08:00–10:00, 2026-09-21 → 10-14, through the real
    form → 8 upcoming sessions. The next week's calendar drew both blocks in the 08:00
    band, and the API reads `startsAt 2026-09-21T05:00:00.000Z`.
  - As the SE head (no rooms, so the page opened on Book), searched "Computer 0" and
    picked Computer 01. For 2026-09-21 09:00–10:00 the preview said "Already taken … SE3102
    (Class, confirmed) · Computer 01 vs SE Lab X". Moved to 10:00–12:00 → "Free. Waits
    for Girma Wolde", with on-behalf-of "Sara Tesfaye (UGR/1234/13)" → requested.
  - As Girma, Approvals → Lab bookings showed it with the advisee note. Approved →
    CONFIRMED, back-to-back with the class.
  - Race check: three simultaneous identical booking POSTs → exactly one 201, two 409.
  - No server errors.

  **Cleanup**: the 10 test reservations, the series and 3 minted sessions were deleted
  (0 reservations/series left, 750 items). **Deliberately left in place**: Lab = ROOM
  and Computer = EQUIPMENT. That's the configuration the feature needs to be usable
  locally, and it matches the precedent of Track 3's seeded policies. It's audited in the
  change log; unset it in Category Studio if unwanted.

  **Disclosed trims**:

  - No academic-term model (by decision).
  - Bookability is category-level only.
  - `participantCount` is recorded, not validated against seats.
  - The calendar shows one room at a time.
  - Cron-based hold expiry arrives with Track 7; writes already sweep their own lab.

- **2026-09-14 (later still)** — Track 7: the public portal and the external booking
  workflow. Plan: `~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md`.
  Same branch.

  **Flow**: requester (no account) → AVP forwards to departments → custodians HOLD slots
  → each head accepts (Google Sheet link + amount) or declines → AVP sends one quote →
  (Track 8) verified payment confirms the holds.

  **Schema** (migration `20260914120000_external_requests`):

  - `ExternalRequest`:
    - reference `EXT-YYYY-NNN`;
    - status SUBMITTED / UNDER_REVIEW / QUOTED / PAYMENT_SUBMITTED / PAID / SCHEDULED /
      DECLINED / CANCELLED / EXPIRED;
    - contact fields, lines JSON, and letter storage key/name/size;
    - `trackingTokenHash` (hashed at rest), `submitterIpHash`;
    - quote amount in integer santim, deadline, closing note.
  - `ExternalRequestWindow` (civil date/times plus instants), `ExternalRequestAssignment`
    (per department: status, sheet URL, amount, `noCalendarNeeded`, note, decider) and
    `ExternalRequestEvent` (append-only).
  - `Reservation.externalRequestId` links holds.

  **Public** (`proxy.ts` matcher excludes `portal`; `/api` was already excluded):

  - `/portal`: counts of `publicListed` categories, working items only. Served by
    `items.ts publicCatalog()` over the same forest/derived-status engine, with an edge
    cache header. It returns counts, name and icon only; never units, locations or items.
  - `/portal/request`: organisation, contact, purpose, dates (up to 10, Addis time),
    free-text lines with an optional catalog kind, and the PDF letter.
    - `POST /api/public/requests` (multipart) checks `%PDF-` bytes and a 4 MB limit.
    - Also: a honeypot, and a throttle of 3 per email and 10 per IP-hash per day, counted
      from the table.
    - Dates must be at least a day ahead. The letter goes through the existing
      `StorageDriver`.
    - A reference collision under concurrency retries on P2002.
  - `/portal/track/[token]`: status, quote (amount, deadline, bank from
    `UNIVERSITY_BANK_*` env, accepted sheet links), a public-safe timeline that hides
    internal events like holds and department decisions, and cancel before payment.

  **Staff** (`lib/server/external/requests.ts`):

  - The AVP is the occupant of an active UNIVERSITY node, or SYS_ADMIN. Heads are resolved
    live from `OrgNode.userId`. A custodian's units are the owning/holding units of rooms
    they keep, plus their home unit.
  - `forward`: AVP only, emails each head.
  - `placeHold`: the room's custodian, and the room's department must be assigned and not
    declined. Goes through Track 6's shared `writeReservation`, which was extracted from
    `createStaffBooking` so both use one locked write path. The hold is HELD for 14 days
    before a quote, or until the payment deadline once quoted.
  - `extendHolds`: AVP or an assigned head.
  - `decideAssignment`: the node's head or SYS_ADMIN. ACCEPT needs an https sheet link and
    an amount, and either at least one held slot or an explicit "no calendar needed".
    DECLINE releases that department's holds.
  - `sendQuote`: AVP; every assignment answered and at least one accepted.
    - Aligns hold expiry to the deadline.
    - **Regenerates the tracking token** (the raw token is never stored, so the emailed
      link is the only copy; the old link dies).
    - Emails the amount, bank and sheet links.
  - `closeRequest` (decline, releasing holds), `expireOverdueQuotes`, letter download
    (authorized to parties only; `nosniff`, `no-store`).
  - Mail helpers escape everything the public typed.
  - `app/api/cron/expire-holds` needs `Bearer $CRON_SECRET`. `vercel.json` schedules it
    daily; Hobby allows daily only.

  **UI**: sidebar "External requests" (`/external-requests`, SYS_ADMIN/MANAGER/CUSTODIAN).
  A list plus detail: requester and letter link, windows, purpose, lines, quote, and
  panels for departments (Accept… / Decline… per head), held slots and history. Modals:
  Forward (department checklist), Hold a slot (room, machines, prefilled from the
  request's windows, clash list on 409), Send quote (prefilled from accepted amounts plus
  a 7-day deadline), Decline.

  **Tests**: `lib/server/external/requests.spec.ts` (6, DB-backed, mail mocked). An orphan
  UNIVERSITY node stands in for the test AVP; the real root is never touched, since an
  early draft deactivated it and that would disturb concurrent spec files. Cases:

  - intake stores the PDF, hashes the token and sends 2 mails;
  - non-PDF, honeypot, too-soon and throttle refusals;
  - the full forward → hold (a staff booking on that slot then 409s) → head decisions,
    including authorization and the sheet requirement → quote. Quote refused until every
    department answers; the old token 404s after the quote;
  - decline releases holds and frees the slot;
  - holds refused for an unassigned department or a non-custodian;
  - an overdue quote expires with its holds, and the requester can cancel.

  **Verified**: `tsc` clean, `npm test` **391/391**, `npm run build` clean. The migration
  diff against the live DB is empty.

  **Live walkthrough.** A new `.claude/launch.json` profile `dev-nomail` points SMTP at
  `127.0.0.1:1`, so nothing left the machine, and sets test bank details.

  - As admin, flagged Lab/Computer/Workstation Setup `publicListed`.
  - Signed out, `/portal` showed Lab 24, Computer 37, Workstation Setup 33. Submitted the
    real form with a PDF → EXT-2026-001. Server logs show the requester and AVP mails
    attempted and blocked.
  - As AVP (admin): the list and detail rendered; the letter downloaded as
    `application/pdf`; forwarded to Software Engineering via the modal.
  - As Girma: "Hold a slot…" prefilled 2026-09-28 09:00–12:00 on SE Lab X → HELD until
    09-28.
  - As the SE head: accepted with a sheet link and "18,750.00" → ETB 18,750.00.
  - As AVP: Send quote prefilled 18750.00 and 2026-09-21 → QUOTED; the hold is now held
    until 09-21. The old tracking link → 404.
  - With a dev-set token, the tracking page showed the quote, bank, sheet link and public
    timeline.
  - Probes: cron without secret → 401, `/portal` signed out → 200, `/register` → 307 to
    login, letter signed out → 401.

  **Left in place for Track 8's live pass**: EXT-2026-001 (QUOTED, one HELD reservation
  on SE Lab X) and `publicListed` on Lab/Computer/Workstation Setup. To be cleaned up
  after Track 8.

- **2026-09-15** — Track 8: payment verification and booking confirmation. This completes
  the external booking flow (plan: `~/.claude/plans/understand-where-we-are-crystalline-marshmallow.md`).

  **Schema** (migration `20260914150000_payment_verification`):
  - enums `PaymentProvider` (CBE, TELEBIRR, DASHEN, ABYSSINIA, CBEBIRR) and
    `PaymentVerificationStatus` (VERIFIED, REJECTED, PENDING_REVIEW, MANUAL_VERIFIED,
    MANUAL_REJECTED);
  - model `PaymentVerification`: normalised `reference`, receipt fields, `raw` JSON,
    `reason`, `requesterNote`, reviewer.
  - **`claimKey`** ("PROVIDER:REFERENCE") is unique but set only while a receipt counts or
    awaits review. So one receipt can never pay twice or for two requests, while a refused
    or mistyped attempt doesn't lock its reference out. (Deviation from the plan's
    `@@unique([provider, reference])`, which would have done exactly that.)

  **Pure domain** `lib/domain/payment-receipt.ts` (spec, 9 cases):
  - `parseAmountToSantim` (numbers or "ETB 1,500.50", integer maths);
  - `parseReceiptTime`: receipt times as Addis civil time; explicit zones honoured;
    d/m/y vs m/d/y (a part > 12 decides, else "/" + AM/PM is American, else day-first);
    remembers date-only receipts;
  - `paidAfter` (one-minute slack; civil-date comparison for date-only receipts);
  - `receiverMatches`: every digit run of a masked account must sit at the right end of
    the configured number (≥ 4 trailing digits); the holder's name decides only when no
    digits are shown;
  - `statusSaysPaid`; `PROVIDER_INPUT` (what each provider needs besides the reference).

  **Verifier drivers** `lib/server/payments/verifier/**` (same selector shape as storage):
  - `http-driver.ts`: the self-hosted verifier-api, `x-api-key`, 20 s timeout, lenient Zod
    per endpoint mapped to one `Receipt` (telebirr uses `settledAmount`). Unreachable,
    5xx, 401/403/429 and unreadable bodies are `unavailable` (manual review is the honest
    next step); `success:false` is a real refusal.
  - `fake-driver.ts` (`VERIFIER_DRIVER=fake`): tests register receipts or outages; by hand,
    `FAKE-18750` pays ETB 18,750 to us, `FAKE-18750-WRONG` paid someone else, `FAKE-DOWN`
    is an outage.
  - Missing `VERIFIER_BASE_URL`/`VERIFIER_API_KEY` doesn't break start-up; attempts just
    report "not set up".
  - `payments/config.ts`: `PAYMENT_PROVIDERS` plus `PAYMENT_<P>_RECEIVER_ACCOUNT/NAME`. A
    provider is offered only when listed **and** it has a receiver detail to check against.

  **Service** `lib/server/payments/verify.ts`:
  - `submitPayment(token, input)`:
    - QUOTED/PAYMENT_SUBMITTED only, before the deadline; the provider must be enabled
      with its extra input;
    - reused claim → 409; ≤ 10 rejections per day per request;
    - calls the driver **outside** any transaction, then checks status, amount, receiver
      and paid-after-quote;
    - a refusal is recorded (REJECTED, reason, raw) and returned as 200
      `outcome: REJECTED` so the page can offer manual review;
    - success is recorded under a `SELECT … FOR UPDATE` on the request, then `settle`
      (PAID once verified sums reach the quote, PAYMENT_SUBMITTED while a review is
      pending, else QUOTED). Split payments add up.
  - Manual review: `manualReview: true` plus the stated amount → PENDING_REVIEW (claims the
    reference, emails the AVP). `reviewPayment` is AVP-only: APPROVE (optionally with the
    amount actually received) or REJECT (reason required, frees the reference, emails the
    requester).
  - `confirmPaidRequest`:
    - locks the request, then every touched lab tree in sorted order;
    - HELD → CONFIRMED (blocking, `holdExpiresAt` cleared);
    - a lapsed (EXPIRED) hold is re-checked: free → revived as CONFIRMED; taken by someone
      else or already past → CANCELLED and named in a `CONFIRMATION_CONFLICT` event, and
      the request stays PAID; only clashing with this request's own re-hold → left alone;
    - otherwise the request becomes SCHEDULED;
    - after commit, mails go out one at a time: the requester, each lab's nearest
      custodian (their slots), and the accepting heads. On conflict, the requester is told
      it will be re-arranged and the AVP is emailed.
  - `confirmBooking`: the AVP retries after a custodian holds a replacement slot (holds are
    now allowed on PAID requests, lasting two weeks).

  **Changes to Track 7 code**:
  - PAID counts as open;
  - the requester can't self-cancel once any money is accepted;
  - declining a paid request and expiring a part-paid quote mention the refund;
  - PAYMENT_SUBMITTED is never auto-expired (a person still owes a decision);
  - public timeline notes shown for payment events;
  - **fixed `nextReference`**: it used a row count, so a deleted request made the next
    reference collide with an existing one (found when the payment spec ran after the
    external spec). It is now MAX(number)+1 for the year. Purchasing's `PR-` numbering has
    the same flaw; a separate task was offered for it.

  **Routes**:
  - `POST /api/public/track/[token]/payments` (no session);
  - `POST /api/external-requests/payments/[id]/review`;
  - `confirm` action on `/api/external-requests/[id]/[action]`.

  **UI**:
  - `components/portal/PaymentPanel.tsx` on the tracking page: confirmed-so-far, every
    attempt with status and reason, provider picker with its extra field, "Verify
    payment". A refusal offers "ask the university's office to check it by hand" (amount
    prefilled with the remainder, plus a note).
  - Staff page: Payments panel (AVP sees receipts with payer, receiver, paid-at, requester
    note and Accept…/Reject… for pending reviews; heads and custodians see the total only),
    a Confirm booking button, and a notice when paid but a slot was lost.

  **Docs/config**: `docs/payment-verifier.md` (the checks, env, per-provider inputs,
  Ethiopian hosting for telebirr/CBE Birr, fake-driver references); `.env.example`;
  `dev-nomail` profile sets the fake driver and test receivers.

  **Tests**: `lib/server/payments/verify.spec.ts` (8, DB-backed, fake driver, mail mocked):
  - full receipt → SCHEDULED, holds CONFIRMED and blocking, the 3 mails, reference reuse
    409 across requests, no payments or re-confirm after booking;
  - wrong receiver, before the quote, pending status, unknown receipt, disabled provider,
    missing suffix; a refused reference later counts;
  - split CBE (account) + telebirr (name) to the santim;
  - two full receipts concurrently → exactly one taken, one SCHEDULED event;
  - after the deadline and before a quote → 409;
  - outage → manual review, head can't review, reason required, approve → SCHEDULED,
    no double review;
  - rejected review frees the reference;
  - two lapsed holds, one slot taken by a staff booking → [CANCELLED, CONFIRMED], PAID
    with a conflict event and mails; a re-hold plus AVP confirm → SCHEDULED.

  **Verified**: `tsc` clean; `npm test` **408/408**; `npm run build` clean.

  **Live pass** (`dev-nomail`, fake driver):
  - EXT-2026-001 tracking page: `FAKE-18750-WRONG` → "not made to the university's
    account" with the manual-review offer; `FAKE-10000` (CBE) → ETB 10,000 of 18,750
    confirmed, "Paid the remaining ETB 8,750.00?"; `FAKE-8750` (telebirr) → **Confirmed**.
    In the DB the SE Lab X hold is CONFIRMED and blocking; mails to the requester, SE
    custodian and SE head were attempted and blocked.
  - EXT-2026-002 (created through the API as AVP, no-calendar ChemE acceptance, quoted
    ETB 2,500): telebirr `FAKE-DOWN` → "verifier could not be reached"; sent for manual
    check with a note → "Being checked", PAYMENT_SUBMITTED.
  - As the ChemE head, review → 403; as AVP, reject without a reason → 400, approve →
    SCHEDULED with MANUAL_VERIFIED. The staff page's Payments panel rendered both
    attempts, the requester note and the reviewer's note.

  **Cleaned up**: EXT-2026-001/002 with their reservations, payments and letter files;
  `publicListed` back off on Lab/Computer/Workstation Setup (Lab=ROOM and
  Computer=EQUIPMENT stay as configuration); all `claude-dev-verification` sessions.

  **Still outside the repo**: deploying verifier-api (an Ethiopian host for telebirr/CBE
  Birr) and one real verification per provider before go-live; the real receiving account
  and holder names in env.

- **2026-09-15 (whole-system E2E test campaign — findings only, no product changes)** —
  First end-to-end campaign testing every feature as one product (org → personnel →
  categories → register → transfers → purchasing → scheduling → external/payments), and
  attacking the seams between modules, rather than each track's own happy path. Full
  report: `docs/e2e-findings-2026-09-15.md`; plan:
  `~/.claude/plans/you-are-a-master-robust-knuth.md`. Branch `track-5-scheduling`.

  **How.** Ran against a throwaway CLONE database `lrms_v2_e2e` (created, migrated and
  seeded from scratch — the real local `lrms_v2` was never touched), behind a new
  `.claude/launch.json` `e2e` profile (`next dev -p 3100` via `e2e/with-env.mjs`, which
  points at the clone, a local SMTP sink, the fake payment verifier, local image
  storage and a test `CRON_SECRET`). API-level suites in `e2e/suites/*.ts` drive real
  HTTP against the running app as 18 seeded cast members (sessions minted directly, since
  this session may not type passwords), asserting both the HTTP result and the resulting
  DB rows/audit. **195 cases: 124 pass, 69 fail (each mapped to a finding), 2 info.** All
  29 code-reading hypotheses were run and confirmed/refuted, none reported unverified.
  `e2e/` is tooling only — `git status` shows only `e2e/`, the findings doc, `.gitignore`
  and `.claude/launch.json` changed; no product file was modified, and `next-env.d.ts`'s
  dev-mode auto-edit was reverted.

  **57 findings: 2 CRITICAL, 10 HIGH, 29 MEDIUM, 13 LOW, 3 DESIGN.** The two CRITICAL and
  the borrowed-item HIGHs all trace to one root cause — **write custody resolves through
  physical containment** (`scope.custodyItemIdsOf`), so a host lab controls the loans
  sitting inside it: F-020 (a ChemE custodian's `deleteItem` on her own lab hard-deleted
  14 SE-owned borrowed items via FK cascade, no notice, unrecoverable), F-021 (a host head
  re-owns / a host custodian takes custody of a borrowed item), F-039 (no return path;
  the lender yanks it back and `currentOrgNodeId` stays wrong). Other headline HIGHs:
  F-022 (custodian setOwnerOrg/setCurrentOrg/setCustodian bypass the transfer chain
  entirely), F-014 (heads can't manage their own staff — a stated core requirement),
  F-043 (revise-and-resubmit is broken for any purchase request carrying a staff need),
  F-044 (count-based `PR-YYYY-NNN` numbering: one deleted row halts ALL purchasing for
  the year; concurrent compiles 500 — the exact flaw Track 8 already fixed for external
  requests but left in purchasing), F-002 (any occupant of any `UNIVERSITY`-kind node
  becomes the AVP; multiple roots allowed), F-012 (a deactivated invitee re-activates via
  their old invite link), F-049 (deleting a room hard-cascades its confirmed and paid
  bookings). Cross-cutting themes: **hard delete + FK cascades** (F-020/F-025/F-049)
  destroy audited, in-use data with no recovery; **no serialize/lock** on several
  multi-step writes (F-003 closure recompute, F-040 transfer settle, F-045 receiving);
  **STUDENT reads the whole register/change-log** because the resource read routes never
  call `requireRole` though `scope.ts` says they must (F-031, L-06); and **missing input
  bounds** (name hygiene, `count`, booking horizons, series length).

  **4 DESIGN questions for the product owner** (report's own section): borrowed-item
  ownership/return semantics; what "deactivate a node" should mean; head-vs-custodian
  authority (and whether "head" is occupancy or the MANAGER role — today inconsistently
  both); and vacancy escalation for pending approvals.

  **No fixes applied** — per the user's decision, this round only finds and documents,
  with each finding carrying repro steps, evidence, a `file:line` root cause, ≥2 fix
  alternatives (one recommended) and a named regression test, as input to a separate
  review/dev step. `e2e/results.json` is the machine-readable record; the suite re-runs
  after fixes (`node e2e/create-db.mjs --reset`, re-seed, start the `e2e` profile, run
  `e2e/suites/*.ts` in order). The clone DB and its seed images (`.local-storage-e2e/`)
  are gitignored and can be dropped anytime.

- **2026-09-20 (fix round, Phase 1 — the 2 CRITICAL + 10 HIGH, plus F-017)** — Plan:
  `~/.claude/plans/you-are-a-master-robust-knuth.md` (supersedes the campaign plan above).
  Fixed and re-verified against the same 2026-09-15 campaign, on a fresh clone:
  **F-001, F-002, F-012, F-014, F-017, F-020, F-021, F-022, F-023, F-039, F-043, F-044.**
  Findings doc updated in place — each closed finding's Status now reads
  `Fixed (2026-09-20, Phase 1)`, with a "Phase 1 fix round" section at the top spelling
  out what changed per finding.

  **Decisions taken first**, per user direction: borrowed items keep the lender in
  authority (a host may report status/reposition within their own room; ownership,
  custody, rename, delete stay with the lender), with an explicit **return flow** added,
  not just the abuse blocked; deactivating an org node vacates the post only, never the
  account; heads gain management of their own staff, and **"head" now means occupying
  the node**, never the MANAGER role label (which is auto-granted on assignment as a
  convenience, not the authority itself).

  **The two CRITICALs and F-022/F-023 share one root cause**: write custody was
  inherited through physical containment, so a host lab could act on whatever merely sat
  inside it. `lib/server/resources/scope.ts` gained `writableItemIdsOf` — the same
  custody walk as the existing (unchanged, still correct for READS) `custodyItemIdsOf`,
  except it stops the instant accountability changes — and `assertCanMutate`/
  `containers()` now use it; a MANAGER's write reach is their unit's `ownerOrgNodeId`
  only, never `currentOrgNodeId` (F-021). `mutate.ts`'s `assertAuthorized`: `setOwnerOrg`/
  `setCurrentOrg` became SYS_ADMIN-only, `setCustodian` now requires the RECEIVING
  custodian's own reach to already cover the item's owning unit (F-022); `applyCreateItem`
  now always inherits a child's owner/current/custodian from its parent for non-admins,
  regardless of what the client sends (F-023). `applyDeleteItem` collects named blockers —
  a foreign-accountability item, or a live booking/series/pending transfer/staged draft
  touching the subtree — and refuses with a 409 naming them, the live-dependent half
  applying to SYS_ADMIN too (F-020's blast radius).

  **F-039 got a real return flow**, not just a block: two new `StepSelectorType` values
  (`HOST_RELEASE`, `OWNER_RECEIPT` — additive migrations), detected structurally in
  `approvals.ts` (the destination lands back inside the item's own owning unit) rather
  than by a client flag, raisable by either the lender (their ordinary write reach) or
  the host (their read-side containment custody, unchanged). `OWNER_RECEIPT` exists
  because a host-initiated return's "confirm receipt" must go to the owning custodian,
  never "whoever asked" (`REQUESTER_RECEIPT`'s existing meaning, wrong here). Verified
  live both directions with a throwaway script, `e2e/probes/verify-return-flow.ts`.

  **F-001**: `deactivateNode` now only ends the `OrgNodeAssignment` row and clears
  `OrgNode.userId` — never touches `User.status` or sessions; `DeactivateNodeResultDto`'s
  field renamed `revokedOccupantName` → `vacatedOccupantName`, Org Studio's confirm copy
  updated to match. **F-002**: `kind === "UNIVERSITY" ⇔ level === 0` plus at most one
  level-0 node, enforced in `create`/`update`/`changeLevel` — closes the "any UNIVERSITY
  node's occupant becomes the AVP" hole at its structural root, so `external/requests.ts`'s
  `isAvp` needed no change (see deviations below). **F-012**: `people.deactivate` now
  expires every open invitation for that email; `auth.ts`'s `register` refuses a DISABLED
  account — either half alone would have closed it, both now do.

  **F-014/F-017 — one definition of "head" everywhere**: `lib/server/org/scope.ts` gained
  `isHeadOf`/`headNodeIdsOf` (occupancy of an active node, or SYS_ADMIN), consolidating
  purchasing's own previously-duplicated `currentHeadOf`/`assertHeadsNode` and replacing
  the three places that ALSO required the MANAGER role as a redundant, driftable
  pre-check (`purchasing.ts`'s `canCompile` gate on `compilePurchaseRequest`/
  `listOpenNeeds`/`declineNeed`; `people.ts`'s invite scoping; `resources/scope.ts`'s
  `defaultModeFor`) — this is exactly what P-13 caught: stripping MANAGER from a sitting
  head left them occupying the node but unable to act as one. `assignNode` now
  auto-grants MANAGER on a fresh occupancy (never removed on vacate) so the common case
  needs no separate manual step. `people.ts` gained `assertMayManageStaff`: a head may
  deactivate/reactivate/re-role their own CUSTODIAN/STAFF, scoped to their own subtree,
  never a node occupant, never a privileged role, never themselves — the three routes
  (`deactivate`/`reactivate`/`roles`) lost their route-level `requireRole(["SYS_ADMIN"])`
  gate in favour of this scoped check. UI: `PersonnelPage.tsx`/`PeopleTable.tsx` show
  "Manage" to a head too, with the modal hiding node-occupancy (stays admin-only) and
  restricting role chips to CUSTODIAN/STAFF for a head; `PurchasingPage.tsx`'s compile
  panel now gates on occupancy (`me.scope.isOccupant`) instead of the MANAGER role.

  **F-043**: `reviseAndResubmit` now releases the old lines' carried needs *before*
  re-validating them, inside the transaction (previously the check ran first, against
  pre-release state, so a resubmission keeping its own need link always 400'd — the
  UI's own pre-filled form could never succeed). **F-044**: `purchasing.ts`'s
  `nextReference` is now `MAX(numeric suffix)+1` computed inside the transaction with a
  P2002 retry loop, the identical fix `external/requests.ts` already carried — replacing
  the row-count scheme that went permanently wrong the moment any request row was ever
  deleted.

  **Two deliberate deviations from the plan**, decided during implementation: the
  planned `Reservation.lab`/`ScheduleSeries.lab` FK change from `Cascade` to `Restrict`
  was dropped — a bare FK can't tell a live booking from closed-out history, so it would
  have permanently blocked deleting any room with a booking ever recorded against it;
  the application-layer blocker in `applyDeleteItem` (which checks liveness) is the
  correct enforcement point and stays the only one. `external/requests.ts`'s `isAvp`
  was left resolving by `kind: "UNIVERSITY"` rather than a hardcoded `code: "ASTU"` —
  F-002's own schema invariant already makes that lookup structurally unique, so
  hardcoding an institution-specific code would have been a regression in generality,
  not a improvement.

  **Two real E2E-harness bugs found and fixed along the way** (tooling, not product):
  a leftover throwaway probe (`e2e/suites/O-17b-race.ts`) collided with the `O-*.ts`
  glob and silently starved the real `O-org.ts` suite of ever running — moved to
  `e2e/probes/`. `P-people.ts`'s P-10 case mutated the SHARED `staffSe` fixture
  (deactivate → reactivate → re-role) instead of a throwaway account — harmless while
  F-014 didn't work yet (every call 403'd), but once fixed it genuinely wiped that
  actor's session and changed their roles, breaking every later suite that assumed
  `staffSe` stayed a stable, logged-in, STAFF-only actor. Rewritten to use a fresh
  account, matching the "never mutate a shared fixture" lesson the product's own
  DB-backed specs already learned. A third correction, `X-05`'s test data, was isolated
  from an unrelated 16-hour booking-length cap that had been masking what it actually
  tested (a hold on a date never requested); re-run clean, it confirms F-055 is a
  genuine finding, not a false positive from the original campaign.

  **Verified**: `npx tsc --noEmit`, `npm test` (408/408), `npm run build` all clean.
  Full campaign re-run end to end on a freshly reset, re-seeded, re-fixtured clone —
  every targeted case flipped FAIL → PASS (O-10, O-12, P-10, P-13, P-15, R-05, R-08,
  R-09, R-10, R-11, R-23, T-10, B-04, B-16, B-17) with nothing else regressing.

  **Still open**: 45 findings (0 CRITICAL, 0 HIGH, 29 MEDIUM, 13 LOW, 3 DESIGN) —
  Phase 2 (MEDIUM) and Phase 3 (LOW/DESIGN) of the same plan, not started.

- **2026-09-20 (fix round, Phase 2 — all 29 MEDIUM)** — Same plan as Phase 1
  (`~/.claude/plans/you-are-a-master-robust-knuth.md`). Every MEDIUM finding from the
  2026-09-15 campaign is now fixed, tested and committed: **F-003, F-004, F-005,
  F-006, F-009, F-010, F-013, F-015, F-016, F-024, F-025, F-026, F-027, F-031, F-032,
  F-034, F-035, F-036, F-037, F-040, F-041, F-042, F-045, F-046, F-047, F-050, F-051,
  F-055, F-056** — 14 commits, one per finding-cluster, matching Phase 1's own
  granularity. `docs/e2e-findings-2026-09-15.md` carries the full per-group writeup
  (a new "Phase 2 fix round" section) and every closed finding's own Status line; this
  entry is the short version.

  **Org-structure concurrency (F-003–F-006)**: every structural write now runs under
  one `pg_advisory_xact_lock`-guarded transaction (closing the exact closure-recompute
  race the campaign found), `deleteNode` names needs/purchases/external-assignments as
  blockers instead of a raw 500, `changeLevel` requires and validates new parents
  atomically instead of stranding the node, and `OrgNode.code` (already in the schema,
  never wired up) is what `findProcurementOffice` now resolves by, so renaming the
  office no longer disables purchasing university-wide.

  **Identity (F-009/010/013/015/016)**: `forgotPassword` skips accounts with no
  password; login and forgot-password both gained table-counted throttles (new
  `LoginAttempt` table); `resendInvite` actually revokes the old token now; a new
  `moveHomeNode` (new `HomeNodeChange` table) is the first way to move a person
  between departments, blocked while they hold custody/an open need/an open draft;
  the last active SYS_ADMIN can't be demoted, deactivated, or self-deactivate.

  **Register (F-024/025/026/027)**: custodian eligibility is now checked on root
  creation and a handover's receiving custodian too, for every actor including
  SYS_ADMIN, not just direct `setCustodian`. **`deleteItem` is now a soft delete** —
  `deletedAt`, nothing physically removed — replacing a hard delete whose FK cascades
  quietly destroyed photos, custom properties and staged drafts with only the audit
  row surviving; nearly every reader already filtered `deletedAt`, so this mostly
  activated existing, previously-dead guards rather than requiring a wide rewrite (two
  narrow gaps found and closed: `scope.ts`'s `assertCanMutate` MANAGER-fallback query,
  and the new `checkBaseVersionsCurrent`'s version-only comparison, which a soft
  delete doesn't bump). `createItem`'s `count` is capped at 500. BULK→SERIALIZED is
  refused (409, naming an item) instead of a raw 500 or silently resetting quantities
  to 1.

  **Scope & views (F-031/032/034)**: a student/external account can no longer read
  the asset register at all (`assertMayBrowseRegister`, the one choke point every
  register read already shared); an access view nobody explicitly *chose* narrows
  reads only, never blocks a write — closing a hole where one seeded `canEdit:false`
  EVERYONE view would have made every account with no more specific view of their own
  read-only, university-wide, including SYS_ADMIN; a lab's aggregate views
  (ideal-vs-actual) gate on direct scope of the lab, not the ancestor-inclusive check
  built for tree breadcrumbs, which let custodying one nested borrowed item expose an
  entire foreign lab's composition.

  **Draft mode (F-035/036/037)**: a lab commit's whole VISIBLE batch now applies
  inside one transaction (`mutate.ts`'s `applyChange` accepts a caller-supplied `tx`),
  with per-operation `expectedVersions` stripped inside the batch loop — two staged
  edits of the SAME item, each carrying the item's own pre-batch version exactly as
  the Inspector/Change modal send it, now both apply instead of the second
  deterministically failing on a version the first had already bumped. The commit
  request's own `baseVersions` (recorded at submission, never read back before) is
  now re-checked under `FOR UPDATE` immediately before applying, so a direct
  correction made while a draft waited for its head turns approval STALE — naming the
  change — instead of being silently overwritten. IDEAL targets no longer require
  draft mode to be on, which is why *no* production department could ever record one
  before this.

  **Transfers (F-040/041/042)**: `decideStep`'s chain-step advancement is now
  serialised per request under its own advisory lock, closing the race where a losing
  concurrent "confirm receipt" call overwrote an already-APPLIED transfer's status
  with STALE. Every subject item is re-validated on every decision against a
  structural snapshot (parent/owner/current-unit/custodian — not the whole-row
  version a cosmetic rename also bumps), failing fast and named instead of failing at
  the very last step with an unexplained "Version conflict"; the final apply reads a
  fresh version so a tolerated rename doesn't then void it anyway.
  `applyMoveInTree` refuses moving an item named in a pending transfer. Any
  non-handover pull's chain is now built directly in code (item's custodian, owning
  head, the destination container's own custodian when it differs from the
  requester, receiving head, requester receipt) instead of taken from a role-matched
  policy — closing the gap where a store keeper's or a dean's pull could skip the
  owning or receiving side entirely.

  **Purchasing (F-045/046/047)**: `receivePurchaseLine`'s received-quantity update
  is now two atomic conditional `updateMany` attempts instead of a read-modify-write,
  with the cap encoded directly in the WHERE clause — closing both the lost-update
  bug (two simultaneous partial receipts, only one ever recorded) and the
  over-receipt hole in the same mechanism; a category mismatch is refused; a
  SERIALIZED line must order whole units, checked at compile time. Rejecting or
  cancelling a request now reopens the needs it carried, named with why
  (`reopenCarriedNeeds`). The raiser may withdraw only through APPROVING; from
  ORDER_PLACED on, cancelling an order is procurement's own act, with a required
  note.

  **Scheduling (F-050/051)**: a booking that's already taken place can't be
  cancelled; an undecided REQUESTED booking whose own start time has passed drops
  out of the inbox directly, backed by a new cron sweep (`expireLapsedRequests`)
  that marks it EXPIRED. A category's `bookingMode` can't be changed away from
  ROOM/EQUIPMENT while a future live reservation or class occurrence still depends
  on it. F-051's own notification half (telling requesters when their machine
  breaks) is a deliberate scope cut — a UX addition, not a data-integrity fix.

  **External (F-055/056)**: `placeHold` refuses a hold on a date the request's own
  windows never named (checked by date, not exact time — a same-day replacement
  hold for a lost slot keeps working, its own case in `verify.spec.ts`);
  `extendHolds` is capped at the same ceiling a fresh hold gets, instead of only
  checking the date is in the future.

  **One deliberate architectural call**: F-035's fix combines transactional batching
  with stripping per-operation `expectedVersions` inside the batch loop (closer to
  the plan's "Fix B" for this specific point than pure "Fix A") — necessary because
  two edits of the same item, each staged against the pre-batch version, would
  otherwise still conflict with each other inside a single shared transaction exactly
  as they did across separate ones; F-036's batch-level `baseVersions` check is what
  actually guards staleness once per-operation checks are stripped for the batch.

  **Verified**: `npx tsc --noEmit`, `npm test` (458/458, up from 408 before Phase 1),
  `npm run build` all clean, at every commit in this round. The unit-test suite's own
  `fileParallelism` was turned off (`vitest.config.ts`) partway through this phase
  after the new `org.spec.ts` (F-003) started exercising real concurrent structural
  writes against the shared DB other spec files' fixtures also touch — see that
  commit's own message for the full reasoning; the suite is now both deterministic
  and, in practice, faster (no DB contention between parallel workers).

  **E2E re-verification** (fresh clone, all 14 suites, 194 cases): 174 PASS; the 20 remaining ✘ are all Phase 3 LOW / DESIGN / INFO / deferred-F-051-notification. It caught two extra product defects fixed in `ec9fe9d` — purchasing `decideStep` was not advisory-locked (B-18) and admin `createItem` skipped custodian eligibility (R-07). Details in the findings doc.


- **2026-09-20 (fix round, Phase 3 — the 13 LOW + the 3 DESIGN)** — Third and last phase of the
  plan (`~/.claude/plans/you-are-a-master-robust-knuth.md`), after Phase 2's own E2E re-run came
  back clean (174 PASS on a fresh clone; it also surfaced two extra product defects — purchasing
  `decideStep` not advisory-locked, and admin `createItem` skipping custodian eligibility — fixed in
  `ec9fe9d`). One commit per cluster, each with its regression test:
  - **F-008** org node names trimmed, 2–120 chars, case-insensitively unique among active nodes
    (checked inside the org lock; no DB index, so pre-existing duplicates can't fail a migration).
  - **F-028/F-029/F-030** category & resource input hygiene: names trimmed/≤160, category key is a
    slug, `iconKey` validated against the registry; required fields are enforced on `createItem`
    (root items only) and the preview counts existing items lacking a newly required field; a
    field-type change is a 409 while stored values can't be read as the new type, unless purged in
    the same save (the preview offers the purge through `orphanKeys`).
  - **F-033** access views validate their units, people and view id before saving.
  - **F-018/F-019** a dean's resend/invite reach their subtree (the invite form gained a department
    picker; a home node outside the tree is now an explicit 403); duplicate invites are a 400.
  - **F-011** occupant emails on the org chart only for SYS_ADMIN/MANAGER.
  - **F-048** purchase-request costs follow `canSeeCost` (plus post occupants and the raiser).
  - **F-053** booking on-behalf-of note / head-count / decision note only for the requester, the
    room's custodian and the owning head (read-only reach).
  - **F-052** booking horizon and class-slot span ≤ 366 days; series exceptions validated.
  - **F-057** the portal no longer probes `/auth/me`; one shared catalog fetch.
  - **DESIGN, decided — no code:** F-007 (deactivated unit keeps reach — follows from F-001),
    F-038 (vacancy freezes), F-054 (bookings stay custodian-only); reasoning is in the findings doc.

  **Verified**: `npx tsc --noEmit`, `npm test` (480/480), `npm run build` clean; fresh-clone E2E
  re-run of all 14 suites: 189 PASS of 194. Remaining ✘ are the DESIGN-decided cases (O-11, S-18), the
  deliberately deferred notification half of F-051 (S-14), and the fixture-only INFO artifacts
  V-01/V-03. Harness edit: P-06 now expects the new 403 for a foreign home node. F-057 was checked
  by build and code reading only (the browser tooling was unavailable this session).

  **Fix campaign complete** — all 57 findings are Fixed or Decided. Stopping here for review.

- **2026-09-22 (manual test plan — docs only, no product changes)** — Wrote
  `docs/manual-test-plan-2026-09-22.md`, an ordered, click-by-click acceptance plan for the
  user's four asks: set up CSE + SE lab data, the draft-mode status-approval flow, the full
  purchase path (need → compile → dean/AVP/procurement → pipeline → store receipt → handover
  to lab), and bookings by own-department staff, other-department staff and external
  requesters (portal → forward to both departments → holds → quote → split/wrong/manual
  payments). Findings from preparing it: **CSE does not exist in any seed** — the plan creates
  it through Org Studio under CoEEC, with its head/custodian/staff invited in-app; a fresh
  seed has **no bookable category** (the E2E clone's `Lab`=ROOM/public was set by the suites),
  so the plan sets Lab/Computer booking modes first; the seeded `SE Lab X — Software Lab 3` is
  IMPAIRED (switch down) and thus unbookable — used as the repair-through-approval test; the
  dev DB `lrms_v2` is polluted with `__test-*` org nodes and its real Procurement Office is
  INACTIVE, so the plan runs on a freshly rebuilt `lrms_v2_e2e` clone instead. Nothing was
  executed against either database.

## Working agreements for this project

- Never spawn subagents (global CLAUDE.md rule) — do everything inline.
- Update this file's Timeline section after each round of changes, and keep
  the "Current state" / "Decisions" sections in sync when they change —
  don't let this doc drift from what's actually in the code.
- Be cautious about live-testing mutations in the browser when there's
  evidence the user is concurrently using the app themselves (watch for org
  data changing that this session didn't cause).

- **2026-09-22 (manual-test feedback → fix plan; docs only, no product changes)** — The user's first
  run of `docs/manual-test-plan-2026-09-22.md` stopped before Part 1D with ten comments. Each was
  traced to its cause and planned as a workstream in `docs/fix-plan-2026-09-22.md`:
  - **WS-1** password reset and one-time sign-in links. `lrms_v2_e2e` has zero `PasswordReset`
    rows, so `forgotPassword` returned early. The likely cause is the F-009 silent no-op for an
    INVITED account. Reproduce first.
  - **WS-2** copy invite link and admin-issued reset link in People → Manage.
  - **WS-3** a shared indented tree picker replacing the six `" / "`-joined selects.
  - **WS-4** no-flicker saves: `useRegisterState`'s refetch does `setRows(null)`, which swaps the
    table for a skeleton.
  - **WS-5** bulk create: `createItem` always passes `startIndex = 1`. The plan adds sibling-unique
    names, lowest-free-number gap fill, a pre-filled Name field and a preview modal.
  - **WS-6** all lucide icons in a searchable picker.
  - **WS-7** a Grouped register mode, the default on University resources.
  - **WS-8** draft mode auto-stages edits instead of the 403 from `assertDraftWorkflowNotBlocking`.
  - **WS-9** a Lab states page with tabs Current / Draft overlay / Ideal / Approvals.

  Six decisions (D1–D6) wait on the user. The manual test plan was revised in place: WS-tagged
  new and changed tests (AUTH-01–05, SET-01a, SET-04a, SET-08a–d, UI-01/02, REG-01/02, and a
  rewritten 1D and STA-03–07), plus a run-1 results log. The plan says to restart from a fresh
  Part 0 once the fixes land.

- **2026-09-22 (fix round from manual-test feedback: Phase A, A1–A7)** — The approved plan is
  `~/.claude/plans/sorry-i-have-put-wobbly-clarke.md`, superseding `docs/fix-plan-2026-09-22.md`'s
  first draft. User decisions: heads don't edit resources; Draft and Ideal become full named item
  trees copied from current and linked to it (Draft merges on approval, Ideal only drives
  purchasing stats); names are unique per sibling set (top-level: per owning unit); no one-time
  sign-in links; real CSE data and a people clean slate (Phase C); an end-to-end purchase cycle on
  real need (Phase D). One commit per step:
  - **A1 `6d17318`** The reset root cause: forgot-password silently ignored INVITED accounts. It
    now re-sends their invitation, throttled. People → Manage gets Sign-in help: copy invite link,
    email a reset link, or set a temporary password. New `User.mustChangePassword` (migration
    `20260922160000`): `session.ts` refuses everything except me/logout/change-password until it
    is changed, and ProtectedRoute shows `ForcedPasswordChange`. `changePassword` keeps the
    current session.
  - **A2 `b8e735c`** The MANAGER write carve-out is removed from `assertCanMutate` and
    `assertCanCreateRoot`. MANAGER alone is no longer an eligible custodian. The register hides
    edit controls unless the person holds CUSTODIAN, STORE_KEEPER or SYS_ADMIN.
  - **A3 `876e550`** Refetch keeps rows on screen (a `refreshing` flag), `autoResetExpanded:
    false`, and the Inspector reloads quietly after its own save. Verified: 0 skeleton frames,
    expansion kept.
  - **A4 `3e792fb`** New `components/TreePicker.tsx`. The container and destination DTOs carry
    `ancestorIds`, and unit pickers nest along the org chart via `useEditOptions().unitTree`.
    It replaces every `" / "` select.
  - **A5 `01fcbb8`** The icon picker covers the full lucide set (a lazy chunk), with name and
    synonym search ("curtain" → Blinds). The server validates against the full set.
  - **A6 `6159e26`** `lib/domain/naming.ts`: gap-filling, continuing numbering, and sibling
    uniqueness on create, rename and move, under a per-destination advisory lock. The dry run
    returns `plannedNames`. AddModal pre-fills the name and shows a Preview step.
  - **A7 `b585012`** A Grouped register mode (`groupRows` in tree.ts, a GroupByBar, a
    `group=` URL param). University resources defaults to grouped by owning unit.

  Tooling: `e2e/mint-one.ts` mints a session for one account on the clone, so the in-app
  browser can act as any person without typing a password. The `e2e/` folder stays untracked,
  as it was before this round.

- **2026-09-22 (fix round Phase B: lab versions, `2850f81`)** — Draft and Ideal became whole
  named trees:
  - `LabVersion` (DRAFT, IDEAL, IDEAL_PROPOSAL) and `VersionItem` hold a copy of the lab's
    tree, each row linked to its real item. Migration `20260922200000` drops
    `ItemDraftChange` and `LabIdealTarget`.
  - Pure `lib/domain/version-ops.ts` handles edits, the diff against Current, and the
    Ideal-vs-Current stats.
  - `lib/server/resources/lab-versions.ts`: only the lab's custodian edits a version, and
    the owning head decides. An approved Draft merges through the write door as the
    custodian (`createExactItems`), or goes STALE naming whatever changed since the copy.
    An approved proposal replaces the Ideal, and purchasables read the Ideal tree.
  - With drafts on, `applyChange` stages register edits into the lab's Draft (`staged`
    in the result) instead of refusing them. SYS_ADMIN still applies directly.
  - New `/lab-states` page with tabs Current / Draft / Ideal / Approvals. Register rows
    with a pending draft change show a `*`.

- **2026-09-23 (fix round Phase C: real CSE data, `41c7c23`)** — New
  `prisma/cse-lab-data.ts` (17 ARAs, 31 labs):
  - each lab is built for 20 workstations and 20 outlets;
  - broken PCs number `max(0, required − 5)`, capped at 20, each with one broken RAM,
    Storage or Monitor;
  - 11–15 broken chairs per lab, drawn from a room-seeded PRNG.

  `seed.ts` adds CSE and the purchase-chain role accounts. The synthetic SE lab, the SE
  survey labs and the `*@e2e.test` seed cast are dropped. The Motherboard template has no
  GPU. The Lab states Missing column now collapses repeats ("Computer ×5"). The seeds
  were applied to the **E2E clone only**. The dev DB `lrms_v2` has a backup
  (`backups/lrms_v2-2026-09-22-before-clean-slate.dump`) but **has not been reset**:
  Prisma needs explicit chat confirmation for that, and the user hasn't given it yet.

- **2026-09-23 (fix round Phase D: end-to-end cycle on :3100; docs only, no product
  changes beyond C)** — Ali Kibret's two labs went through the in-app browser (ideal,
  draft, handover, acceptance, decisions). The other 29 labs and the purchase chain went
  through `e2e/drive-cse-cycle.ts`, which calls the app's own API with minted sessions.
  It gained `--only <lab>` and `--what <batches>`, and it skips items already in a pending
  handover.
  - Ideals: 31 approved at 25 workstations and 25 outlets.
  - Ali's draft: Monitor broken, chair to maintenance; merged and credited to him.
  - Purchasables matched an independent DB count: gap WS 151 / outlets 155; broken
    RAM 60, Storage 56, Monitor 74, Chair 412.
  - PR-2026-001 went dean → AVP → procurement → pipeline, was received in partial
    receipts, and closed. Every lab's share was handed over and accepted.
  - Ali's repair via draft (RAM swap) turned that PC Working.
  - Final: gap 0 in all 31 labs.

  Findings R2-1…R2-6 are in the manual test plan's results log. The main one is R2-1: an
  item in a pending handover can be put into a second one, and it only fails at apply
  time. `docs/manual-test-plan-2026-09-22.md` was rewritten around the real data and the
  decisions, and `docs/fix-plan-2026-09-22.md` is marked superseded.

  Tooling note: the in-app browser pane doesn't draw while hidden, and its tab jumps back
  to `/dashboard` from time to time. Drive it with DOM scripts inside one
  `javascript_tool` call per page, and set sessions by `document.cookie` from
  `e2e/mint-one.ts`.

- **2026-09-23 (run-2 findings R2-1…R2-6 fixed)** — Each finding is in the results log of
  `docs/manual-test-plan-2026-09-22.md`.
  - **R2-1:** `approvals.ts` gets `findPendingClash`, which refuses a transfer or handover
    over items already in a PENDING request. `baseVersions` holds only the top-most
    items, so the check compares both ways along the tree: the item, its subtree, and its
    ancestors. The preview returns DENIED with the reason, so TransferModal shows it
    before submit. The request is refused with 409, before an auto-apply too, and again
    inside the create transaction under a global advisory lock.
    New `GET /api/resources/transfers/pending` (`pendingTransferMarkers`) feeds a `⇄`
    marker in Register and University resources, and "⇄ N promised" on cluster rows.
  - **R2-2:** `allocateNames` keeps the siblings' established padding, so a batch past 99
    reads 76…99, 100…151 instead of 076…151. A fresh batch is still padded to fit.
  - **R2-3:** store handovers accept `transfer.renameAs`. The preview returns `naming`
    (the name the destination already uses, from its numbered siblings, and the planned
    names). On apply, the items are renamed under the sibling-name lock and logged as
    `setName`. Pulls may not rename.
  - **R2-4:** new request summaries name the lab ("Switch Rack in Software Laboratory —
    B510-R11").
  - **R2-5:** draft diff lines give paths ("Moved from … into Workstation 20 › Computer ›
    Motherboard", "Removed from …").
  - **R2-6:** the purchasables column is "Not working", with what it counts.

  Tests: 515/515, including 7 new DB tests in `approvals.spec.ts` and new naming and diff
  tests. tsc and build are clean. Checked in the browser on :3100 as the store keeper:
  the naming suggestion, the ⇄ markers, and the refusal in both the modal and the API
  (409). The test request was cancelled afterwards.

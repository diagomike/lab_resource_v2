# LRMS v2: one purpose, less clutter, a flow that guides (branch `feat/ux-flow`)

## Context

LRMS works, but it is hard to use. It is also cluttered with structures built for testing or for
roles that no longer exist. The user saw the sister app (`sc_feedback_v2`, branch
`feat/ux-rebuild`) transformed by a rebuild built around plain naming, a Home page that says
what to do next, working email links, and error and empty states. They want the same leap here.

**The product's purpose:** lab management with transparency and ease of access, built around
five jobs:
1. **know what we have** (labs, stores, contents, condition, across ASTU);
2. **share it** (loans and transfers);
3. **buy what's missing** (needs → purchase request → arrival → store);
4. **book it** (rooms, machines, weekly classes);
5. **outside access** (portal, quote, payment).

Everything else is cut. What stays should guide people to what is waiting for them.

**Problems verified in code and in the dev database (2026-10-01):**

**Category editor bugs**
- `components/resources/CategoryEditor.tsx:687`: a field's storage key is derived only on the
  first keystroke (`key: f.key || slug(label)`). Typing "RAM" gives the key `r`, so keys collide.
- `CategoryEditor.tsx:696`: the key is locked by `usage[f.key]`. A new field whose key collides with
  a used key is therefore locked too, so the collision can't be fixed. This is the "conflicts can't
  be reversed" bug.
- Relabelling a field keeps its key and its values. Today's Lab edit (an ItemChange at
  2026-10-01 11:47) turned "Seats" into "Room Number", so seat counts (25, 20) now read as room
  numbers. Changing Room from text to number purged room text from all 40 labs
  ("B528-RG16", "C-105").
- A type change either refuses or erases (`categories.ts:428-441`, `purgeKeys`). Values that do
  convert are never rewritten to the new type ("16" stays a string in a Number field).
- Making a field required on a category that has items: `mutate.ts:555-563` refuses a create
  without it. The store keeper's import load calls `createItem` with no props
  (`imports.ts:241`), so a required field on that category blocks every load, and the keeper has
  no way to fill it.
- The user-made "Chemicals and Reagents" stores `cas_number` as a Number, which can't hold a
  CAS number such as "64-17-5". The editor offers no guidance.

**Roles and authority**
- Custodians create labs and stores: `scope.assertCanCreateRoot` (`lib/server/resources/scope.ts:319`)
  allows CUSTODIAN or STORE_KEEPER in their own unit. Heads can't (`mutate.ts:178-184`).
- Only SYS_ADMIN and PROPERTY_ADMIN may create or edit categories
  (`app/api/resources/categories/route.ts`).

**Flow and feedback**
- Sidebar badges are never filled (`app/(workspace)/layout.tsx`: `const counts = {}`).
- Every notification email links to a generic page (`notify.ts` `path: "/approvals"` ×8).
- Login ignores where you came from (`login/page.tsx:24`).
- There are no toasts, no in-app notifications, and no "waiting for you" anywhere.
- The Dashboard is analytics only (`DashboardPage.tsx`).

**The decisions the user made (2026-10-01)**
- **Do the Sep-29 cuts**, detailed below so the user can veto items. Also cut every structure that
  exists only for testing or adds mental load.
- **ADAA** (Associate Dean of Academic Affairs) is a college-level role. The ADAA creates the
  college's labs and stores, assigns their custodians, and views the college.
- **Labs and stores are static, managed from above.** The department head creates labs; the ADAA
  creates college stores and labs; Property Admin creates the Main Store. Custodians are assigned
  to places and never create them.
- **Categories belong to the department that made them** (custodians and heads know the machines):
  - Creating a new category takes effect at once, and the head is notified (the head can remove or
    adjust it).
  - An edit that changes or destroys data stays pending until the department head approves it.
  - An edit that changes another department's data escalates head → admin → Property Admin, and
    the UI first recommends making a separate category instead.
- **Data is disposable.** Keep only the Chemical Engineering seed: 33 machines with 36 photos,
  chemicals and glassware. Reseed everything else.
- **Work on branch `feat/ux-flow`.** `master` and production (Neon/Vercel) stay untouched.
- **The sidebar shows each person only what they use** (RBAC), and names are plain words.

## Ground rules

- **No subagents** (global rule): all work inline.
- **Next.js:** read `node_modules/next/dist/docs/` before writing Next code (AGENTS.md).
- **Branch:** off `master` (`307b7a2`). The uncommitted `PROGRESS.md` entry and
  `docs/handoff-ux-simplification-2026-09-29.md` are committed on the branch first.
- **One commit per phase**, each with tests passing, and `PROGRESS.md` Timeline updated after each
  phase (memory rule).
- **Domain logic stays pure:** in `lib/domain/*.ts` with a `.spec.ts`, as the project already does.
- **RBAC has three layers:** nav filtering, `canAccessPath`, and a server re-check in every
  service. The server stays the boundary.
- **Mail safety:** adopt Mailpit for dev like the sister app (`.env.development.local`, git-ignored,
  sends SMTP to 127.0.0.1:1025; Mailpit is installed). Until that is in place, use `dev-nomail`.
  Never press a sending control against real ARA addresses.
- **Dev DB:**
  - Back up `lrms_v2` before the reset (`C:/Program Files/PostgreSQL/18/bin/pg_dump` → `backups/`).
  - Tests use `lrms_v2_test` only.
  - Stop the dev server before `prisma migrate dev` (Windows EPERM).
- **Old URLs redirect** (`next.config.ts` `redirects()`), so emailed links keep working.

## Phases

### P0: Branch, backup, decisions record
- `git switch -c feat/ux-flow`, commit the pending docs, and `pg_dump lrms_v2`.
- Write `docs/decisions/2026-10-01-ux-flow.md` (this plan's decisions) and add a PROGRESS entry.

### P1: Cut the clutter (see the removal inventory below; the user may strike rows)
- One migration drops what the inventory removes.
- Code paths, routes, screens, specs and help chapters for those structures are deleted.
- `clearDatabase` and the seed are updated.
- **Fixed rules replace the removed configuration:**
  - **Reads:** every signed-in internal account reads the whole university. The Mine / Whole
    university switch stays.
  - **Writes:** follow role and custody.
  - **Who may request a transfer:** a custodian, a store keeper or a head. This replaces the
    ApprovalPolicy lookup in `approvals.ts:217-221`. Chains keep coming from `movementChain`
    (unchanged).
  - **Lab drafts are always on:** the `draftWorkflowEnabled` check in `mutate.ts`,
    `lab-versions.ts`, `ChangeModal` and `LabStatesPage` becomes unconditional. The mechanism
    itself (accumulate, then submit once to the head) is unchanged.
- **Needs become the purchase input** (replacing ideals):
  - `NeedLine` gains `labItemId` (which lab), `priority` (Essential / Important / Nice to have),
    `kind` (New | Replacement, with `replacesItemId`) and `spec` (free text).
  - The head's compile screen groups open needs by lab, each with a checkbox, quantity edit and
    "carry".
  - Replacement suggestions from broken or lost items are kept (the useful half of
    `lib/domain/purchasables.ts`, with the ideal gap removed). The custodian turns a suggestion into
    a need in one click from the broken item.
- **Bookings:**
  - A custodian books **their own** lab or machine for someone, with "Booked for" (name) and a
    reason. It is confirmed at once.
  - Heads and custodians may still **request** a room someone else holds, and that custodian
    decides (today's flow). This is kept unless the user strikes it.
  - Weekly classes and external holds are unchanged.
- **Reseed** `lrms_v2`, after the backup:
  - **Org:** ASTU → five colleges (CoEEC, CoMCME, CoCEA, CoANS, CoHSS), their departments, and
    the offices (CMD, PROC, PROP, ICT).
  - **People:** today's people, plus one ADAA account per seeded college.
  - **Kept:** CHEM's labs, equipment, photos and chemicals (`real-data-seed.ts`,
    `chem-lab-data.ts`, `seed-assets/equipment`), and CSE's labs (`cse-lab-data.ts`, filed into
    the fixed Lab fields).
  - **New:** the ASTU category catalogue (Appendix A).

### P2: Roles and places
- **The ADAA role:** a `RoleKind ADAA`, homed at the college (or an office under it).
  - Scope: the college and every department under it (`orgScope.visibleNodeIds`).
  - Granted in People & roles.
- **Capabilities, computed server-side:** `lib/server/auth/capabilities.ts` returns
  `{ isAdmin, isPropertyAdmin, isProcurement, isStoreKeeper, isCustodian, headOf[], deanOf[],
  adaaOf[], officeCodes[], isAvp, managesPlacesIn[], decidesBookings }`.
  - `isHeadOf`, `headNodeIdsOf` and `findOffice` are reused (`lib/server/org/scope.ts`,
    `offices.ts`).
  - The result is exposed on `/api/auth/me` (`MeContextDto.caps`).
  - Nav, Home and the server all read the same facts.
- **Who manages places** (`assertCanManagePlace`, replacing `assertCanCreateRoot`):
  - **Head:** places owned by their department.
  - **ADAA:** the college's stores and the labs of its departments.
  - **Property Admin:** the university Main Store and any store.
  - **SYS_ADMIN:** all.
  - A place's own details (name, block, room, seats, purpose, bookable) are edited only by place
    managers.
  - Custodians edit the contents (through drafts), never the place.
  - `AddModal` stops offering "Top level".
- **New screen, "Labs & stores"** (`/places`, which also replaces Lab states):
  - **List:** every place in the manager's scope, showing custodian, block/room, seats,
    bookable, item count and a needs-attention count.
  - **"Add a lab" / "Add a store":** a short form, and the custodian is picked from the unit's
    custodians. The custodian is notified.
  - **Reassign custodian:** notifies both the old and the new custodian.
  - **Custodians** see "My labs".
  - **A lab's page** (`/places/[id]`) has three tabs:
    - **Contents:** the Register tree filtered to that lab.
    - **My changes:** today's Lab states draft editor and Submit, moved here unchanged in behaviour.
    - **Bookings:** that lab's calendar.
- **Places are fixed system categories** (Lab, Workshop, Studio, Store), editable only by Admin
  and Property Admin:
  - Lab: Block (text), Room (text), Seats (number), Purpose (long text).
  - Store: Level (Main / College / Department), Block, Room.
  - `canBeRoot` and the placement allow-list are replaced by one flag: `isPlace`. Places are top
    level only, and everything else goes inside a place or a thing.

### P3: Categories that can't be broken
**Editor fixes** (`CategoryEditor.tsx`, `lib/server/resources/categories.ts`, `lib/domain/edit-impact.ts`)
- **Storage keys disappear from the UI:**
  - A new field's key is generated at save from its label and made unique (`room`, `room_2`).
  - An existing field keeps its key for ever.
  - The category key is generated from the name.
  - Collisions become impossible, and the "Stable key" and "Storage key" inputs are removed.
- **Field identity is tracked:** each draft field carries `originalKey`. Only existing fields
  with values are protected; new fields are never locked.
- **Renaming a field that holds values** asks: "Same property, new name" or "A different
  property". The second keeps the old field and adds a new one, which prevents the Seats → Room
  Number corruption.
- **Changing a type converts, it doesn't purge:**
  - New pure `lib/domain/field-migration.ts` (with spec):
    - TEXT→NUMBER parses "16", "16 GB" and "1,200";
    - TEXT→YES/NO accepts yes/no/true/false;
    - TEXT→CHOICE builds the options from the distinct values;
    - NUMBER→TEXT always converts.
  - The review lists the values that won't convert, item by item, with an inline fix box. Values
    left unfixed move to the item's "Extra details" (custom props) as "<label> (old)". Erasing
    is a separate, explicit choice.
  - The server rewrites converted values to their typed form inside the same transaction.
- **Making a field required on a category that has items** asks for "Fill existing items with ___"
  or "Leave existing items blank (asked on their next edit)".
  - Items created by the system (import loads, template parts) never block. They are flagged
    "missing details" and listed on the custodian's Home.
  - `imports.ts:241` passes `systemCreate: true`, which skips the required check.
- **Choice options:**
  - "Rename option" moves its values.
  - Removing an option that holds values requires mapping it to another option.
- **A new field type, Date:** an enum value in `CategoryFieldType`. It is used for expiry and
  calibration due, and drives "Due soon" on Home.
- **Usability:**
  - Search over the category list.
  - "Start from a template" (Appendix A presets) and a short description of each category.
  - Common-field presets: Manufacturer, Model, Serial no., Year acquired, Asset tag, Calibration
    due, CAS no. (text, with format hint).
  - The editor stays open after save with a success notice.
  - An unsaved-changes guard on switching category or leaving the page.
  - A version conflict re-applies your draft onto the fresh definition and shows what moved,
    instead of throwing it away.
  - Plain labels for the impair rule ("If a critical part fails, this is: impaired / impaired
    only when all fail / unaffected"), under "More options".

**Governance** (new `lib/domain/category-governance.ts` with spec, plus `CategoryChange` model)
- `ResourceCategory` gains:
  - `stewardNodeId`: the department that made it. System and catalogue categories are stewarded
    by Property Admin.
  - `createdById` and `description`.
- **Who may act:** custodians and heads of the steward department, plus Admin and Property Admin.
  Others see the category read-only, with "Suggest a change" and "Make a copy for my department".
- **`classifyEdit(before, after, itemsByOwnerDept, stewardNodeId)`** returns one of three classes:
  - **Additive** (applies at once and notifies the head): a new category; adding an optional
    field, an option or a part; icon or description changes; a label change on a field with no
    values.
  - **Changing** (pending until the steward's head approves; a head's own edit applies after the
    impact review): a type change, a removal, a newly required field, a counting-mode change,
    renaming a field that holds values, or removing options.
  - **Cross-department** (when a changing edit touches items owned by other departments): the
    chain is proposer's head → Admin → Property Admin. The editor shows "This changes data in
    Chemistry and CSE. Usually it's better to make a separate category", with a one-click copy.
- **`CategoryChange`** (categoryId, proposedById, payload JSON, baseVersion, impact snapshot, class,
  stage HEAD|ADMIN|PROPERTY_ADMIN, status PENDING|APPROVED|REJECTED|WITHDRAWN|STALE, notes,
  decidedBy/At):
  - Approval runs the existing `update()` against `baseVersion`. If the category has moved on,
    the change becomes STALE and the proposer gets "Update my proposal".
  - Proposals show as a "Pending change" badge on the category, and appear in Approvals and Home.
  - On creation, the head gets a notification with "Remove" and "Adjust" links.

### P4: Home, notifications, deep links, sidebar RBAC
- **`Notification` model** (userId, kind, title, body, path, actorId, createdAt, readAt):
  - `lib/server/mail/notify.ts` `notify()` writes a row for every recipient (all active users,
    whatever their email setting), then emails those who opted in.
  - The existing ~15 call sites get it for free. New events are added: category
    created/changed/decided, custodian assigned, need declined, booking made for you.
  - Rows are swept after 90 days in the existing cron.
- **Deep links:**
  - `lib/paths.ts` (as in the sister app) builds item-specific paths:
    - `/approvals?focus=transfer:<id>`
    - `/purchasing?request=<id>`
    - `/places/<id>?tab=changes`
    - `/categories?id=<id>&change=<id>`
    - `/bookings?focus=<id>`
  - The target screens scroll to, open and highlight the item.
  - Every `path:` in notify calls is switched to these.
- **Bell in the top bar:**
  - Shows the unread count, refreshed on focus and every 60 s.
  - Opens a list of the latest updates, each linking to its item, with "Mark all read".
- **Login honours `?next=`:** `ProtectedRoute` passes the current path, and a 401 mid-session
  redirects to sign-in with `next` (`lib/api.ts`).
- **`/home` is everyone's landing page** (`landingPathFor` → `/home`):
  - `lib/server/home.ts` reads the facts.
  - Pure `lib/domain/home-logic.ts` (spec) picks the next step per role (the sister app's
    `home-logic.ts` pattern).
  - **Next step:** one banner with one button. Examples:
    - "Submit your draft for B510-R8, 4 changes waiting";
    - "3 transfers are waiting for your decision";
    - "Record what arrived for PR-2026-002".
  - **Waiting for you:** counts by kind that link straight to the filtered list. The kinds are
    transfers, lab changes, purchase steps, bookings, category changes, needs to compile, imports
    to record or load, external tasks and items missing details.
  - **Your requests:** each open request with where it is now ("with the CoEEC Dean, 2 days").
  - **Unfinished:** unsent lab drafts and staged attachments (Zeigarnik).
  - **Recent updates:** the last 8 notifications.
  - **Due soon:** calibration or expiry dates within 30 days (custodians and heads).
  - **The unit at a glance:** labs, items, % working and needs attention (heads, deans, ADAA,
    AVP). It links to Insights.
  - **Admin:** vacant posts, places without a custodian, people with no role.
- **Sidebar badges** come from `GET /api/home/counts` (the same facts, counts only).
- **Approvals as one inbox:**
  - A single "Waiting for me" list across kinds, with kind chips, then a "Sent by me" tab.
  - It replaces the four stacked panels, each with its own toggle (`ApprovalsPage.tsx:523-533`).
  - The cards are reused (`TransferRequestCard`, `LabCommitCard`, `PurchaseRequestCard`,
    `BookingCard`, plus a new `CategoryChangeCard`).
- **Sidebar RBAC:** `NavItem.when(caps)` replaces `roles`, and `canAccessPath` uses the same
  predicate. The matrix is below. Items become `<Link>`s, so open-in-new-tab works.

### P5: UX sweep across what remains
- **Naming pass:** the glossary below is applied in nav, headers, buttons, emails and help.
  Internal values are hidden: "Version", "L2 · leaf", raw role enums and storage keys.
- **Feedback:**
  - A toast system (`components/ui/toast.tsx`) for every successful action, with "View" links.
  - Confirmations use the warn tone for warnings and danger only for destructive actions
    (`ui.tsx:271`).
- **Errors:**
  - The 22 `.catch(() => setX([]))` become `InlineError` with Retry (`components/states`).
  - Failed inline saves keep what was typed (`Inspector.tsx:163-185`).
  - `error.tsx`, `loading.tsx` and `not-found.tsx` for the workspace.
- **Dialogs:**
  - `Modal` gains `dirty`: a backdrop click or Escape asks before discarding.
  - Initial focus, a focus trap and focus return.
  - Names on the expand chevrons.
- **Readability:**
  - The `--faint` token is raised to ≥ 4.5:1 in both themes.
  - The text floor is 11 px, buttons are 28 px and tags 10.5 px.
  - lucide icons replace the Unicode glyphs in nav and shell.
- **Links:** item, lab, person and request names link to their page (`?item=<id>` opens the
  Resources inspector).
- **Resources table:**
  - Sticky header, sortable columns and an honest empty state.
  - The bulk bar is cut to the common actions, with the rest under "More".
  - "Export this view" (.xlsx). This needs the `exceljs` dependency, which is not installed today.
- **Purchasing in tabs:** Needs · Requests · Arrivals (replacing one long stack of panels).

### P6: Help, docs, verification
- `docs/user-guide/*` is rewritten for the remaining roles (custodian, head, ADAA, dean/AVP/CMD,
  Property Admin, procurement, store keeper, admin, outside requester).
- Then `npm run help:build`, and screenshots retaken on the reseeded DB.
- `e2e/validate-approval-lines.ts` is updated for the cuts and re-run. A new mail tour follows every
  emailed link through Mailpit.
- `PROGRESS.md` gets a Timeline entry per phase, plus a hand-off note.

## Removal inventory (strike any row to keep it)

| # | What goes | Where it lives | Replaced by |
|---|---|---|---|
| 1 | **STAFF role** (27 role rows in dev) | `RoleKind`, `lib/shared/enums.ts`, `session.ts` `STAFF_ROLES`, nav, `BOOKING_ROLES`, `canRaiseNeed`, `purchase-attachments`, people pickers | Custodian, head and office roles. Staff deal with custodians outside the system. |
| 2 | **STUDENT role** (0 in dev) | same files, `lib/help/audience.ts`, Student guide chapter | nothing |
| 3 | **Staff holdings**: per-department place, `staff-holdings` category, "Hand over → To a person" (`issueToUserId`), recipients route, head's return of staff items | `lib/server/resources/staff-holdings.ts`, `TransferModal.tsx`, `approvals.ts`, `mutate.ts`, `transfers/recipients` | Items stay in labs; custodians lend outside the system |
| 4 | **Access views**: `AccessView`, `AccessViewAudience`, `ScopeMode` and `viewId` on item routes, sidebar picker, admin page, `seed-views.ts`, `views-rollout.ts` | `lib/domain/views.ts`, `lib/server/resources/views*.ts`, `lib/register/active-view.ts`, `components/admin/AccessViewsPage.tsx` | Fixed read rule (whole university) and the Mine / Whole-university switch |
| 5 | **Approval policies**: `ApprovalPolicy` table (52 rows; only "who may request a transfer" is ever read), `PolicyOutcome`, `seed-policies.ts`, `resolvePolicy` | `prisma/schema.prisma`, `lib/domain/approvals.ts`, `approvals.ts:217` | A fixed rule: custodian, store keeper or head may request; chains from `movementChain` (unchanged) |
| 6 | **Per-department draft switch** (`OrgNode.draftWorkflowEnabled`, its API and the Org Studio toggle) | `app/api/org/nodes/[id]/draft-workflow`, `OrgStudioPage.tsx`, `mutate.ts`, `lab-versions.ts` | Drafts always on for custodians |
| 7 | **Lab ideals** (`IDEAL`, `IDEAL_PROPOSAL` versions; 31 in dev), the ideal-vs-actual route, ideal gaps in purchasables, the Ideal column | `lab-versions.ts`, `LabStatesPage.tsx`, `purchasables.ts`, `PurchasingPage.tsx` CompilePanel | Richer needs per lab, plus replacement suggestions from broken items |
| 8 | **The Lab states page** as its own screen | `app/(workspace)/lab-states`, `LabStatesPage.tsx` | The "My changes" tab on a lab's page (same draft/submit behaviour) |
| 9 | **Placement allow-lists and "can be root"** (`CategoryPlacementRule`, `CategoryPlacement`; 0 rules in dev) | `lib/domain/placement.ts`, the editor's Placement section | `isPlace`: places are top level, everything else goes inside |
| 10 | **Custodian-created labs and stores** ("Top level" in Add) | `AddModal.tsx`, `scope.assertCanCreateRoot` | Labs & stores, managed by head, ADAA and Property Admin |
| 11 | **Admin "Overview" page** | `components/admin/AdminDashboardPage.tsx` | The admin block on Home |
| 12 | **`/university` page** (already a redirect) | `app/(workspace)/university` | Redirect only, in `next.config.ts` |
| 13 | **Storage and category key inputs** | `CategoryEditor.tsx` | Generated keys |
| 14 | **Org "change level"** (levels follow parents) | `app/api/org/nodes/[id]/change-level`, Org Studio | Levels derived when parents change |
| 15 | **Staff, Student and ICT-as-STAFF guide chapters**; the ICT officer's STAFF access view | `docs/user-guide`, `seed-ict-maintenance.ts` | The ICT officer occupies the ICT office and reads everything by the fixed rule |

**Kept as is:**
- all approval chains (purchase, movements, store, external, lab drafts);
- imports and attachments;
- the external portal and payments;
- weekly classes;
- critical parts and impair rules (under "More options");
- item "Extra details" (custom props), which now catch values that a type change can't convert;
- the Mine / Whole-university switch;
- org multi-parent edges (CSE under two colleges);
- the public catalogue counts.

## Sidebar by role (✓ = shown)

| Item (new name) | Custodian | Head | ADAA | Dean / AVP / CMD | Property Admin | Procurement | Store keeper | Admin |
|---|---|---|---|---|---|---|---|---|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Resources | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Labs & stores | My labs | ✓ | ✓ | – | ✓ | – | stores | ✓ |
| Bookings | ✓ | ✓ | – | – | – | – | – | ✓ |
| Approvals | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Purchasing | needs | ✓ | – | ✓ | ✓ | ✓ | arrivals | ✓ |
| Outside requests | if assigned | ✓ | – | ✓ | – | – | – | ✓ |
| Categories | ✓ | ✓ | ✓ | – | ✓ | – | – | ✓ |
| Insights | – | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| History | – | ✓ | ✓ | – | ✓ | – | – | ✓ |
| People & roles | – | own dept | own college | – | – | – | – | ✓ |
| Organisation | – | – | – | – | – | – | – | ✓ |
| Help, Profile | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Naming glossary (old → new)

| Area | Old → new |
|---|---|
| Navigation | Dashboard → **Insights** (and a new **Home**) · Register → **Resources** · Lab states → **Labs & stores** › **My changes** · Schedule → **Bookings** · External requests → **Outside requests** · Change log → **History** · Org structure → **Organisation** |
| Drafts | "Draft" → **My changes (not sent yet)** · "Lab commit" → **Lab changes** |
| Purchasing | "Compile a purchase request" → **Build a purchase request** · "Raise a need" → **Ask for something** (a need) · Pipeline → **Where it is now** · Imports → **Arrivals** |
| Register actions | "Hand over…" → **Move…** (Loan / Permanent / Return to store) · "Set property…" → **Edit details…** |
| Category editor | "Counted as" stays · "When its parts break" → **If a critical part fails** · "Made of — the default subtree" → **Comes with** · "Fields — the defined metrics" → **Details to record** |

## Stop points (I will pause and ask)
1. **Before P1's migration:** I show the final removal list. A row you strike stays.
2. **Before reseeding `lrms_v2`:** I confirm the backup path and what is preserved.
3. **Nothing touches Neon or `master`:** production is a separate, confirmed step after you review
   the branch.

## Verification (every phase, before its commit)
- `npx tsc --noEmit`, `npm test` (on `lrms_v2_test`), `npm run build`.
- **New specs:** `field-migration`, `category-governance`, `home-logic`, `capabilities`/nav, and the
  needs compile grouping.
- **Updated specs** for the removed structures, deleted together with them.
- **`e2e/validate-approval-lines.ts`** on a fresh clone with the mail sink: every chain still routes
  and mails the right people, and the links are item-specific.
- **Browser pass** on `dev-nomail`/Mailpit as a custodian, head, ADAA, dean, Property Admin, store
  keeper and admin, at 1280 px and phone width in both themes:
  - Home shows the right next step;
  - the sidebar matches the matrix;
  - a custodian can't create a lab;
  - a head creates a lab and assigns a custodian, who sees it on Home;
  - a custodian adds a category and the head gets a notification;
  - a type change "Room text → number" converts or holds values, and nothing is purged;
  - a required field doesn't block the store keeper's load;
  - a cross-department edit escalates to Admin;
  - each notification link opens the exact item.
- **No console errors**, and a contrast check over the `globals.css` tokens.
- **The dev DB keeps** the CHEM machines with their photos after the reseed (count and photo
  check).

---

## Appendix A: ASTU category catalogue (seeded in P1, stewarded by Property Admin)

**Sources:** the [ASTU About page](https://www.astu.edu.et/9-about-astu),
[CoEEC](https://www.astu.edu.et/Colleges/CoEEC/), [CoMCME](https://www.astu.edu.et/Colleges/CoMCME/),
[CoCEA](https://www.astu.edu.et/Colleges/CoCEA/) and the
[Schools](https://www.astu.edu.et/17-academics/schools) page give the colleges and departments.
Lab contents come from the departments' own CHEM equipment list (`prisma/chem-lab-data.ts`) and
the CSE lab list (`docs/cse_labs.md`). The rest is standard equipment for these programmes, which
departments refine through the governance flow.

**Fields:**
- Every **instrument** shares the preset Manufacturer, Model, Serial no., Asset tag, Year
  acquired, Calibration due (date) and Notes.
- **Bookable** means bookable equipment. A ★ marks instruments listed on the outside portal (for
  sample analysis).

**Places** (system, top level only, Lab = bookable room)
- Lab
- Workshop
- Studio
- Store

**Computing & AV** (shared)
- Workstation (comes with: computer\*, monitor\*, keyboard, mouse, table, chair)
- Computer
- Laptop
- Monitor
- Server
- Network switch
- Router / Wi-Fi access point
- Rack
- UPS
- Projector
- Interactive board
- Printer / plotter
- 3D printer
- Document camera
- Headset (language lab)

**Furniture & safety** (shared)
- Lab bench
- Stool / chair
- Table
- Whiteboard
- Fume hood
- Fire extinguisher (expiry date)
- Eye-wash station
- First-aid kit
- Safety cabinet (flammable / acid)
- PPE (bulk, pcs)

**Electrical & electronics** (CoEEC: CSE, ECE, EPCE, SE)
- Oscilloscope
- Function generator
- DC power supply
- Digital multimeter
- Spectrum analyser ★
- Logic analyser
- Microcontroller / FPGA kit
- Embedded trainer
- Communication trainer (analogue / digital)
- Microwave / antenna trainer
- Fibre-optic trainer
- PLC trainer
- Control systems trainer
- Electrical machines trainer (motor / generator set)
- Transformer trainer
- Power-system simulator
- High-voltage test set
- Power analyser
- Solar PV trainer
- Soldering station
- Electronic components (bulk)

**Mechanical & manufacturing** (CoMCME: Mechanical; thermal, design, vehicle, agri-machinery)
- Lathe
- Milling machine
- CNC machine
- Drilling machine
- Grinding machine
- Welding machine (arc / MIG / TIG)
- Sheet-metal tools
- Engine test bed ★
- IC engine cut-section
- Automotive trainer (brakes, transmission, electrical)
- Refrigeration & AC trainer
- Steam / boiler trainer
- Heat-engine trainer
- Fluid mechanics bench
- Pump test rig
- Wind tunnel
- Vibration trainer
- Hand tools (kit)

**Chemical & process engineering** (CoMCME: Chemical; from the department's own list)
- The 18 existing unit-operation categories are kept as they are, with their photos: filtration,
  fluidised bed, mixing, sedimentation, size reduction, solids handling, chromatography, reactor
  training unit, fluid mechanics trainer, process control trainer, absorption/adsorption,
  crystallisation, diffusion, distillation/evaporation, drying, extraction, heat exchanger and ion
  exchange.

**Materials science & testing** (CoMCME: Materials; CoCEA)
- Universal testing machine ★
- Hardness tester
- Impact tester
- Fatigue tester
- Metallurgical microscope
- Polishing / grinding machine
- Muffle furnace
- XRD ★
- SEM ★
- TGA / DSC ★
- FTIR ★

**Civil, water & surveying** (CoCEA: Civil, Water Resources, Construction, Hydraulics, Geoinformatics)
- Concrete compression machine ★
- Concrete mixer
- Slump cone
- Sieve shaker
- Los Angeles abrasion machine
- Marshall stability tester ★
- Casagrande apparatus
- Direct shear apparatus
- Triaxial apparatus ★
- Consolidometer
- Proctor compaction set
- Hydraulics flume
- Hydraulics bench
- Total station
- GNSS receiver
- Automatic level
- Theodolite
- Drone / UAV
- Water-quality meter
- Rain gauge

**Architecture** (CoCEA: Architecture, Urban Planning)
- Drafting table
- Laser cutter
- Model-making tools
- Large-format plotter

**Analytical chemistry & biology** (CoANS: Applied Chemistry, Industrial Chemistry, Applied Biology, Pharmacy)
- **Instruments:**
  - UV-Vis spectrophotometer ★
  - AAS ★
  - HPLC ★
  - GC ★
  - Analytical balance
  - pH / conductivity meter
  - Centrifuge
  - Rotary evaporator
  - Hot plate / stirrer
  - Drying oven
  - Incubator
  - Autoclave
  - Laminar-flow cabinet
  - Biosafety cabinet
  - Compound microscope
  - Stereo microscope
  - PCR thermocycler ★
  - Gel electrophoresis
  - Refrigerator / −80 °C freezer
  - Water distiller / deioniser
  - Dissolution tester
  - Tablet press
- **Chemicals and reagents** (bulk, with unit):
  - CAS no. (text, format hint) and formula;
  - Hazard class (GHS choice: flammable, corrosive, toxic, oxidiser, irritant, health hazard,
    environmental, none);
  - Grade (AR / LR / technical);
  - Storage (flammable cabinet / acid cabinet / cold / general);
  - Expiry (date).
- **Glassware** (bulk, pcs): type and volume.
- **Lab consumables** (bulk): filter paper, pipette tips, gloves and so on.

**Geology & physics** (CoANS: Applied Geology, Applied Physics)
- Petrographic microscope
- Rock saw
- Thin-section kit
- Rock & mineral specimen set
- Field kit (GPS, compass-clinometer, hammer)
- Optics bench
- Laser
- Spectrometer
- Radiation counter
- Physics experiment kit (mechanics / electricity)

# Feedback round 2026-10-02: roles, live counts, procurement flow, distribution, outside-request builder, calibration

## Context

You walked the app on `feat/ux-flow` (P0–P6 plus follow-ups, nothing merged; `master` and Neon are untouched) and sent 17 comments. Here is what the code showed for each one:

- **Category name twice:** `CategoriesPage.tsx` prints an `h2` with the name. Then `CategoryEditor`'s read-only view (`CategoryReadOnly`) prints it again. Editors get the `h2` plus a Name input right under it.
- **Badges vanish:** `homeCounts()` (`lib/server/home/home.ts`) counts only what waits on *you*. Anything you've sent or are following that's still moving shows nothing. Only Purchasing's "Lab needs" tab has a count.
- **Procurement "approves":** procurement is the last step of the approval ladder. Approving drops the request to ORDER_PLACED. After that, `advanceStage` is a note plus "Advance", one fixed stage at a time. There's no way to edit lines, combine requests, or record partial finds.
- **Store keeper sees everything:** `defaultModeFor` (`lib/server/resources/scope.ts`) gives a pure STORE_KEEPER `ORG_SUBTREE` of their home node, which is the whole university. Store edits apply directly (`lab-versions.ts`, `isStore`), so nobody approves them.
- **Return to owner:** your test on the dev DB, 18:59: the lender asked for the item back, and Ali, the borrower, could only refuse. The Inspector shows "Return to owner…" only to the item's custodian, who is the lender. The borrower has no button. The code comment admits this gap.
- **"Why isn't the transfer going":** a custodian's Change this → Custody, Ownership or Current unit inside a lab is refused by `stageIfDrafted`. The message is "…go through a move (transfer)". Those tabs shouldn't be offered to custodians at all.
- **Roles:** Bookings is gated by the MANAGER *role*, so deans, the AVP and the CMD pass. The CMD sees Outside requests through `leader`. Deans manage places (`managesPlacesIn`). People & roles is limited to heads and the admin.
- **Errors:** `parseBody` returns "Validation failed" and hides the Zod issues. Login says only "Invalid email or password".
- **Outside requests:** the head types contact persons by hand. A custodian can hold the same thing repeatedly. The requester describes needs as free-text lines. Payment is only a transaction reference.
- **Calibration:** there's only a free "Calibration due" date detail. Nothing is computed and nothing is filterable.

Your answers: Property Admin approves distribution sends and the lab custodian confirms receipt (no head step). Property Admin checks arrival counts (pre-filled from procurement) before the keeper loads. A store keeper's "Mine" is the stores they keep. The ADAA manages people in their college. Property Admin manages store staff. Deans lose place management. The AVP, CMD and deans lose Bookings, and the CMD loses Outside requests.

The rule from your earlier rounds still holds: no em-dashes in app wording.

Work goes on `feat/ux-flow`, one commit per phase, and PROGRESS.md is updated after each phase. Migrations are additive and applied to `lrms_v2` only, with a backup first. Neon is not touched.

---

## Phase R1: Quick fixes (small, independent)

1. **Category name once.** Drop the page `h2` in `components/resources/CategoriesPage.tsx`. The editor and the read-only view each own the header (icon, name, group). For editors, the Name field is the header.
2. **Remove "Expand all".** Remove it from `RegisterPage.tsx`, `WholeUniversityRegister.tsx`, `DashboardPage.tsx` and `places/LabView.tsx` (both spots). Per-row chevrons stay, and so does grouping.
3. **Decision dialogs say what happens next.** Each card already has its chain (`steps`) and the raiser. The approve, reject and send-back labels and messages are built from them:
   - "Approve and send to the CoEEC Dean" or "Approve and send to the AVP".
   - The last step reads "Approve: it goes to procurement".
   - Send back reads "Return to the CSE head to revise".
   - Reject reads "Reject: it stops here and the head is told".
   - The same applies to transfers ("Approve and send to Property Administration", "Confirm you received it") and lab changes ("Approve: the register changes now").
   - Outside requests: "Approve and send up to the AVP" and "Return to the CSE head".
   - Files: `ApprovalsPage.tsx`, `ExternalRequestsPage.tsx`, and a small helper `nextStepLabel(steps)` in `lib/domain/approvals.ts`.
4. **Errors that say how to fix it.**
   - `lib/server/validate.ts` `parseBody` turns Zod issues into one readable message: "Contact person 2: email: give a valid email address, like name@astu.edu.et". Field paths are mapped to labels, and `issues` stays in the body.
   - The Zod messages in `lib/shared/external.ts`, `purchasing.ts`, `people.ts` and `places.ts` get fix-it wording.
   - Login (`lib/server/auth/auth.ts`) separates the cases:
     - no account with that email: "No account uses this email. Check the spelling, or ask your department head for an invitation";
     - wrong password: "The password is wrong. N tries left before a 15-minute pause";
     - disabled: "This account was turned off by an administrator";
     - not yet activated.
   - The throttle stays. Note: naming whether an email exists is a deliberate trade-off for an internal system; the plan accepts it.
   - `lib/api.ts` `ApiError` keeps `message`. The client's "Request failed" fallbacks say what was being done.
5. **Payment.**
   - Portal `PaymentPanel.tsx` gets an optional "Link to your receipt" field (https only, validated). It's stored on `PaymentVerification.receiptLink` (migration).
   - The AVP sees the link as a button beside the verifier's own receipt link.
   - The AVP's payment card shows "Paid into: CBE 1000370930353, check the receipt against this" from `receiverConfig("CBE")`.
   - `.env.development.local.example`, the `dev-nomail`/`prod-nomail` launch envs and the requester's bank details use 1000370930353 (CBE).

## Phase R2: Who does what (roles, scope, store approvals, Change this, returns)

1. **Nav and server gates follow occupancy, not the MANAGER label.**
   - `lib/nav.ts`: Bookings is for admin, custodian, head, ADAA and Property Admin. Outside requests is for admin, head, dean, AVP and custodian; the CMD is dropped. People & roles is for admin, head, ADAA and Property Admin.
   - `lib/server/scheduling/context.ts` `BOOKING_ROLES` becomes a capability check: custodian, head (occupies a department), ADAA, Property Admin, admin.
   - `lib/server/external/requests.ts` `accessFor` keeps the AVP, deans, heads and custodians.
2. **Places.** `capabilitiesOf` (`lib/server/auth/capabilities.ts`):
   - Deans no longer get `managesPlacesIn`.
   - The ADAA keeps the college's stores (create, edit) and may also change who runs any lab or store in the college. Creating labs stays with the head.
   - Property Admin keeps the university's places.
   - `places.ts` `mayManage` splits into "create/edit place" and "assign who runs it".
3. **People.** In `lib/server/people/people.ts`, `assertMayManageStaff`, invites and resend are extended:
   - the ADAA reaches their college subtree (the CUSTODIAN and STORE_KEEPER roles, homed in the college);
   - Property Admin reaches STORE_KEEPER accounts and the PROP office's people.
   - Neither touches post holders or admin-only roles. Specs are added to `people.spec.ts`.
4. **Store keeper scope.** In `defaultModeFor`, a STORE_KEEPER without a head post gets `MY_CUSTODY`: their stores and everything in them. The whole-university switch is unchanged. Labs & stores already lists only the places they keep.
5. **Store changes go to Property Admin.** In `lab-versions.ts`, `stageIfDrafted` stops exempting stores. Every place's contents are edited through its Changes draft. The decider (`decideCommitNow`, plus `listForActor` inbox and the notices) is:
   - the owning head for a department's lab;
   - Property Admin for every store and for any place not owned by a department (college- or university-owned).

   Import loads (`systemCreate`) stay direct. Wording: "Send to Property Administration".
6. **Change this.**
   - `ChangeModal.tsx`: custodians and store keepers see Status, Position (within the same place) and Remove. Name, quantity and details stay inline in the Inspector.
   - Custody, Owning unit and Current unit become Property Admin's tabs, shown only to Property Admin and the admin.
   - Server (`mutate.ts` `assertAuthorized`): Property Admin may apply `setCustodian`, `setOwnerOrg` and `setCurrentOrg` to any item, directly, with a required reason, recorded in History. Custodians get a clear 403 on these.
   - Custodians who need something moved out use "Move to another place…" or "Request to my lab", which are transfers.
7. **Return to owner, either side.**
   - The Inspector shows "Return to owner…" to the borrower too (`custodyItemIdsOf` host side, owner ≠ current).
   - New `ReturnToOwnerModal`. Its destination defaults to where the item came from, read from the applied LOAN request's `baseVersions` snapshot (`parentId`), via a new `GET /api/resources/transfers/return-target?itemId=`. It falls back to a picker over the owning unit's places.
   - Chain: when the host starts it, the host's release is implicit (they asked), then the owner's custodian confirms receipt. When the lender asks, it's as today: the host releases, then the owner confirms. `resolveTransfer` RETURN and `movementChain("RETURN")` drop the HOST_RELEASE step when the requester *is* the host releaser.
   - The lender's button reads "Ask for it back…".

## Phase R3: Live counts on the sidebar and tabs

1. **What gets counted.** `HomeCountsDto` becomes per area: `{ action: n, following: n }`. `action` is waiting on you (as today). `following` is what you started or are part of that hasn't reached its end. Areas: Approvals, Purchasing, Labs & stores, Outside requests, Bookings. Built in `homeCounts` from the same `listForActor(…, "mine")` and pipeline sources Home already uses:
   - a purchase request counts until CLOSED, and a procurement until loaded;
   - a transfer counts until it's APPLIED;
   - lab changes count until decided;
   - an outside request counts until SCHEDULED;
   - a booking request counts until decided.

   Failed endings (rejected, cancelled, declined, expired, stale) stop counting at once.
2. **Sidebar** (`components/shell/Sidebar.tsx`), two chips:
   - action: solid accent, white number, as today;
   - following: a soft slate-blue chip (new `--follow` / `--followbg` tokens, a muted blue in the same family as the accent, ≥ 4.5:1 in both themes).
   - Tooltip: "3 waiting for you · 5 in progress".
3. **Tabs.** The `Tabs` primitive (`components/ui.tsx`) takes `count` and `following`, using the same two styles. The orange `waiting` tag stays on items that wait on someone else's approval, as you liked.
   - Approvals: "Waiting for me (3)", "Sent by me (5)".
   - Purchasing: Lab needs, Requests, Procurement, Arrivals, Distribute (R4 and R5 tabs).
   - Labs & stores: changes not sent and changes waiting.
   - Outside requests, and the place page's Changes and Approvals tabs.
4. **Finished items step aside.** In "Sent by me" and request lists, finished and failed items go into a collapsed "Finished (n)" section at the bottom (the archive). Nothing is deleted.
5. `lib/home-counts.tsx` keeps its one-minute and on-focus refresh. Screens call `refresh()` after acting.

## Phase R4: Procurement as a process

**Data** (migration):
- `Procurement` (`PROC-2026-001`): title, `egpReference`, supplier, stage, createdBy.
  - Stages: `PREPARING → PLACED_ON_EGP → BUYER_FOUND → ON_DELIVERY → ARRIVED → CLOSED`, plus `CANCELLED`.
- `ProcurementRequest`: which purchase requests it covers. Zero rows means a standalone EGP purchase.
- `ProcurementLine`: name, category, qty, unit, unit cost, spec, and an optional `purchaseLineId`.
- `ProcurementEvent`: stage, note, at, by, and `lineChanges` JSON such as "Chairs 412 → 380: only 380 found".
- `ImportRecord` gains `procurementId`.

**The ladder's last step** is no longer an approval:
- Procurement's actions are "Start the purchase", "Send back for revision" and "Reject".
- "Start the purchase" marks the request `WITH_PROCUREMENT` (new stage, "With procurement"). It offers "New procurement from this request" or "Add to procurement PROC-…" (one that is still PREPARING).
- `decideStep` in `lib/server/resources/purchasing.ts` handles the procurement step's verb. `lib/domain/purchasing.ts` adds the stage label and help text.

**Procurement page** (Purchasing → Procurement tab, `components/resources/ProcurementPage.tsx`):
- **List.** "Start a procurement" lets you choose any number of requests that are with procurement, or none for standalone EGP. Lines are pre-filled from the chosen requests and can be edited before placing.
- **Detail is a timeline.** A stage picker moves forward with ease: one click to the next stage, or pick a later one. Optional note and EGP reference.
- **Line editing at any stage** ("Edit what's being bought"): change quantities, add or remove lines, give a reason. It's recorded as a `lineChanges` event, so the timeline reads like the real story.
- **Covered requests move with it.** Their stage mirrors the procurement's (ORDER_PLACED / BUYER_FOUND / ON_DELIVERY / IN_STORE, mapped). Their raisers are told at each move. Lines dropped or reduced are named to the raiser.
- **ARRIVED** asks for the counts that came per line, defaulting to the current quantities. Property Admin is notified.

**Arrivals:**
- `ImportsPanel.tsx` and `lib/server/resources/imports.ts` record from a procurement. The lines are pre-filled with the arrived counts and linked to the procurement and purchase request lines. Property Admin confirms or corrects, then the store keeper loads.
- `closeIfFullyReceived` closes the requests once their lines are covered. A procurement closes when all its lines are loaded.
- Standalone EGP records without a procurement stay possible.

**Existing data:** the migration's data step wraps each request in ORDER_PLACED…IN_STORE in its own procurement at the matching stage. `advanceStage` and its route are retired.

## Phase R5: Distribute from the store

**New Purchasing → Distribute tab** (store keepers; Property Admin reads), `components/resources/DistributePage.tsx`:
- **From a request being fulfilled.** Choose a closed or arriving purchase request. Each line answers needs, and each need names its lab (`NeedLine.labItemId`). So the send is pre-filled: "13 chairs → Software Laboratory B510-R8". Stock is matched from the keeper's store by category.
- **Manual.** Pick items or quantities from the store, then a destination lab, place or custodian.
- **Review.** Shows one transfer per destination lab, with renaming (the existing `handoverNaming`).

**Server:**
- STORE_OUT's chain becomes `PROP → TARGET_CUSTODIAN` receipt (`movementChain`). The receiving head gets a notice, not a step.
- Sends start through the existing `requestTransfer` path, batched (`POST /api/resources/distributions`, one request per destination, in one transaction).
- Needs answered by a delivered send are marked fulfilled.
- Distribution sends count in R3's "following" until the custodian confirms receipt.

## Phase R6: Calibration

**Data** (migration):
- `ResourceCategory.calibrationCycleMonths Int?` ("Needs calibration every N months"; null means no calibration).
- `Item.lastCalibratedOn Date?` and `Item.calibrationCycleMonths Int?` (per-item override).

**Pure `lib/domain/calibration.ts`:**
- `calibrationStatus(item, category, today)` returns OK, Due soon (≤ 30 days), Overdue, Never calibrated, or Not applicable, plus the next due date.

**UI and filters:**
- Category editor, More options: "Needs calibration every ___ months".
- Inspector: "Last calibrated" (date) and "Cycle", plus a computed status chip and the next due date. Bulk edit can set "Last calibrated".
- Filter engine (`lib/domain/filters.ts` `buildFilterFields`): a synthetic enum field **Calibration** with those statuses, and **Calibration due** as a date. It's usable in the filter bar, the dashboard charts and as a table column, so you can sort and filter devices due.
- Server-side item queries use the same function.

**Home and data:**
- Home's "Due soon" uses calibration status, not the free date detail.
- Catalogue (`prisma/catalogue-data.ts`): the analytical and chemical instruments and the mechanical and testing machines get cycles (12 months by default).
- A one-off script, run on `lrms_v2`, sets the cycles and moves existing "Calibration due" values to `lastCalibratedOn` = due − cycle where present. The old detail is removed from those categories through the category-migration path, so nothing is lost silently.

## Phase R7: Outside requests: build a lab, fill it by holds

1. **Requester builds the setup** (`app/portal/request/page.tsx`, `lib/shared/external.ts`):
   - The public catalogue lists place categories (Lab, Workshop, Studio) and the things in them.
   - "Add a lab setup": the kind of place, how many, and per place what it must have ("25 × Workstation, 1 × Projector, 1 × Whiteboard"). Counts come from the category's "Comes with" template as a starting point.
   - Stored as `ExternalRequest.setups` JSON next to the windows. Sample analysis stays as is.
   - The page shows the totals: "2 labs, 50 workstations, 2 projectors per session".
2. **Head picks the places.** On the department's part, the head opens "Book places for this request". This is the register's place list for the department (and any department, for loans), with working counts per needed category. The head picks labs x, y, z per window, and each pick creates a hold request (`Reservation` state REQUESTED, `externalRequestId`) to that place's custodian. This replaces typing tasks.
3. **Custodian answers each hold.** "Hold it" moves REQUESTED → HELD. The button then reads **Held** and is disabled.
   - "Can't hold it" requires a reason, and the head is told.
   - "Short of N? Borrow first": a shortcut to "Request to my lab" (a LOAN) from another department's place, pre-filled with the missing category and count. The hold stays REQUESTED, marked "waiting for a loan". Once the items are in the lab, they confirm the hold.
   - `placeHold` refuses holding the same place and window twice.
4. **Coverage meter.** Pure `lib/domain/external-coverage.ts` computes, per window, the places held against those required and the items held (working, in held places) against those required. It's shown to the head ("1 of 2 labs, 28 of 50 workstations"), the dean and the AVP. The head's "Send to the dean" is enabled when coverage is complete, or with a stated reason.
5. **Contacts come from the bookings.** `SubmitDepartmentInput.contacts` is replaced by the custodians whose holds are HELD. Name, role and email come from the account, the phone from the profile (asked for if missing, with a clear message). The head may untick one but can't type strangers.
6. **Errors on this path** use the R1 readable messages.

The existing `ExternalCustodianTask` rows stay readable for EXT-2026-001. New requests use hold requests.

## Order and size

R1 → R2 → R3 → R6 → R4 → R5 → R7. R3 is built after R2 because the role gates change what counts. R4 must come before R5, since distribution pre-fills from procurement. R7 is last and largest.

Each phase: migration (if any), service plus specs, UI, guide chapter text (`docs/user-guide/*`, `npm run help:build`), and a PROGRESS.md timeline entry. Screenshots are retaken once at the end.

## Verification

- Each phase: `npx tsc --noEmit`, `npm test` (with new specs), and `npm run build`.
- New specs:
  - `calibration.spec`, `external-coverage.spec` and `nextStepLabel`;
  - DB-backed specs for procurement (combine, standalone, line edits, arrival → import pre-fill, mirror stages), distribution (PA → receipt), store changes decided by PA, borrower return, Property Admin custody changes, ADAA/PA people reach, booking gates, and readable validation messages.
- e2e: update `e2e/validate-approval-lines.ts` (procurement verb, STORE_OUT chain, store changes, return) and the `e2e/suites` campaign where behaviour changed on purpose. Run both on the clone with the mail sink (:3100).
- Browser:
  - A dev server is already running on :3000 (yours). For mutations use the `e2e-build`/`e2e` clone with mint-one sessions, or ask before acting on :3000.
  - Walk: category header; badges as head and custodian (send a need, watch the following chip persist until CLOSED); procurement combining two requests through to Arrived, then PA's pre-filled import, then the keeper loads and distributes, then the custodian receives; Ali returning the ChemE loan himself; a store keeper's Mine; calibration filter; a portal lab setup filled by two custodians' holds, with the Held button, contacts auto-listed and the payment link; 375px and dark mode.

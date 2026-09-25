# LRMS manual end-to-end verification

Prepared 21 September 2026 from the latest PROGRESS.md entries, current screens, and E2E suites. Older sections of PROGRESS.md and the September 13 walkthrough describe superseded behavior, especially borrowing and returns.

## Running environment

- App and API: http://localhost:3100/login
- Public portal: http://localhost:3100/portal
- PostgreSQL: localhost:5432, existing `lrms_v2_e2e` database. All 22 migrations applied.
- Local email capture: 127.0.0.1:2525. Messages are saved under `e2e/mail/` as `.eml` files; `index.jsonl` lists recipients and subjects. This is a file-based inbox, not a web inbox. Open the newest relevant email to retrieve reset or tracking links. Invitations also expose a copyable link in the app.
- Payments use the fake verifier. No real payment is required.
- The existing test database was preserved: 1,241 resources, 48 categories, 52 approval policies, and no saved access views at inspection time. Prior campaign records remain.
- Background hold expiry is not scheduled by starting the development server. Scheduled cron execution needs a separate check; do not assume that waiting alone exercises it locally.

Use `MANUAL-0921` in names and notes so your work is easy to find. Refresh after important transitions. Use separate browser profiles/private windows for different actors, or explicitly log out before switching. Ordinary tabs share the login cookie.

## Accounts

All accounts below have verified password **astu1234**. Their role and active status were checked without changing them.

| Actor | Email |
|---|---|
| Administrator | admin@astu.edu.et |
| SE department head | head.se@astu.edu.et |
| SE custodian | custodian.se@astu.edu.et |
| Chemical Engineering head | head.chem@astu.edu.et |
| Chemical Engineering custodian | custodian.chem@astu.edu.et |
| CoEEC dean | dean.coeec@e2e.test |
| CoMCME dean | dean.comcme@e2e.test |
| University / AVP post holder | avp@e2e.test |
| Procurement officer | procurement@e2e.test |
| Store keeper | storekeeper@e2e.test |
| SE staff | staff.se@e2e.test |
| Chemical Engineering staff | staff.chem@e2e.test |
| Property administrator | propadmin@e2e.test |
| Student | student@e2e.test |
| Disabled account (login must fail) | disabled@e2e.test |

Use the actual post holders for approval steps. An administrator is not automatically a substitute for every workflow decision.

## 1. Login, profile, and onboarding

- [ ] Sign in as admin. Refresh: the session survives. Log out: protected pages require login.
- [ ] Enter a wrong password once; confirm a useful error. The disabled account cannot log in.
- [ ] In Profile & password, change theme, text size, and typeface. Navigate and refresh to check persistence.
- [ ] In People & roles, invite a disposable staff account into SE. Copy its invite link and accept it in a private window. Confirm the new account has its intended role and department.
- [ ] Resend another invitation: only the newest invitation should work. Deactivate that invitee: its invitation must not reactivate it.
- [ ] Use the disposable active account to test forgot/reset password through the captured email, then change password in Profile. Old credentials should stop working.

## 2. Organization and personnel

- [ ] As admin, open Org structure. Create a clearly named test node at a valid level; inspect, rename, and reparent it. Refresh to confirm the diagram persists.
- [ ] Assign an occupant, then vacate the post. Check confirmation dialogs and assignment email capture. Vacating/deactivating the node should not disable the person's account.
- [ ] Try an invalid parent/level arrangement and a duplicate active name; expect validation, not a broken tree.
- [ ] As SE head, invite and manage disposable staff within SE. Chemical Engineering personnel must not become manageable.
- [ ] As admin, test role changes, home-department changes, deactivation, and reactivation on a disposable user. Re-login to check the resulting access.
- [ ] Do not vacate the main workflow posts while running later scenarios: vacancy intentionally freezes approvals.

## 3. Register, resource editing, and categories

- [ ] As SE custodian, create `MANUAL-0921 Robotics Lab` under SE, with yourself as custodian. Add a few Computers and Chairs inside it. Template children should appear where configured.
- [ ] Exercise hierarchy expansion, rollup, search, sorting, filters, and combined AND/OR conditions. Check that clearing filters restores the expected rows.
- [ ] Inspect a resource. Rename it; edit a category field and a custom property; upload a photo. Refresh and reopen it to confirm persistence.
- [ ] Select several test resources and make a bulk edit. Move one within your own lab. Confirm nested parts remain attached to their parent.
- [ ] Change a critical component to broken and inspect the parent status. The result must follow the category's impairment rule; restore it afterwards.
- [ ] Open the same item in two tabs. Save one edit, then save a conflicting stale edit in the other: the app should reject stale data rather than silently overwrite.
- [ ] Delete one disposable resource. It should disappear from normal results and retain its audit history; do not expect a restore button unless the UI provides one.
- [ ] As admin or property admin, create a test category/group. Exercise typed fields, required fields, placement, counting mode, templates, impairment, booking mode, and public listing. Review the impact preview before consequential saves.
- [ ] Omit a required field, attempt invalid placement, and try deleting an in-use category. Expect clear validation. A bulk category must not become bookable.

## 4. Scope, access views, and dashboards

- [ ] Compare the register/dashboard as admin, SE head, SE custodian, and Chemical Engineering staff. Their visible resources and totals should follow their access.
- [ ] As a custodian, open University resources. Find another department's resources: browsing them must not grant direct edit authority.
- [ ] As student, confirm the staff register/dashboard are unavailable, including when entering their URLs directly.
- [ ] As admin/property admin, create a narrowly targeted test Access view. Test its audience, scope, and read-only behavior with the targeted account, then remove it. The clone initially has no saved views, so an empty list is expected.
- [ ] Check cost visibility and read-only context containers with restricted accounts. A context container must not expose unrelated resources through its totals.

## 5. Ideal targets and draft approvals

- [ ] With SE draft mode initially OFF, use the new lab's Manage draft flow to submit ideal targets, e.g. 6 Computers and 8 Chairs. As SE head, approve the ideal commit. Ideal planning should work without enabling current-resource draft mode.
- [ ] As admin, turn SE Resource drafts ON in Org structure.
- [ ] As SE custodian, stage current-resource additions and a status edit in the test lab. Submit the commit. Live inventory must remain unchanged while approval is pending.
- [ ] As SE head, reject with a reason. The custodian should see the reason and editable/open draft changes. Correct and resubmit; approve as head.
- [ ] Confirm all approved changes appear together, with the custodian credited in the audit history. Compare ideal vs actual, including template children in category totals.
- [ ] Direct current-resource corrections should be blocked for the custodian while draft mode applies. Turn draft mode OFF after resolving all test commits, before the next scenarios.

## 6. Borrow, reject, return, and hand over

- [ ] As Chemical Engineering custodian, find an SE test item in University resources and request it into a lab you hold. Read the approval-chain preview.
- [ ] Follow the named actors in Approvals: normally lender custodian, owning SE head, receiving Chemical Engineering head, then receiving confirmation. Self-satisfied steps may be skipped.
- [ ] First reject one request with a reason; verify the resource did not move. Repeat and approve every step. It must stay put until final receipt.
- [ ] After a borrow, verify location/current unit changed to Chemical Engineering, while owner and custodian remain with SE. The host must not gain authority to rename, re-own, or take custody of it directly.
- [ ] From the host's inspector, use **Return to owner…** and follow the displayed chain. Confirm the final location/current unit is back with the owner and the nested tree remains intact.
- [ ] Test a store handover separately: store keeper selects stock, chooses the SE lab and custodian, receiving head approves, and SE custodian accepts. Here ownership and custody should change along with location.
- [ ] While a transfer is pending, try editing its item. Conflicting edits should be blocked. Cancellation/rejection must leave a readable history.

## 7. Need to purchase to stock to lab

- [ ] As SE staff/custodian, raise a need in Purchasing. As SE head, review it and compute purchasables from lab ideal/current gaps. Check the optional inclusion of broken units.
- [ ] Compile and submit a purchase request with a small test quantity and justification. Save its reference.
- [ ] Follow the displayed chain: normally CoEEC dean → University AVP → Procurement, with the raising head's step already satisfied.
- [ ] Send it back once with a reason. As head, revise and resubmit; the relevant approval chain must restart and preserve its history. Use a separate request for final rejection/cancellation tests.
- [ ] Approve the main request, then as procurement advance the purchasing stages to In store, recording notes.
- [ ] As store keeper, receive part of a line, then the remainder. Verify received counts and that over-receipt/wrong-category intake is rejected. Fully received requests should close.
- [ ] Find the newly registered stock in the store. Hand it to the test lab through the receiving-head/custodian chain. Recheck the lab's actual counts and remaining purchase gap.
- [ ] As Chemical Engineering staff/head, confirm the SE request's restricted details are not exposed. Check cost visibility separately from basic tracking visibility.

## 8. Scheduling

- [ ] Confirm the test room's category is Bookable room and test machines are Bookable equipment; use working resources.
- [ ] As SE staff, Schedule → Book: request a future slot, e.g. next week's 09:00–10:00. It should be requested/pending until the room's custodian approves it.
- [ ] As that custodian, inspect My labs, approve the request, and verify it in the calendar and requester's My bookings. Test rejection on a separate request.
- [ ] Book directly as the custodian in your own room; check automatic confirmation where the preview says it applies.
- [ ] Try a conflicting room/machine booking; expect refusal. Try a nonoverlapping machine or back-to-back slot; expect availability where appropriate.
- [ ] Create a short weekly class series, cancel one occurrence, then restore it. Other occurrences should remain unchanged.
- [ ] Verify Addis Ababa times survive refresh without a three-hour shift. Past/invalid times and broken resources must be refused.
- [ ] Cancel a future test booking and check its released slot. Do not expect a department head to approve bookings: this workflow intentionally belongs to the room custodian.

## 9. External portal through payment and confirmed booking

- [ ] Signed out, open /portal. Browse public-listed categories; internal locations, custodians, and item details must remain private.
- [ ] Submit a request for a future date comfortably beyond the form's minimum lead time. Include contact details, needs, and a real small PDF letter. Save the tracking link from the response/email.
- [ ] As AVP, External requests → open the request and letter → Forward to SE.
- [ ] As SE custodian, Hold a slot on the requested date in your test room. Check that the slot blocks competing bookings.
- [ ] As SE head, accept the assignment with a pricing-sheet link and an ETB amount. As AVP, send a quote with a future deadline. Retrieve the newest tracking link from the captured email: sending a quote rotates it.
- [ ] On tracking, test a wrong receiver using `FAKE-1921-WRONG`; it must not count. For a quote of ETB 1,921, use `FAKE-1921` to test successful payment. Choose an unused amount/reference if that one has already been claimed by another request. CBE may ask for an account suffix; telebirr has no extra suffix field.
- [ ] Confirm accepted payment reaches Scheduled and held slots become confirmed calendar bookings. Reusing that payment reference for another request must fail.
- [ ] On a separate request, use `FAKE-DOWN` for an outage, submit for manual review, then accept/reject as AVP. A department head must not gain payment-review authority.
- [ ] Also test split payments, unpaid cancellation, and department refusal on separate requests. Accepted money must not silently disappear through self-cancellation.

## 10. Audit and close-out

- [ ] In Change log and each item's history, find your name prefix, actions, actors, times, and notes. Confirm rejected/pending changes did not appear as applied inventory edits.
- [ ] Refresh all affected screens and compare inventory, ideal/current, purchase receipt totals, transfer location, and calendars.
- [ ] Record failures as: actor, page, resource/request reference, exact steps, expected result, actual result, and screenshot if useful.
- [ ] Resolve your pending requests; restore settings you changed and remove your test access view. Keep the test records if needed to reproduce failures.

## Evidence and limits

This session verified database migration status, the listed passwords, HTTP login, seven authenticated data endpoints, and the main page responses. It did not perform your manual acceptance scenarios or submit workflow mutations.

The latest project notes report 480 passing tests and 189/194 campaign cases passing after the September 20 fixes. Those are historical results, not a fresh test run today. Remaining campaign cases are described there as design decisions, a deferred booking-breakage notification, and fixture artifacts. Booking-breakage notification and local cron execution should not be marked passed by this walkthrough without a separate check.

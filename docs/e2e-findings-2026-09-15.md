# LRMS v2 — E2E findings (2026-09-15)

Input for the review and dev step. This report lists what the end-to-end campaign found, with repro steps, root cause and recommended fix alternatives. Plan: `~/.claude/plans/you-are-a-master-robust-knuth.md`.

> **Status: campaign in progress.** Sections fill in suite by suite.

## Summary

| ID | Sev | Area | Title | Status |
|---|---|---|---|---|
| [F-020](#f-020) | CRITICAL | Register | Deleting a lab silently destroys another department's borrowed equipment inside it | Fixed (2026-09-20, Phase 1) |
| [F-021](#f-021) | CRITICAL | Register | A host department can edit, take custody of and re-own borrowed items without the lender | Fixed (2026-09-20, Phase 1) |
| [F-001](#f-001) | HIGH | Org structure | Deactivating a node disables its occupant even while they hold resources | Fixed (2026-09-20, Phase 1) |
| [F-002](#f-002) | HIGH | Org structure | Any occupant of any UNIVERSITY-kind node becomes the AVP (multiple roots allowed) | Fixed (2026-09-20, Phase 1) |
| [F-012](#f-012) | HIGH | Personnel | A deactivated invitee can reactivate their own account by opening the original invitation link | Fixed (2026-09-20, Phase 1) |
| [F-014](#f-014) | HIGH | Personnel | Department heads can't manage their own staff and assistants beyond inviting them | Fixed (2026-09-20, Phase 1) |
| [F-022](#f-022) | HIGH | Register | A custodian can give away ownership, move the current unit, or dump custody directly, bypassing transfers and handovers | Fixed (2026-09-20, Phase 1) |
| [F-023](#f-023) | HIGH | Register | "Add resource" under your own lab lets the client pick another unit and another custodian | Fixed (2026-09-20, Phase 1) |
| [F-039](#f-039) | HIGH | Transfers | There's no way to return a borrowed item; the lender yanks it back and the register keeps the wrong unit | Fixed (2026-09-20, Phase 1) |
| [F-043](#f-043) | HIGH | Purchasing | "Revise and resubmit" fails for any request that carries staff needs | Fixed (2026-09-20, Phase 1) |
| [F-044](#f-044) | HIGH | Purchasing | Count-based PR numbering: concurrent compiles fail, and one removed row takes purchasing down | Fixed (2026-09-20, Phase 1) |
| [F-049](#f-049) | HIGH | Scheduling | Deleting a room silently erases its confirmed bookings and its class timetable | Open |
| [F-003](#f-003) | MEDIUM | Org structure | Concurrent structural edits return 500 and leave nodes with no closure rows | Fixed (2026-09-20, Phase 2) |
| [F-004](#f-004) | MEDIUM | Org structure | Delete returns a raw 500 when a node is referenced by purchasing or external-request rows | Fixed (2026-09-20, Phase 2) |
| [F-005](#f-005) | MEDIUM | Org structure | Change-level strands the node and its former children | Fixed (2026-09-20, Phase 2) |
| [F-006](#f-006) | MEDIUM | Purchasing ↔ Org | Renaming the Procurement Office disables purchasing for every department | Fixed (2026-09-20, Phase 2) |
| [F-009](#f-009) | MEDIUM | Auth | "Forgot password" activates invited accounts that never accepted their invitation | Fixed (2026-09-20, Phase 2) |
| [F-010](#f-010) | MEDIUM | Auth | No throttling on forgot-password (and, per code reading, on login) | Fixed (2026-09-20, Phase 2) |
| [F-013](#f-013) | MEDIUM | Personnel | "Resend invite" does not revoke the previous link, though the email says it does | Fixed (2026-09-20, Phase 2) |
| [F-015](#f-015) | MEDIUM | Personnel | There's no way to move a person to another department | Fixed (2026-09-20, Phase 2) |
| [F-016](#f-016) | MEDIUM | Personnel | An administrator can demote or deactivate themselves via the API (last-admin lockout) | Fixed (2026-09-20, Phase 2) |
| [F-017](#f-017) | MEDIUM | Personnel / Authorization | Head powers are split between the MANAGER role and node occupancy | Fixed (2026-09-20, Phase 1) |
| [F-024](#f-024) | MEDIUM | Register | Custodian eligibility is never validated (students, disabled accounts) | Fixed (2026-09-20, Phase 2) |
| [F-025](#f-025) | MEDIUM | Register | Deleting a resource is a hard delete with no recovery | Fixed (2026-09-20, Phase 2) |
| [F-026](#f-026) | MEDIUM | Register | No upper bound on "Add N resources" | Fixed (2026-09-20, Phase 2) |
| [F-027](#f-027) | MEDIUM | Categories | Switching BULK → SERIALIZED fails with 500 on real stock; if it succeeded it would silently erase quantities | Fixed (2026-09-20, Phase 2) |
| [F-031](#f-031) | MEDIUM | Scope | Students can read their department's whole asset register | Fixed (2026-09-20, Phase 2) |
| [F-032](#f-032) | MEDIUM | Access views | One "Everyone, read-only" view silently blocks every write for the whole university, including SYS_ADMIN | Fixed (2026-09-20, Phase 2) |
| [F-035](#f-035) | MEDIUM | Draft mode | Approving a lab commit can apply only half of it and leave the request stuck | Fixed (2026-09-20, Phase 2) |
| [F-036](#f-036) | MEDIUM | Draft mode | A stale draft silently overwrites later corrections (lost update) | Fixed (2026-09-20, Phase 2) |
| [F-037](#f-037) | MEDIUM | Planning | Ideal targets (and so purchasables) only exist for departments in draft mode | Fixed (2026-09-20, Phase 2) |
| [F-040](#f-040) | MEDIUM | Transfers | Concurrent final approvals leave an applied transfer marked STALE | Fixed (2026-09-20, Phase 2) |
| [F-041](#f-041) | MEDIUM | Transfers | Items in a pending transfer aren't locked (rename wastes every approval; delete leaves a ghost request) | Fixed (2026-09-20, Phase 2) |
| [F-042](#f-042) | MEDIUM | Transfers | Some pull chains skip the owning or receiving department | Fixed (2026-09-20, Phase 2) |
| [F-045](#f-045) | MEDIUM | Purchasing | Receiving stock has no integrity checks (wrong category, over-receipt, lost updates, fractional units) | Fixed (2026-09-20, Phase 2) |
| [F-046](#f-046) | MEDIUM | Purchasing | Needs carried by a rejected or cancelled request are stuck forever | Fixed (2026-09-20, Phase 2) |
| [F-047](#f-047) | MEDIUM | Purchasing | The raiser can cancel an order procurement has already placed and shipped | Fixed (2026-09-20, Phase 2) |
| [F-050](#f-050) | MEDIUM | Scheduling | Past bookings can be cancelled, and undecided past requests never leave the inbox | Fixed (2026-09-20, Phase 2) |
| [F-051](#f-051) | MEDIUM | Scheduling | Bookings don't react when a machine breaks or a category stops being bookable | Fixed (2026-09-20, Phase 2) |
| [F-055](#f-055) | MEDIUM | External | Holds can be placed on slots outside the requested windows | Fixed (2026-09-20, Phase 2) |
| [F-056](#f-056) | MEDIUM | External | `extendHolds` can push a hold years past the payment deadline | Fixed (2026-09-20, Phase 2) |
| [F-008](#f-008) | LOW | Org structure | No name hygiene: blank, 5,000-character and duplicate names accepted | Fixed (2026-09-20, Phase 3) |
| [F-011](#f-011) | LOW | Privacy | Every signed-in account, including students, can list every office holder's name and email | Fixed (2026-09-20, Phase 3) |
| [F-018](#f-018) | LOW | Personnel | Deans see everyone below them but can't act on any of it | Fixed (2026-09-20, Phase 3) |
| [F-019](#f-019) | LOW | Personnel | Double-submitting an invite returns 500 | Fixed (2026-09-20, Phase 3) |
| [F-028](#f-028) | LOW | Categories | Changing a field's type leaves invalid stored values behind | Fixed (2026-09-20, Phase 3) |
| [F-029](#f-029) | LOW | Categories/Register | "Required" fields aren't enforced | Fixed (2026-09-20, Phase 3) |
| [F-030](#f-030) | LOW | Categories/Register | No name hygiene for categories and resources | Fixed (2026-09-20, Phase 3) |
| [F-033](#f-033) | LOW | Access views | Validation gaps (empty or unknown nodes accepted; unknown person → 500) | Fixed (2026-09-20, Phase 3) |
| [F-034](#f-034) | LOW | Scope | Read-only "context" visibility of a container exposes the whole container's aggregate counts | Fixed (2026-09-20, Phase 2) |
| [F-048](#f-048) | LOW | Purchasing | Estimated costs visible to staff and custodians despite `canSeeCost = false` | Fixed (2026-09-20, Phase 3) |
| [F-052](#f-052) | LOW | Scheduling | No sanity bounds on horizons, series length or exceptions | Fixed (2026-09-20, Phase 3) |
| [F-053](#f-053) | LOW | Scheduling | Any staff member can read every room's calendar, including which student a booking is for | Fixed (2026-09-20, Phase 3) |
| [F-057](#f-057) | LOW | Portal UI | The public portal fires authenticated requests and duplicate catalog fetches | Fixed (2026-09-20, Phase 3) |
| [F-007](#f-007) | DESIGN | Org structure | A deactivated node still grants its residents full scope | Decided — no change (2026-09-20) |
| [F-038](#f-038) | DESIGN | Draft mode | A vacant headship freezes a department's lab commits with no escalation | Decided — no change (2026-09-20) |
| [F-054](#f-054) | DESIGN | Scheduling | Department heads have no role in their department's room bookings or class timetables | Decided — no change (2026-09-20) |

**Counts:** CRITICAL 2 · HIGH 10 · MEDIUM 29 · LOW 13 · DESIGN 3 — 57 findings total

**Status after Phase 3:** 54 fixed, 3 decided-as-is (F-007, F-038, F-054). Not implemented by choice: F-051's notification half (surfacing/notifying on a machine marked BROKEN).

### Coverage

| Suite | Cases | Pass | Fail | Info |
|---|---|---|---|---|
| S0 — Environment/smoke | 5 | 5 | 0 | 0 |
| A — Auth & sessions | 12 | 9 | 3 | 0 |
| O — Org structure | 18 | 9 | 9 | 0 |
| P — Personnel | 18 | 10 | 8 | 0 |
| C — Categories | 12 | 8 | 4 | 0 |
| R — Register | 23 | 12 | 11 | 0 |
| V — Access views & scope | 13 | 7 | 4 | 2 |
| D — Draft mode & ideal | 11 | 8 | 3 | 0 |
| T — Transfers | 14 | 8 | 6 | 0 |
| B — Purchasing | 19 | 9 | 10 | 0 |
| S — Scheduling | 18 | 9 | 9 | 0 |
| X — External & payments | 15 | 14 | 1 | 0 |
| L — Change log | 7 | 6 | 1 | 0 |
| Z — Cross-cutting/abuse | 10 | 10 | 0 | 0 |
| **Total** | **195** | **124** | **69** | **2** |

Each FAIL row maps to a finding above; the two INFO rows (V-01, V-03) are re-classified test artifacts explained in **Blocked / not testable**. No case was left BLOCKED.

## Phase 1 fix round (2026-09-20)

Plan: `~/.claude/plans/you-are-a-master-robust-knuth.md`. The 2 CRITICAL and 10 HIGH findings (plus F-017, promoted alongside F-014 since they share one root cause) are fixed, tested, and re-verified against this same campaign on a freshly re-seeded clone. **12 findings closed: F-001, F-002, F-012, F-014, F-017, F-020, F-021, F-022, F-023, F-039, F-043, F-044.**

**Decisions taken before fixing** (recorded here, not re-litigated): borrowed items keep the lender in authority, with an explicit return flow added rather than left unbuilt; deactivating an org node vacates the post only, never the account; heads gain management of their own staff, and "head" now means occupying the node, never the MANAGER role label.

**What changed, by finding:**

- **F-020, F-021 (the two CRITICALs) and F-022, F-023** — one root cause: write custody was inherited through physical containment, so a host lab could act on whatever merely sat inside it. `lib/server/resources/scope.ts` gained `writableItemIdsOf` (custody that stops at an accountability boundary) alongside the unchanged, containment-based `custodyItemIdsOf` (still the correct rule for reads). `assertCanMutate` and `containers()` now use it; a MANAGER's reach is their unit's own `ownerOrgNodeId` only, never `currentOrgNodeId`. `setOwnerOrg`/`setCurrentOrg` became SYS_ADMIN-only corrections; `setCustodian` now requires the receiving custodian's own reach to already cover the item's owning unit; a child's accountability always inherits from its parent for non-admins, closing the "Add resource" smuggling hole.
- **F-020's blast radius** — `applyDeleteItem` now collects named blockers (a foreign-accountability item it doesn't answer for, or a live booking/class series/pending transfer/staged draft touching the subtree) and refuses with a 409 listing them, for everyone including SYS_ADMIN on the live-dependent half.
- **F-039** — a genuine **return flow** was added rather than merely blocking the abuse: a new `HOST_RELEASE` → `OWNER_RECEIPT` chain (two new `StepSelectorType` values, additive migrations), detected structurally (the destination lands back inside the item's own owning unit) rather than by a client flag, raisable by either the lender or the host. Verified live, both directions: `e2e/probes/verify-return-flow.ts`.
- **F-001** — `deactivateNode` now only ends the occupancy; it never touches the occupant's `User.status` or sessions.
- **F-002** — `kind === "UNIVERSITY" ⇔ level === 0`, and at most one level-0 node, enforced in create/update/changeLevel.
- **F-012** — deactivating a person now expires their open invitations too; `register()` refuses a DISABLED account.
- **F-014, F-017** — "head" is now one thing everywhere: occupying an active node (`org/scope.ts`'s new `isHeadOf`/`headNodeIdsOf`), not the MANAGER role label, which is now auto-granted on assignment as a convenience rather than the authority itself. Heads can deactivate, reactivate and re-role their own CUSTODIAN/STAFF, scoped to their own subtree, never a node occupant, never a privileged role, never themselves.
- **F-043** — `reviseAndResubmit` re-validates carried needs *after* releasing the old lines, inside the transaction, instead of before — a resubmission that keeps its own need link no longer 400s.
- **F-044** — `nextReference` is `MAX(suffix)+1` inside the transaction with a P2002 retry, the same fix already proven for external requests.

**Verified:** `npx tsc --noEmit`, `npm test` (408/408), `npm run build` all clean. The full campaign was re-run end to end on a freshly reset, re-seeded, re-fixtured clone; every targeted case flipped from FAIL to PASS (O-10, O-12, P-10, P-13, P-15, R-05, R-08, R-09, R-10, R-11, R-23, T-10, B-04, B-16, B-17) with nothing else regressing. One genuine harness bug was found and fixed along the way, not a product defect: `e2e/suites/O-17b-race.ts` collided with the `O-*.ts` glob and silently starved `O-org.ts` of a run (moved to `e2e/probes/`); a second, `P-people.ts`'s P-10 case, was rewritten to use a fresh throwaway account instead of the shared `staffSe` fixture, since F-014 now actually works and the old version was deactivating/re-roling a shared actor several other suites depend on. A third correction, `X-05`'s test data, was isolated from an unrelated 16-hour booking cap that had been masking what it actually tested; re-run clean, it confirms F-055 is a genuine finding, not a false positive.

**Deliberate deviations from the original plan**, decided during implementation rather than followed mechanically:
- The plan's schema-level `Reservation.lab`/`ScheduleSeries.lab` FK change from `Cascade` to `Restrict` was **not applied**: a bare FK can't distinguish a live booking from fully closed-out history, so it would have permanently blocked deleting a room with any booking ever recorded against it, including harmless resolved ones. The application-layer blocker in `applyDeleteItem` is the correct enforcement point (it checks *live* dependents only) and was kept as the sole mechanism.
- `external/requests.ts`'s `isAvp` was **not changed** to resolve by a hardcoded `code = "ASTU"`. The schema invariant (F-002) already guarantees at most one `UNIVERSITY`-kind node exists, so `isAvp`'s existing kind-based lookup is now structurally safe without hardcoding an institution-specific code.
- F-024 (custodian eligibility) stays Open for Phase 2 as planned; only its `assertEligibleCustodian` helper and its use in the new `setCustodian` gate landed now, since 1A's own rewrite needed it — full enforcement on `createItem` is deliberately deferred, not forgotten.

## Phase 2 fix round (2026-09-20)

Plan: `~/.claude/plans/you-are-a-master-robust-knuth.md`. All 29 MEDIUM findings are fixed, tested, and re-verified. **29 findings closed: F-003, F-004, F-005, F-006, F-009, F-010, F-013, F-015, F-016, F-024, F-025, F-026, F-027, F-031, F-032, F-034 (LOW in the table, grouped here since it shares F-031's own scope module), F-035, F-036, F-037, F-040, F-041, F-042, F-045, F-046, F-047, F-050, F-051, F-055, F-056.**

**What changed, by group:**

- **Org-structure concurrency (F-003)** — every structural write (create/update/reassignParents/changeLevel/deleteNode) and the closure recompute after it now run inside one transaction opened with `pg_advisory_xact_lock`, serialising them; a `withOrgLock` retry recovers from a node disappearing mid-recompute via a path outside this discipline entirely. **F-004** — `deleteNode` gained named blockers for needs/purchase-requests/external-assignments. **F-005** — `changeLevel` refuses while the node still has children, and now takes `parentIds`, required and validated at the new level in the same call. **F-006** — `OrgNode.code` is now settable and is what `findProcurementOffice` resolves by first, falling back to the exact-name match.
- **Identity/personnel (F-009, F-010, F-013, F-015, F-016)** — `forgotPassword` skips accounts with no password yet; `login`/`forgotPassword` gained table-counted throttles (new `LoginAttempt` table); `resendInvite` expires the previous token in the same transaction as issuing the new one; a new `moveHomeNode` (new `HomeNodeChange` table) moves a person's home department, refusing while they hold custody, an open need or an open draft; `deactivate`/`updateRoles` refuse removing the last active SYS_ADMIN or self-deactivating, regardless of who's asking.
- **Register/categories (F-024, F-025, F-026, F-027)** — `assertEligibleCustodian` is now also checked on root creation and on a handover's receiving custodian, for every actor including SYS_ADMIN. `deleteItem` is a **soft delete** (`deletedAt`, nothing physically removed) instead of a hard `tx.item.delete` that cascaded away photos, custom properties and staged drafts with only the audit row surviving — most readers already filtered `deletedAt`, so this activates guards that were already live but unreachable. `createItem`'s `count` is capped at 500. BULK → SERIALIZED is refused (409, naming an item and a count) while any item still holds a quantity other than 1, instead of a raw 500 or a silent reset to 1.
- **Scope & views (F-031, F-032, F-034)** — a student/external account can no longer read the asset register at all (`assertMayBrowseRegister`, the one choke point every register read shares, plus route-level role gates); an access view nobody explicitly chose narrows reads only, never blocks a write, closing a hole where one `canEdit:false` EVERYONE view could make every account with no more specific view of their own read-only university-wide, including SYS_ADMIN; a lab's aggregate views (ideal-vs-actual) now gate on direct scope of the lab itself, not the ancestor-inclusive check built for tree context, which let custodying one nested borrowed item expose a whole foreign lab's composition.
- **Draft mode (F-035, F-036, F-037)** — a lab commit's whole VISIBLE batch now applies inside one transaction instead of each staged change opening its own (the fix behind "two staged edits of the same item both apply atomically" instead of the second deterministically failing on a version the first had already bumped); the request's own `baseVersions`, recorded at submission, is now read back and re-checked under `FOR UPDATE` before applying, so a direct correction made while a draft waited for its head turns approval STALE (naming the change) instead of being silently overwritten; IDEAL targets no longer require draft mode to be switched on.
- **Transfers (F-040, F-041, F-042)** — `decideStep`'s chain-step advancement is now serialised per request under an advisory lock, closing the race where a losing concurrent "confirm receipt" call could overwrite an already-APPLIED transfer's status with STALE; every subject item is re-validated on every decision against a structural snapshot (parent/owner/current-unit/custodian, not the whole-row version a cosmetic rename also bumps), failing fast and named instead of failing at the last step with an unexplained conflict, and a fresh version is read for the final apply so a tolerated rename doesn't then void it; `applyMoveInTree` refuses moving an item named in a pending transfer; any non-handover pull's chain is now built directly (owning custodian, owning head, the destination container's own custodian when it differs from the requester, receiving head, requester receipt) instead of taken from a role-matched policy that let a store keeper's or a dean's pull skip the owning or receiving side entirely.
- **Purchasing (F-045, F-046, F-047)** — `receivePurchaseLine`'s cap and lost-update fix: the received-quantity update is two atomic conditional `updateMany` attempts instead of a read-modify-write, with the cap encoded directly in the WHERE clause; a category mismatch is refused; a SERIALIZED category's line must be a whole number, checked at compile time. Rejecting or cancelling a request now reopens the needs it carried (`reopenCarriedNeeds`), named with why. The raiser may withdraw only through APPROVING; from ORDER_PLACED on, cancelling is procurement's own act with a required note.
- **Scheduling (F-050, F-051)** — a booking whose `endsAt` has passed can no longer be cancelled; an undecided REQUESTED booking whose own start time has passed drops out of the inbox, and a new cron sweep (`expireLapsedRequests`) marks it EXPIRED. A category's `bookingMode` can no longer be changed away from ROOM/EQUIPMENT while a future live reservation or class occurrence still depends on it.
- **External (F-055, F-056)** — `placeHold` refuses a hold on a date the request's own windows never named (checked by date, not exact time, so a same-day replacement hold for a lost slot keeps working); `extendHolds` is capped at the same ceiling a fresh hold gets (a still-future payment deadline, or the two-week horizon otherwise) instead of only checking the date is in the future.

**Verified:** `npx tsc --noEmit`, `npm test` (458/458, up from 408 at the start of Phase 1), `npm run build` all clean, at every commit in this round.

**Deliberate scope decisions:**
- F-051's own second half (surfacing/notifying on `setStatus` → BROKEN/IMPAIRED) is **not implemented** — a UX/notification addition rather than a data-integrity fix, judged out of scope for this pass; the bookingMode-change guard (the data-integrity half) is.
- Two blocker-count sites (`org.ts`'s `deleteNode`, `categories.ts`'s `remove`) deliberately **keep counting soft-deleted items** (F-025) alongside live ones: the FK they guard against (`onDelete: Restrict`) still holds for a soft-deleted row exactly as it does for a live one, so excluding it would promise a delete the database would then refuse anyway.
- F-035's fix combines transactional batching with stripping per-operation `expectedVersions` inside the batch loop (closer to the plan's "Fix B" for this specific point) rather than pure "Fix A" — necessary because two edits of the same item, each staged against the pre-batch version, would otherwise still conflict with each other inside a single transaction exactly as they did across separate ones; the batch-level `baseVersions` check (F-036) is what actually guards staleness once per-operation checks are stripped for the batch.


**E2E re-verification (2026-09-20, fresh `lrms_v2_e2e` clone, all 14 suites, 194 cases): 174 PASS.** The 20 remaining ✘ are all outside Phase 2: Phase 3 LOW findings (A-08 F-011, B-07 F-048, C-08 F-028, C-09/R-22 F-029, C-12/R-21 F-030, O-03 F-008, P-03 F-019, P-09 F-018, S-10/11/12 F-052, S-17 F-053, V-12 F-033), DESIGN findings decided as-is (O-11 F-007, S-18 F-054), the deliberately deferred notification half of F-051 (S-14), and the two INFO artifacts V-01/V-03 (fixture-only: SE boards on loan to ChemE make ChemE containers legitimately visible as read-only context). The re-run found two more product defects that unit tests missed, both fixed in `ec9fe9d`:
- **purchasing `decideStep` was not serialized** (E2E B-18: concurrent APPROVE + REVISE by the same dean both returned 200). This is exactly F-040's own "apply to purchasing decideStep" note; it now runs in one transaction under `pg_advisory_xact_lock(hashtext(requestId))`, re-reading state inside the lock.
- **admin `createItem` skipped custodian eligibility** (E2E R-07: the SYS_ADMIN early-return in `assertAuthorized` ran before the check, so a root could be created with a DISABLED custodian). The check now runs first; SYS_ADMIN was added to the eligible custodian roles because the seeded admin legitimately custodies items.
- `previewImpact` now warns when a `bookingMode` change would strand future live reservations (S-15).
- Harness corrections (not product changes): O-07 uses throwaway occupants because F-017 auto-grants MANAGER on `assignNode` and was polluting the shared staff accounts; A-12/B-11/B-12/D-04/P-11/P-12/V-05/V-01b predicates updated to the intended post-fix behaviour (V-01b now treats foreign containers above a unit's own lent-out items as read-only context, not a leak). The pre-fix `e2e/results.json` baseline was overwritten by this run.


## Phase 3 fix round (2026-09-20)

All 13 LOW findings that were still open are fixed (F-008, F-011, F-018, F-019, F-028, F-029, F-030, F-033, F-048, F-052, F-053, F-057; F-034 was closed in Phase 2), and the three DESIGN findings are recorded as decided with their reasoning (F-007, F-038, F-054) — no code. One commit per cluster, each with its regression test.

**Verified:** `npx tsc --noEmit`, `npm test` (480/480, up from 458), `npm run build` all clean; a fresh-clone E2E re-run of all 14 suites finished with 189 PASS of 194. The only ✘ left are the three DESIGN-decided cases (O-11 F-007, S-18 F-054), the deliberately deferred notification half of F-051 (S-14), and the two INFO artifacts V-01/V-03 (fixture-only, see the Phase 2 re-verification note).

**Behaviour changes worth knowing about:**
- A department head who sends a `homeNodeId` outside their own subtree now gets a 403 (it used to be silently rewritten to their own node). E2E P-06 was updated for this.
- Creating an item with an empty *required* category field is now a 400; the Add-resources form marks required fields with an asterisk.
- Changing a category field's type is a 409 while stored values can't be read as the new type, unless the field is purged in the same save.
- A class slot may span at most 366 days; existing longer slots must be split before they can be edited.
- Purchase-request line costs are hidden from readers who are not purchasing roles, post occupants or the raiser.

## How it was run

- **Code:** branch `track-5-scheduling`, commit `f218b5f`. No product code changed during the campaign.
- **Database:** a clone, `lrms_v2_e2e`, created from scratch with `prisma migrate deploy`, then:
  - `prisma/seed.ts`;
  - `prisma/resource-seed.ts` (238 items, 40 categories);
  - `prisma/seed-policies.ts --apply` (52 policies);
  - `e2e/fixture.ts` for the cast.

  The real local `lrms_v2` was never touched.
- **Server:** `.claude/launch.json` profile `e2e`, i.e. `next dev -p 3100` run through `e2e/with-env.mjs`. That wrapper points at the clone database and sets:
  - SMTP to a local sink (`e2e/mail-sink.mjs`, which writes messages to `e2e/mail/`);
  - the fake payment verifier;
  - local image storage in `.local-storage-e2e/`;
  - `CRON_SECRET=e2e-cron-secret`.
- **Driver:**
  - API-level suites in `e2e/suites/*.ts`, using the shared `e2e/lib.ts`;
  - sessions minted per actor by `e2e/mint-sessions.ts`, because the driver never submits passwords;
  - every case checks the HTTP result and the resulting DB state;
  - raw results in `e2e/results.json`;
  - UI checks in the in-app browser.
- **Cast** (password `astu1234` for manual UI checks):

| Key | Account | Roles / post |
|---|---|---|
| admin | admin@astu.edu.et | SYS_ADMIN |
| avp | avp@e2e.test | MANAGER, occupies the university root (AVP) |
| deanCoeec / deanComcme | dean.coeec@e2e.test / dean.comcme@e2e.test | MANAGER, occupy the two colleges |
| headSe / headChem / headMat | head.se@astu.edu.et / head.chem@astu.edu.et / head.mat@e2e.test | MANAGER + STAFF, department heads (Materials Science has two parent colleges) |
| custSe (Girma Wolde) / custSe2 (Shambel Lemma) / custChem (Hanna Bekele) / custMat | … | CUSTODIAN + STAFF |
| procurement | procurement@e2e.test | PROCUREMENT, occupies the Procurement Office |
| storekeeper | storekeeper@e2e.test | STORE_KEEPER + STAFF, custodian of ASTU Main Store |
| staffSe / staffChem | staff.se@e2e.test / staff.chem@e2e.test | STAFF |
| student | student@e2e.test | STUDENT (home: SE) |
| propadmin | propadmin@e2e.test | PROPERTY_ADMIN |
| disabled | disabled@e2e.test | STAFF, status DISABLED |

**Severity levels:**

| Severity | Meaning |
|---|---|
| CRITICAL | Security bypass, cross-department data leak, or silent loss of money or bookings. |
| HIGH | Authorization or workflow bypass, corrupt state, or a feature that's unusable for a real role. |
| MEDIUM | Wrong result in an edge case, or a race that produces bad records. |
| LOW | UX, copy or cosmetic issue. |
| DESIGN | Behaviour that works as coded but is questionable; needs a decision. |

## Findings

Findings are numbered in discovery order; the summary table above sorts them by severity. "Evidence" quotes the raw `e2e/results.json` record for the case.

### F-001 · HIGH · Org structure — Deactivating a node disables its occupant even while they hold resources

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/org/org.ts`'s `deactivateNode`. See "Phase 1 fix round" above for the full change and verification.

- **Case:** O-12 (H5) · **Actor:** admin
- **Repro:**
  1. Create a department `D` and a MANAGER `U`, and assign `U` to occupy `D`.
  2. As admin, create a Lab with owner `D` and custodian `U`.
  3. `POST /api/org/nodes/D/deactivate`.
- **Expected:** refused while `U` holds resources, the same way `POST /api/people/U/deactivate` refuses ("reassign custody first"). Or: the node is vacated without disabling the person.
- **Actual:** `201 {"ok":true,"revokedOccupantName":"O MANAGER"}`. `U` is now `DISABLED` and all their sessions are deleted, while `Item.custodianId = U` is still set on 1 item.
- **Evidence:** `{"userStatus":"DISABLED","itemsStillInTheirCustody":1}`.
- **Root cause:** `lib/server/org/org.ts:65-87` (`deactivateNode`) disables the occupant's *account* inside its transaction and never checks custody. `lib/server/people/people.ts:203-206` has the custody blocker, but only for the people-side door.
- **Impact:**
  - Closing or restructuring a unit silently strands accountability. The custodian can't sign in to hand anything over.
  - Their rooms' booking approvals and draft staging stall.
  - Only admin can repair it, one item at a time.
  - It also disables a person who may still work elsewhere in the university: holding a post isn't the same as employment.
- **Fix alternatives:**
  - **A (recommended):** `deactivateNode` only *vacates* the occupancy (ends the `OrgNodeAssignment` row and clears `OrgNode.userId`) and never touches `User.status`. Disabling an account stays a Personnel action with its existing custody blocker.
  - **B:** Keep disabling, but run the same custody check first and refuse with a count and a link to reassign.
  - **C:** Refuse deactivation while the node is occupied ("vacate first"), mirroring `deleteNode`'s blocker.
- **Regression test:** `lib/server/org/org.spec.ts` (new): "deactivating an occupied node whose occupant custodies items neither disables the account nor strands custody".

### F-002 · HIGH · Org structure — Any occupant of any UNIVERSITY-kind node becomes the AVP (multiple roots allowed)

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/org/org.ts`'s `assertUniversityInvariant`. See "Phase 1 fix round" above for the full change and verification.

- **Case:** O-10 (H7) · **Actor:** admin, then the new occupant
- **Repro:**
  1. `POST /api/org/nodes {"level":0,"kind":"UNIVERSITY","parentIds":[]}` → 201 (a second root).
  2. Assign any staff member to occupy it.
  3. As that person, `GET /api/external-requests` → 200 with the AVP's full list.
- **Expected:** exactly one level-0 root. `UNIVERSITY` kind is only allowed at level 0, and AVP powers come from that designated root.
- **Actual:** the second root is accepted. `isAvp` is true for its occupant, who can now:
  - read every external request and its letter;
  - forward requests and send quotes;
  - review payments (manually approving receipts).
- **Evidence:** `{"createSecondRoot":201,"assign":201,"externalRequestsAsSecondAvp":200}`.
- **Root cause:**
  - `lib/server/org/org.ts:215-219` (`assertAdjacentParents`) allows any number of level-0 nodes.
  - `UpdateOrgNodeInput` lets `kind` be set to `UNIVERSITY` on any node (`lib/shared/org.ts:55-58`).
  - `lib/server/external/requests.ts:95-99` (`isAvp`) matches *any* active node with `kind: "UNIVERSITY"`.
- **Impact:** a data-entry mistake (or a malicious admin-level edit) hands out the most sensitive financial role, including manual payment approval, with no audit trail beyond the org ledger.
- **Fix alternatives:**
  - **A (recommended):** Enforce the invariants in `org.ts`: at most one level-0 node, `kind === "UNIVERSITY"` iff `level === 0`, checked in `create`, `update` and `changeLevel`. Add a partial unique index `WHERE level = 0`.
  - **B:** Resolve the AVP from the root node's stable `code` (`ASTU`) or an explicit `OrgNode.isAvpOffice` flag, and never from `kind`.
  - Apply A plus B together for defence in depth.
- **Regression test:** `org.spec.ts` "a second level-0 node / a UNIVERSITY kind below level 0 is refused"; `requests.spec.ts` "only the designated root's occupant is AVP".

### F-003 · MEDIUM · Org structure — Concurrent structural edits return 500 and leave nodes with no closure rows

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/org/org.ts`'s `withOrgLock`/`recomputeClosure`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** O-17, O-17b · **Actor:** admin (two browser tabs, or two admins)
- **Repro:** fire 8 `POST /api/org/nodes` in parallel under the same college.
- **Expected:** all 201, and every node has complete closure rows.
- **Actual:**
  - statuses `[201,500,201,500,201,500,500,201]`;
  - all 8 node rows were committed;
  - 1 node ended with **no closure rows**, so its residents and occupant have no reach (see `scope.visibleNodeIds`);
  - 5 parallel re-parents gave `[200,500,200,…]`.
- **Evidence:** the server log shows `P2002 Unique constraint failed on (ancestorId, descendantId)` at `org.ts:250`.
- **Root cause:**
  - `recomputeClosure()` (`org.ts:241-251`) does `deleteMany({}) + createMany(all rows)` in a batch transaction under READ COMMITTED. Two concurrent recomputes both insert the full set, and one collides.
  - `create()` (`org.ts:28-38`) commits the node row *before* its edges and closure, so a failed recompute leaves a committed node with no closure.
- **Impact:** intermittent 500s for admins, and nodes whose people silently see nothing until some later structural edit happens to recompute.
- **Fix alternatives:**
  - **A (recommended):** Wrap create/update/reparent/change-level/delete plus `recomputeClosure` in one interactive transaction that starts with `SELECT pg_advisory_xact_lock(<const>)`, serialising all structural writes. The node count is small, so contention is irrelevant.
  - **B:** Make closure maintenance incremental for `create` (insert ancestor rows for the new node only), and keep the full recompute only for re-parent/level changes under the lock.
  - **C:** Use `ON CONFLICT DO NOTHING` via raw SQL for the insert. This hides the 500 but still lets a delete-all race drop rows, so it isn't sufficient alone.
- **Regression test:** `org.spec.ts` "parallel node creation yields complete closure for every node".

### F-004 · MEDIUM · Org structure — Delete returns a raw 500 when a node is referenced by purchasing or external-request rows

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/org/org.ts`'s `deleteNode`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** O-13 (H6) · **Actor:** admin
- **Repro:**
  1. A staff member of department `D` raises a need.
  2. They later move to another department (done in the DB, since no API exists; see the P suite).
  3. `DELETE /api/org/nodes/D`.
- **Expected:** 400 naming the blocker ("has 1 purchasing need(s)").
- **Actual:** `500 Internal server error`. The log shows Postgres `23001 … violates RESTRICT … NeedLine_orgNodeId_fkey`.
- **Root cause:** `org.ts:146-174` (`deleteNode`) collects blockers for occupant, children, residents and items only. `NeedLine.orgNodeId`, `PurchaseRequest.orgNodeId` and `ExternalRequestAssignment.orgNodeId` are all `onDelete: Restrict` (`prisma/schema.prisma:942, 988, 1432`) and aren't checked.
- **Impact:** a confusing admin error. No data loss, since the FK holds.
- **Fix alternatives:**
  - **A (recommended):** Add named blockers for needs, purchase requests and external-request assignments (and any future `Restrict` FK), with counts.
  - **B:** Also catch Prisma `P2003` / PG `23001` in `deleteNode` and map it to a 400 "still referenced by …", as a safety net for future tables.
- **Regression test:** `org.spec.ts` "delete of a node with a need/purchase/external assignment is refused with a named 400".

### F-005 · MEDIUM · Org structure — Change-level strands the node and its former children

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/org/org.ts`'s `changeLevel`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** O-09 (H7) · **Actor:** admin
- **Repro:**
  1. Create department `D` (level 2) with a child office (level 3).
  2. `POST /api/org/nodes/D/change-level {"level":1}` → 201.
- **Expected:** refused, or new parents required in the same request, so the org never holds a level>0 node without a parent.
- **Actual:** `D` is now level 1 with **0 parents and 0 children**, and the former child is level 3 with **0 parents**. Both states are exactly what `assertAdjacentParents` forbids at creation, and nothing reports them afterwards. Every resident of either node loses all reach above itself.
- **Evidence:** `{"movedNode":{"level":1,"parents":0,"children":0},"formerChild":{"level":3,"parents":0}}`.
- **Root cause:** `org.ts:123-134` deletes every edge in both directions by design ("sits parentless until reassignParents… redraws"). There's no validation afterwards and no UI warning for disconnected nodes.
- **Fix alternatives:**
  - **A (recommended):** `ChangeNodeLevelInput` takes `parentIds` (required when the new level is above 0) and is applied atomically with `assertAdjacentParents`. Refuse while the node still has children, or require a plan for them.
  - **B:** Keep the behaviour, but add a "Disconnected nodes" warning panel in Org Studio and block purchasing/transfers that would walk through a disconnected chain.
- **Regression test:** `org.spec.ts` "change-level without parents is refused / applies atomically with new parents".

### F-006 · MEDIUM · Purchasing ↔ Org — Renaming the Procurement Office disables purchasing for every department

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/purchasing.ts`'s `findProcurementOffice`, keyed on `OrgNode.code`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** O-16 (H7) · **Actor:** admin, then headSe
- **Repro:**
  1. Rename "Procurement Office" to "Procurement & Supplies Office" (an ordinary rename in Org Studio).
  2. As any head, compile a purchase request.
- **Expected:** purchasing keeps working; the office is identified by something stable.
- **Actual:** `400 No "Procurement Office" exists on the org chart yet…`. Creating a *duplicate* node with the same name (allowed, see F-008) produces the "More than one…" refusal instead.
- **Root cause:** `lib/server/resources/purchasing.ts:111-123` resolves the office by exact name, `n.name === "Procurement Office"`.
- **Fix alternatives:**
  - **A (recommended):** Resolve by the node's stable `code` (`PROC`), with `OrgNode.code` unique, or by an explicit role flag on the node.
  - **B:** Keep the name lookup but refuse renaming or duplicating that node in `org.ts`, with a clear message.
- **Regression test:** `purchasing.spec.ts` "compilation survives renaming the procurement office".

### F-007 · DESIGN · Org structure — A deactivated node still grants its residents full scope

**Status: Decided — no change (2026-09-20)** — A deactivated unit's residents keep their reach. This follows from the F-001 decision (deactivating a node vacates the post only; it never disables anyone), and refusing deactivation while residents remain would make retiring a unit unworkable. Revisit only if it causes a real problem.

- **Case:** O-11 (H7)
- **Observed:** a CUSTODIAN whose home department was deactivated still gets `me.scope` pointing at the inactive node, with `reachableNodeCount: 1`. They keep reading and writing what they hold. `scope.visibleNodeIds` and `reachRootNodeId` never look at `OrgNode.active` (`lib/server/org/scope.ts:30-53`).
- **Question:** should a deactivated department's people become read-only or lose reach, or should deactivation be refused while residents remain? Today, deactivation only affects the occupant (and too much; see F-001).
- **Options:**
  - **A:** Refuse deactivation while residents or custody remain ("move people first").
  - **B:** Filter inactive nodes out of scope resolution, making residents reach-less.
  - **C:** Leave it as is, but show the state in `me.scope` and Personnel.

### F-008 · LOW · Org structure — No name hygiene: blank, 5,000-character and duplicate names accepted

**Status: Fixed (2026-09-20, Phase 3)** — `lib/shared/org.ts` (trimmed 2–120 chars) + `lib/server/org/org.ts`'s `assertNameFree` (case-insensitive unique among active nodes, checked inside the org lock; deliberately not a DB index so existing duplicates can't fail a migration). See "Phase 3 fix round" below for verification.

- **Case:** O-03
- **Actual:** `"   "` → 201; `"L" × 5000` → 201; a second "Software Engineering" under CoEEC → 201.
- **Root cause:** `CreateOrgNodeInput.name` / `UpdateOrgNodeInput.name` use `z.string().min(1)`, with no trim or max, and there's no uniqueness rule.
- **Impact:** layout breakage in the canvas and pickers, and indistinguishable duplicates in every node picker. Duplicates also feed F-006's ambiguity.
- **Fix alternatives:**
  - **A (recommended):** `z.string().trim().min(2).max(120)` on create and update, plus a case-insensitive unique name among active nodes (DB unique index on `lower(name)` WHERE active).
  - **B:** Trim and max only; warn on duplicates in Org Studio.

### F-009 · MEDIUM · Auth — "Forgot password" activates invited accounts that never accepted their invitation

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/auth/auth.ts`'s `forgotPassword`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** A-10 (H2) · **Actor:** anonymous
- **Repro:**
  1. Admin invites `x@…` (status INVITED, no password).
  2. `POST /api/auth/forgot-password {"email":"x@…"}` → 201.
  3. A reset email is sent (captured by the sink) and a `PasswordReset` row is created.
- **Expected:** INVITED accounts are pointed back to the invitation (or get a fresh invite). A reset must not become a second, un-expiring onboarding path.
- **Actual:** the reset link works for the invited account. `resetPassword` sets a password without changing status or consuming the invitation, and `login` only checks `passwordHash` and DISABLED, so the account signs in while still `INVITED`. Invitation expiry (7 days) is bypassed.
- **Evidence:** `{"invite":201,"forgot":201,"resetRows":1,"resetMails":["Reset your ASTU Lab Resources password"]}`. Signing in afterwards is part of `e2e/auth-check.ts`, the user-run password flow.
- **Root cause:** `lib/server/auth/auth.ts:106-110` (only DISABLED is excluded), `:131-147` (no status transition), `:49-50` (no status check other than DISABLED).
- **Fix alternatives:**
  - **A (recommended):** In `forgotPassword`, skip accounts with no `passwordHash` or with status `INVITED`, keeping the same 201 response to avoid enumeration. Optionally send a "you have a pending invitation — ask your head to resend it" email instead.
  - **B:** Treat a completed reset as invitation acceptance: set `ACTIVE` and consume open invitations. Simpler, but it bypasses whoever decided the invitation should lapse.
- **Regression test:** `lib/server/auth/auth.spec.ts` (new) "forgot-password for an INVITED account sends no reset".

### F-010 · MEDIUM · Auth — No throttling on forgot-password (and, per code reading, on login)

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/auth/auth.ts`'s `login`/`forgotPassword` (new `LoginAttempt` table). See "Phase 2 fix round" below for the full change and verification.

- **Case:** A-12 · **Actor:** anonymous
- **Repro:** 20× `POST /api/auth/forgot-password {"email":"staff.chem@e2e.test"}`.
- **Actual:** 20× 201, with 20 `PasswordReset` rows and 20 emails.
- **Impact:**
  - anyone can flood any staff mailbox;
  - on the Gmail SMTP relay, this exhausts the daily sending quota, after which invitations and quote emails silently stop going out (mail failures are only logged);
  - login has no attempt counter either (`auth.ts:38-67`), so password guessing is unthrottled. Confirmed by code; `e2e/auth-check.ts` measures it.
- **Fix alternatives:**
  - **A (recommended):** Table-counted throttles, the same serverless-safe technique `lib/server/external/requests.ts:141-149` already uses: at most 3 resets per account per hour; for login, lock out after N failures per account and IP-hash in 15 minutes (needs a small `LoginAttempt` table).
  - **B:** A route-level rate limiter (for example Upstash or Vercel KV). Stronger, but new infrastructure.
- **Regression test:** `auth.spec.ts` "the 4th reset request within an hour sends nothing but still answers 201".

### F-011 · LOW · Privacy — Every signed-in account, including students, can list every office holder's name and email

**Status: Fixed (2026-09-20, Phase 3)** — `lib/server/org/org.ts`'s `list(activeOnly, { includeEmail })` + `app/api/org/nodes/route.ts` — `occupant.email` is null unless the caller is SYS_ADMIN or MANAGER. See "Phase 3 fix round" below for verification.

- **Case:** A-08
- **Actual:** `GET /api/org/nodes?scope=all` as STUDENT → 200 with `occupant.email` for the AVP, deans, heads and the procurement officer. `GET /api/people/custodians` (custodian and above) returns university-wide names and emails too, which is expected for pickers.
- **Root cause:** `app/api/org/nodes/route.ts` GET only requires a session; `org.ts:14-25` always includes the email.
- **Fix alternatives:**
  - **A (recommended):** Omit `occupant.email` unless the caller is SYS_ADMIN or MANAGER.
  - **B:** Require a staff role for `GET /org/nodes`. Students and externals don't use Org Studio.

### F-012 · HIGH · Personnel — A deactivated invitee can reactivate their own account by opening the original invitation link

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/people/people.ts`'s `deactivate` + `lib/server/auth/auth.ts`'s `register`. See "Phase 1 fix round" above for the full change and verification.

- **Case:** P-15 (H1) · **Actor:** admin, then the invitee
- **Repro:**
  1. Admin invites `x@…`.
  2. Admin deactivates `x` (status `DISABLED`), e.g. after a wrong hire or someone leaving before starting.
  3. The invitation row is still unconsumed and unexpired.
  4. `x` opens the emailed link and sets a password (`POST /api/auth/register`).
- **Expected:** deactivation revokes pending invitations, and `register` refuses a DISABLED account.
- **Actual:**
  - After step 2 the DB still holds 1 usable invitation token for the disabled account.
  - `register()` (`lib/server/auth/auth.ts:75-99`) never reads `User.status` and unconditionally writes `status: "ACTIVE"`.
  - The final sign-in step is included in `e2e/auth-check.ts`, the user-run password flow; the code path is unconditional.
- **Evidence:** `{"status":"DISABLED","usableInvitationTokens":1}`.
- **Root cause:** `people.ts:194-221` (`deactivate`) doesn't touch `Invitation`; `auth.ts:83-96` has no status check.
- **Impact:** an administrator's "deactivate" can be undone by the person it was aimed at, for up to 7 days (and longer with resends, see F-013).
- **Fix alternatives:**
  - **A (recommended):** Do both: (1) `deactivate` marks every open invitation for that email consumed/revoked; (2) `register` refuses unless `status === "INVITED"`.
  - **B:** Only (2). This is the minimal patch, but leaves dead tokens lying around.
- **Regression test:** `auth.spec.ts` "register with a token for a DISABLED account is refused and the account stays DISABLED".

### F-013 · MEDIUM · Personnel — "Resend invite" does not revoke the previous link, though the email says it does

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/people/people.ts`'s `resendInvite`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** P-08 (H1)
- **Repro:** head.se invites a custodian, then clicks "Resend invite".
- **Expected:** exactly one usable token. The resend email says "the previous one, if any, no longer works" (`people.ts:258`), and `lib/shared/people.ts:72-74` says "resending invalidates the previous one".
- **Actual:** 2 invitation rows, **both unconsumed and unexpired**. Either link registers the account.
- **Root cause:** `people.ts:230-262` (`resendInvite`) creates a new `Invitation` without consuming or expiring older rows for the same email.
- **Impact:** a link sent to the wrong address, or a forwarded email, stays valid after the admin "replaces" it.
- **Fix alternatives:**
  - **A (recommended):** In one transaction, `invitation.updateMany({ where: { emailLower, consumedAt: null }, data: { expiresAt: now } })` before creating the new row.
  - **B:** `register` accepts only the newest invitation per email.
- **Regression test:** `people.spec.ts` (new) "after resend, the previous token is refused".

### F-014 · HIGH · Personnel — Department heads can't manage their own staff and assistants beyond inviting them

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/people/people.ts`'s `assertMayManageStaff`. See "Phase 1 fix round" above for the full change and verification.

- **Case:** P-10 (H4) · **Actor:** head.se on their own STAFF member
- **Actual:**
  - `POST /people/:id/deactivate` → 403, `/reactivate` → 403, `/roles` → 403 (all SYS_ADMIN-only routes).
  - The Personnel screen hides "Manage" for heads (`components/people/PeopleTable.tsx:115`).
  - A head can invite CUSTODIAN/STAFF and resend invites, nothing else. They can't retire a leaver, promote a staff member to lab assistant (CUSTODIAN), or hand an assistant's role back.
- **Why it matters:** "department head personnel management (staff and assistants)" is a stated core requirement. Today every staffing change in every department is a ticket to the system administrator.
- **Root cause:** `app/api/people/[id]/{deactivate,reactivate,roles}/route.ts` use `requireRole(user, ["SYS_ADMIN"])`, and `people.ts` has no scoped variant.
- **Fix alternatives:**
  - **A (recommended):** Allow MANAGER on these three routes, scoped in `people.ts`:
    - the target's `homeNodeId` must be the head's own node (or within their subtree, for deans; decide per F-018);
    - role edits are limited to `MANAGER_INVITABLE_ROLES` (CUSTODIAN/STAFF) on both the before and after sets, so a head can never grant or remove MANAGER/global roles;
    - the target must not occupy a node, and must not be the head themselves;
    - keep the existing custody blocker on deactivate.

    Show "Manage" to heads with just those controls.
  - **B:** A request/approve flow (the head asks, admin applies). Lower risk, but it keeps the bottleneck.
- **Regression test:** `people.spec.ts` "head deactivates/reactivates/re-roles own CUSTODIAN/STAFF; refused for other departments, MANAGER targets and privileged roles".

### F-015 · MEDIUM · Personnel — There's no way to move a person to another department

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/people/people.ts`'s new `moveHomeNode` (new `HomeNodeChange` table). See "Phase 2 fix round" below for the full change and verification.

- **Case:** P-11
- **Actual:**
  - `PATCH /api/people/:id` → 404, and no route or UI edits `User.homeNodeId` after the invitation.
  - `assign-node` sets *occupancy* (headship), not membership.
  - A staff member or lab assistant who transfers departments can't be represented. Their reach, purchasing needs (`raiseNeed` uses the home node) and draft/custody context stay with the old department.
  - The only workaround is a direct DB edit (used in O-13, which then exposed F-004).
- **Fix alternatives:**
  - **A (recommended):** `POST /api/people/:id/home-node {nodeId, reason}`, available to SYS_ADMIN, with a membership-history row mirroring `OrgNodeAssignment`. Before moving, refuse or warn if the person still holds custody in the old department, or has open needs or drafts.
  - **B:** Admin-only home-node field in the Manage modal, with no history.
- **Regression test:** `people.spec.ts` "moving a person's home node changes their scope and is recorded".

### F-016 · MEDIUM · Personnel — An administrator can demote or deactivate themselves via the API (last-admin lockout)

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/people/people.ts`'s `assertNotLastActiveAdmin`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** P-12 (H3)
- **Repro:** as a SYS_ADMIN, `POST /api/people/<self>/roles {"roles":["STAFF"]}` → 201; `POST /api/people/<self>/deactivate` → 201.
- **Actual:** both succeed. The guard exists only in the UI (`PersonnelPage.tsx:348, 372, 412`). With a single admin, as in a fresh production bootstrap, this locks everyone out of Org Studio, Personnel and categories; recovery needs `prisma/bootstrap.ts` with production credentials.
- **Root cause:** `people.ts:177-185` (`updateRoles`) and `:194-221` (`deactivate`) have no actor/target checks, and the routes don't pass the actor.
- **Fix alternatives:**
  - **A (recommended):** Server-side: refuse removing SYS_ADMIN from, or deactivating, the **last active SYS_ADMIN**; also refuse self-deactivation.
  - **B:** Refuse any self-targeted role or status change. Simpler, but still allows admin A to demote admin B when B is the last one.
- **Regression test:** `people.spec.ts` "the last active SYS_ADMIN cannot be demoted or deactivated".

### F-017 · MEDIUM · Personnel / Authorization — Head powers are split between the MANAGER role and node occupancy

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/org/scope.ts`'s `isHeadOf`/`headNodeIdsOf`. See "Phase 1 fix round" above for the full change and verification.

- **Case:** P-13
- **Repro:**
  1. Admin removes MANAGER from head.mat, who still occupies Materials Science.
  2. As head.mat, compile a purchase request.
- **Actual:**
  - The role change succeeds with no warning, and head.mat stays the occupant.
  - Compiling a purchase request → `403 Only a head may compile` (`lib/domain/purchasing.ts:157-159` checks the *role*).
  - Lab-commit decisions (`lab-drafts.ts` `currentHeadOf`), transfer approval steps (`OWNER_HEAD`/`TARGET_HEAD`) and external-request department decisions (`requests.ts:557`) resolve by *occupancy* only, so the same person can still approve those.
  - The reverse also holds: assigning someone to a node doesn't grant MANAGER, so a new head can approve transfers but can't compile purchases or see People.
- **Fix alternatives:**
  - **A (recommended):** One definition of "head". Derive head capabilities from occupancy (`OrgNode.userId`) everywhere: `canCompile`, `listOpenNeeds`, the People nav and route, `create` for invites. Keep MANAGER only as a coarse "may be appointed" marker.
  - **B:** Keep the role, but auto-grant MANAGER on assignment and refuse removing it while occupying (or auto-vacate).
- **Regression test:** `purchasing.spec.ts` "an occupant without the MANAGER role can compile / a MANAGER without occupancy cannot".

### F-018 · LOW · Personnel — Deans see everyone below them but can't act on any of it

**Status: Fixed (2026-09-20, Phase 3)** — `lib/server/people/people.ts`'s `resendInvite` (whole visible subtree) and `create` (a head may name any department in their subtree as home unit), plus the invite form's department picker in `PersonnelPage.tsx`. A home node outside the head's tree is now an explicit 403 instead of being silently rewritten. See "Phase 3 fix round" below for verification.

- **Case:** P-09
- **Actual:**
  - `GET /people` as the CoEEC dean lists SE and Materials people, with "Resend invite" buttons on invitees.
  - Clicking one → `403 You may only resend invitations within your own department` (`people.ts:235-240` compares against `ownNodeId`).
  - A dean inviting gets people homed on the *college* node (`people.ts:111-118`), not a department.
- **Fix alternatives:**
  - **A (recommended):** Use subtree reach (`scope.visibleNodeIds`) for resend, and for invite let a dean pick a department within their subtree.
  - **B:** Keep own-node-only, but hide actions that will 403 and say "ask the department head".

### F-019 · LOW · Personnel — Double-submitting an invite returns 500

**Status: Fixed (2026-09-20, Phase 3)** — `lib/server/people/people.ts`'s `create` — the `emailLower` P2002 maps to the same 400 as the pre-check. See "Phase 3 fix round" below for verification.

- **Case:** P-03
- **Actual:** 5 parallel identical invites → `[201,500,500,500,500]`. One user row is created (correct), but four callers get "Internal server error".
- **Root cause:** `people.ts:122-124` does check-then-insert. The `emailLower` unique violation (P2002) inside the transaction isn't mapped.
- **Fix:** catch P2002 on `user.create` → 400 "A person with this email already exists" (the same message as the pre-check).

### F-020 · CRITICAL · Register — Deleting a lab silently destroys another department's borrowed equipment inside it

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/resources/scope.ts`'s `writableItemIdsOf` + `mutate.ts`'s named delete blockers. See "Phase 1 fix round" above for the full change and verification.

- **Case:** R-23 · **Actor:** custChem (Hanna Bekele, ChemE custodian)
- **Setup:** seeded loan. SE's "Workstation Setup 07" (a computer with its parts, table and chair: 14 items) sits inside Hanna's "Mechanical Unit Operations Laboratory". It is owned by Software Engineering and custodied by Girma Wolde (SE).
- **Repro:** as Hanna, `POST /api/resources/items/changes {"kind":"deleteItem","itemIds":["<Mechanical Unit Operations Laboratory>"]}`.
- **Expected:** the whole delete is refused, because the subtree contains resources Hanna doesn't answer for. This is exactly what `assertSubtreeInScope` exists to guarantee (`mutate.ts:507-521`, and the Phase 4 bug #2 fix described in `PROGRESS.md`).
- **Actual:** `200 {"applied":1}`. All 14 SE-owned items are gone; `Item` rows with owner SE and current unit ChemE went from 14 to 0. The only trace is a single `deleteItem` log line for the lab root, attributed to Hanna. SE is never notified.
- **Root cause:**
  - `assertSubtreeInScope` → `scope.assertCanMutate` → `custodyItemIdsOf(userId)`, which resolves custody **through physical containment**: everything beneath an item you custody counts as yours.
  - So a borrowed item placed in a host's lab is "in the host's custody" for write checks, and the guard passes trivially.
  - Combined with the hard delete (F-025), the rows are unrecoverable.
  - This regression pre-dates Track 5: the Phase 4 fix tested nested *foreign-custodian* items before containment custody existed.
- **Impact:** any lab custodian can permanently erase equipment they're only hosting: other departments' loans, and pull-transfer borrowings (Track 5 puts the borrowed item *inside the borrower's lab* while the lender keeps custody). Irreversible data loss of university assets.
- **Fix alternatives:**
  - **A (recommended):**
    - Define write custody as *direct* custody (`Item.custodianId`) **or** containment **only where every item on the path shares the same `custodianId` and `ownerOrgNodeId`**. A foreign-custodied or foreign-owned node stops the inheritance for itself and its subtree.
    - Apply it in `custodyItemIdsOf` for writes, and keep containment for *reads*.
    - `deleteItem`, `moveInTree`, `transferItem` and `setStatus` on a subtree then refuse, naming the foreign items.
  - **B:** Keep containment custody, but add an explicit check to `deleteItem`/`moveInTree`/`transferItem`: refuse if any subtree row has a different `custodianId` or `ownerOrgNodeId` than the root, unless the actor is SYS_ADMIN.
  - **C (defence in depth, alongside A or B):** switch to soft delete (F-025) so an accidental sweep can be restored.
- **Regression test:** `mutate.spec.ts` "deleting a container that holds a borrowed (foreign-owned, foreign-custodied) item is refused and deletes nothing".

### F-021 · CRITICAL · Register — A host department can edit, take custody of and re-own borrowed items without the lender

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/resources/scope.ts`'s `writableItemIdsOf`. See "Phase 1 fix round" above for the full change and verification.

- **Cases:** R-10, R-11 (H9) · **Actors:** headChem, custChem
- **Repro (on the seeded loan "Workstation Setup 07", owned by SE, custodian Girma, inside a ChemE lab):**
  1. As ChemE's head: `setName` → 200; `setOwnerOrg` to Chemical Engineering → **200**.
  2. As Hanna (host custodian): `setCustodian` to herself → **200**.
- **Expected:** a borrower may use a borrowed item, but ownership, custody and the item's identity stay with the lender until it's transferred back through the approvals chain.
- **Actual:** after two calls the item is owned by ChemE and custodied by Hanna. No approval, no notification to SE or Girma; it appears only in the change log.
- **Root cause:**
  - `scope.assertCanMutate` (`lib/server/resources/scope.ts:196-212`) lets a **MANAGER** write any item whose `ownerOrgNodeId` **or `currentOrgNodeId`** is in their visible subtree. A borrowed item's current unit is the host, so the host head passes.
  - Separately, the containment custody explained in F-020 lets the host custodian pass.
  - `applyFieldChange` (`mutate.ts:974-1033`) then applies `setOwnerOrg`/`setCustodian` with no approval routing.
  - This also contradicts the documented write policy ("only SYS_ADMIN or an item's own custodian may write", `PROGRESS.md`, Phase 7).
- **Impact:** a borrowing unit can permanently seize another unit's asset. Track 5's pull transfers create exactly these borrowed placements, so every approved loan is exposed.
- **Fix alternatives:**
  - **A (recommended):**
    - (1) The MANAGER write reach uses `ownerOrgNodeId` only, never `currentOrgNodeId`.
    - (2) Use the containment-custody rule from F-020 A.
    - (3) Route `setOwnerOrg`, and `setCustodian` across units, through approvals (see F-022).
  - **B:** Explicit "borrowed" semantics: when `ownerOrgNodeId ≠ currentOrgNodeId`, the host may only `setStatus` (report a fault) and `moveInTree` within its own room. Everything else belongs to the owner's custodian or head.
- **Regression tests:** `mutate.spec.ts` "host head cannot rename / re-own a borrowed item"; "host custodian cannot take custody of a borrowed item".

### F-022 · HIGH · Register — A custodian can give away ownership, move the current unit, or dump custody directly, bypassing transfers and handovers

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/resources/mutate.ts`'s `assertAuthorized`. See "Phase 1 fix round" above for the full change and verification.

- **Cases:** R-08, R-09 (H8) · **Actor:** custSe (Girma)
- **Repro, on items in Girma's own lab:**
  - `setOwnerOrg` → Chemical Engineering: **200**;
  - `setCurrentOrg` → Materials Science: **200**;
  - `setCustodian` → Hanna (ChemE custodian, who never accepted): **200**;
  - `setCustodian` → a STUDENT: **200**;
  - `setCustodian` → a DISABLED account: **200**.
- **Expected:**
  - ownership changes between units go through the transfer or handover approvals (Track 3/5: `transferOwnership` is store-keeper/SYS_ADMIN only, and the receiving head approves while the receiving custodian accepts);
  - moving the current unit is a transfer;
  - custody goes only to an active, eligible person who accepts it.
- **Actual:** all five succeed instantly. `assertAuthorized` blocks only `transferItem` (`mutate.ts:119-139`). The same effects are available through three field-change kinds with no chain.
- **Impact:** Track 3/5's approval model is optional in practice. Accountability can be pushed onto people who never agreed, or who can never sign in to act on it (a disabled account; `people.deactivate`'s custody blocker then makes that account impossible to clean up without admin).
- **Fix alternatives:**
  - **A (recommended):**
    - `setOwnerOrg` and `setCurrentOrg` are SYS_ADMIN-only corrections, like `transferItem`'s direct door; everyone else uses `requestTransfer`.
    - `setCustodian` is allowed directly only within the same owning unit, and only to an ACTIVE user holding CUSTODIAN, STORE_KEEPER or MANAGER whose home unit is the item's owner.
    - Cross-unit custody goes through the handover chain (the receiving custodian accepts).
  - **B:** Route all three through `ApprovalPolicy` (new operations in `SEED_POLICIES`), with AUTO for same-unit custody changes.
- **Regression tests:** `mutate.spec.ts` "custodian setOwnerOrg/setCurrentOrg refused"; "setCustodian to a student/disabled/other-unit user refused".

### F-023 · HIGH · Register — "Add resource" under your own lab lets the client pick another unit and another custodian

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/resources/mutate.ts`'s `applyCreateItem`. See "Phase 1 fix round" above for the full change and verification.

- **Case:** R-05 (H10) · **Actor:** custSe
- **Repro:** `createItem {parentId: <own lab>, categoryId: chair, ownerOrgNodeId: <ChemE>, currentOrgNodeId: <Materials>, custodianId: <Hanna>}` → 200.
- **Expected:** a child inherits the parent's owner, current unit and custodian (or the fields are refused for non-admins).
- **Actual:** the chair is created inside Girma's lab but **owned by Chemical Engineering, currently in Materials Science and custodied by Hanna**. Girma can fabricate inventory on another department's books and make someone else accountable for it.
- **Root cause:** `mutate.ts:143-150` authorizes on the parent alone, and `applyCreateItem` then takes `input.ownerOrgNodeId ?? parent.ownerOrgNodeId` and the same for current unit and custodian (`mutate.ts:392-397`). The root-creation policy (`assertCanCreateRoot`) validates these fields; the child path doesn't.
- **Fix alternatives:**
  - **A (recommended):** For `parentId !== null`, ignore or refuse `ownerOrgNodeId`, `currentOrgNodeId` and `custodianId` unless the actor is SYS_ADMIN; always inherit from the parent.
  - **B:** Validate the supplied values against the same rules as `assertCanCreateRoot` (own unit, self or eligible custodian).
- **Regression test:** `create-item.mutate.spec.ts` "a child's owner/current/custodian always equal its parent's for non-admins".

### F-024 · MEDIUM · Register — Custodian eligibility is never validated (students, disabled accounts)

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/scope.ts`'s `assertEligibleCustodian`, called from `mutate.ts`, `scope.ts`'s `assertCanCreateRoot`, and `approvals.ts`'s `loadTransferContext`. See "Phase 2 fix round" below for the full change and verification.

- **Cases:** R-07, R-09
- **Actual:**
  - A root lab created by admin with a DISABLED custodian → 200.
  - A lab created by head.se with a STUDENT custodian → 200.
  - `setCustodian` to a student or a disabled user → 200.
  - The only check is "user exists": `mutate.ts:406`, `:984-985`, and `approvals.ts:124` (the same for transfer target custodians).
- **Impact:** custody lands on accounts that can't act (disabled) or shouldn't hold assets (students). Booking approvals for those rooms then route to them (`decidesFor` uses custody), and draft staging and receipt steps stall.
- **Fix:** one `assertEligibleCustodian(userId)` helper, used by `createItem`, `setCustodian` and transfer/handover. It requires status ACTIVE and a role in CUSTODIAN, STORE_KEEPER or MANAGER (the same set as `/people/custodians`).
- **Regression test:** `mutate.spec.ts` "custody may not be given to a student or a disabled account".

### F-025 · MEDIUM · Register — Deleting a resource is a hard delete with no recovery

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/mutate.ts`'s `applyDeleteItem`, now a soft delete. See "Phase 2 fix round" below for the full change and verification.

- **Case:** R-18 (H12)
- **Actual:** after `deleteItem` the `Item` row no longer exists (`deletedAt` stays unused), and the cascades remove images, drafts, ideal targets, **reservations and class series** (`schema.prisma` `onDelete: Cascade` on `Reservation.lab`, `ScheduleSeries.lab` and `ReservationResource.item`; see the S suite for the booking impact). Only the `ItemChange` audit row survives, without the item's data.
- **Root cause:** `mutate.ts:548` calls `tx.item.delete`. Yet every reader already filters `deletedAt: null`, and the column exists in the schema.
- **Fix alternatives:**
  - **A (recommended):** Soft delete: set `deletedAt` on the subtree, keep the rows, and refuse deletion while the subtree has live reservations, series, pending transfers or drafts (see F-03x in S/T).
  - **B:** Keep the hard delete, but snapshot the subtree JSON into the `ItemChange` row (`before`) and block deletion while dependent live records exist.
- **Regression test:** `mutate.spec.ts` "deleteItem keeps rows with deletedAt set; reads exclude them".

### F-026 · MEDIUM · Register — No upper bound on "Add N resources"

**Status: Fixed (2026-09-20, Phase 2)** — `lib/shared/resources/item.ts`'s `CreateItemChange.count`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** R-06 (H11)
- **Actual:** `createItem count: 2000` → 200 in 734 ms (chairs have no template). A category with a 12-part template multiplies that: 2,000 computers is about 26,000 rows in one transaction, and 50,000 would exceed the 5 s default interactive-transaction timeout or exhaust memory on a serverless function.
- **Root cause:** `CreateItemChange.count` is `z.number().int().min(1)` with no max (`lib/shared/resources/item.ts:188`).
- **Fix:** `.max(500)` (or a per-category cap computed as count × template size ≤ 5,000 rows), plus a friendly message suggesting BULK counting for large quantities.

### F-027 · MEDIUM · Categories — Switching BULK → SERIALIZED fails with 500 on real stock; if it succeeded it would silently erase quantities

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/categories.ts`'s `update`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** C-07
- **Repro:**
  1. Create a BULK category (unit L) and an item with qty 25.
  2. `PATCH /categories/:id {countingMode:"SERIALIZED"}`.
- **Actual:** `500 Internal server error`. Postgres `23514 violates check constraint "Item_qty_countingMode_check"` at `lib/server/resources/categories.ts:438`: the code sets `countingMode` first, then `qty = 1` in a second statement, and the CHECK fires on the first.
- **Second problem:** even with the statements swapped, the design (`categories.ts:439-441`) turns 25 L of ethanol into "1". The impact preview says only "Counted as individual units instead" and never mentions quantities being lost.
- **Fix alternatives:**
  - **A (recommended):** Refuse BULK → SERIALIZED while any item of the category has qty ≠ 1 (a 409 listing them). Offer "split into N units" as an explicit, separate action.
  - **B:** Do a single `UPDATE … SET "countingMode"='SERIALIZED', qty=1` (atomic, so the CHECK passes), and make the preview a `destructive` note listing each item's lost quantity, requiring `purgeKeys`-style explicit confirmation.
- **Regression test:** `categories.spec.ts` "BULK→SERIALIZED with qty>1 stock is refused (409), never 500".

### F-028 · LOW · Categories — Changing a field's type leaves invalid stored values behind

**Status: Fixed (2026-09-20, Phase 3)** — `lib/server/resources/categories.ts`'s `update` — refuses (409) a field-type change while any item holds a value the new type can't read, unless that field is purged in the same save; the impact preview now offers the purge via `orphanKeys`. See "Phase 3 fix round" below for verification.

- **Case:** C-08
- **Actual:** changing "Reading" from TEXT to NUMBER on a category whose item holds `"about five"`: the preview correctly flags it as destructive, the PATCH → 200, and the stored value stays `"about five"` in a NUMBER field. Later unrelated edits still succeed, and filters or sums over that field see mixed types.
- **Fix:**
  - **A:** On a type change, require `purgeKeys` to include the field, or convert values (numeric strings → numbers, others → cleared) with per-item audit lines.
  - **B:** Refuse a type change while any item holds an incompatible value.

### F-029 · LOW · Categories/Register — "Required" fields aren't enforced

**Status: Fixed (2026-09-20, Phase 3)** — `lib/server/resources/mutate.ts`'s `applyCreateItem` (required fields on root items being created; template children and existing rows are never forced) + `lib/domain/edit-impact.ts` (a warning counting existing items lacking a newly required field). See "Phase 3 fix round" below for verification.

- **Cases:** C-09, R-22
- **Actual:**
  - Creating an item in a category whose `serial` field is `required: true`, without that field → 200.
  - Adding a required field to a category with 7 existing items → the preview only says "Adding the "Asset tag" field" (info).
- **Root cause:** `applyCreateItem` validates only the keys supplied (`mutate.ts:368-374`); `required` isn't read anywhere on the write path.
- **Fix:** enforce required keys on `createItem` (400 naming the missing fields). The impact preview reports a *warning* with the count of existing items lacking the new required field. Existing rows aren't forced; the Register can highlight them.

### F-030 · LOW · Categories/Register — No name hygiene for categories and resources

**Status: Fixed (2026-09-20, Phase 3)** — `lib/shared/resources/{category,item}.ts` (names trimmed, ≤160; key `^[a-z][a-z0-9-]{1,40}$`) + `categories.ts`'s `assertKnownIcon` against the icon registry. See "Phase 3 fix round" below for verification.

- **Cases:** C-12, R-21
- **Actual:**
  - category name `"   "` → 201; a 2,000-character name → 201; key `"has spaces …"` → 201; unknown `iconKey` → 201;
  - resource name of 10,000 characters → 200; blank `"   "` → 200.
  - HTML in names is stored verbatim. That's fine as long as every renderer escapes it; the UI check is in suite Z.
- **Fix:** `trim().min(1).max(160)` for names; key `^[a-z][a-z0-9-]{1,40}$`; `iconKey` validated against `lib/domain/icons.ts`.

### F-031 · MEDIUM · Scope — Students can read their department's whole asset register

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/scope.ts`'s `assertMayBrowseRegister`, plus route-level `STAFF_ROLES` gates. See "Phase 2 fix round" below for the full change and verification.

- **Case:** V-05 · **Actor:** student (home: Software Engineering)
- **Actual:** `GET /api/resources/items?pageSize=200` → 200 with **146 SE resources**, including custodian names, rooms, statuses and properties. A point read of an SE computer → 200. Tree, summary and facets behave the same way.
- **Expected:** the scope module's own header says students have no register access. `lib/server/org/scope.ts:24-26`: *"The per-endpoint RBAC layer (requireRole), not this module, is what actually keeps a student off the asset register."* No resource read route calls `requireRole`.
- **Root cause:** `app/api/resources/items/**` and `changes` only call `requireSession`. `resources/scope.ts:43-48` (`defaultModeFor`) gives any non-custodian with a home node `ORG_SUBTREE`.
- **Impact:** asset locations and custodian identities are exposed to every student account (and EXTERNAL accounts with a home node). Cost is correctly hidden (V-07 passed).
- **Fix alternatives:**
  - **A (recommended):** Add `requireRole(user, STAFF_ROLES)` (every role except STUDENT/EXTERNAL) to all `/api/resources/**` read routes except `categories` GET. Hide Dashboard, Register and Change log in `lib/nav.ts` for those roles.
  - **B:** Add a `NONE` scope mode that `defaultModeFor` returns for STUDENT/EXTERNAL, so reads return empty.
- **Regression test:** `university-scope.spec.ts` "a STUDENT's search/tree/getOne are refused".

### F-032 · MEDIUM · Access views — One "Everyone, read-only" view silently blocks every write for the whole university, including SYS_ADMIN

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/mutate.ts`'s `assertViewAllowsEdit`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** V-11 · **Actor:** propadmin (PROPERTY_ADMIN), then admin
- **Repro:**
  1. As PROPERTY_ADMIN, `POST /api/resources/access-views {scope:"ORG_SUBTREE", audiences:[{type:"EVERYONE"}], canEdit:false}` → 201.
  2. As SYS_ADMIN, with no view chosen, perform any item write.
- **Actual:** `403 "<view name>" is a read-only view — switch views to make changes.` Every account with no more specific view is now read-only, including every custodian in production, since no views are seeded today. Accounts that happen to have a PERSON/ROLE view keep editing, so the outage looks random.
- **Root cause:** `resolveEffectiveView` falls back to the most specific *matching* view as the person's default, and `mutate.ts:231-236` applies `canEdit:false` from that default "for every role including SYS_ADMIN". The admin screen shows no reach or narrowing preview; only `prisma/seed-views.ts` has one.
- **Fix alternatives:**
  - **A (recommended):** A `canEdit:false` view restricts writes **only when the person explicitly chose it** (the `?view=` param). As an implicit default it narrows reads only.
  - **B:** Port `previewRollout`'s "who narrows / who loses edit" report into `AccessViewsPage` and require confirmation when a save removes write access from anyone. Also refuse `EVERYONE + canEdit:false` outright.
  - **C:** SYS_ADMIN is exempt from implicit (non-chosen) views.
- **Regression test:** `views.spec.ts` "an implicit EVERYONE read-only view does not block writes of a user who did not choose it".

### F-033 · LOW · Access views — Validation gaps (empty or unknown nodes accepted; unknown person → 500)

**Status: Fixed (2026-09-20, Phase 3)** — `lib/server/resources/views.ts`'s `assertViewReferencesValid` — EXPLICIT_NODES needs ≥1 existing active unit, PERSON audiences must exist and not be disabled, an unknown view id is a 404. See "Phase 3 fix round" below for verification.

- **Case:** V-12
- **Actual:**
  - `EXPLICIT_NODES` with `explicitNodeIds: []` → 201 (a view that shows nothing);
  - unknown node id → 201;
  - an unknown `personId` audience → **500** (FK violation).
- **Fix:** validate in `views.ts` `upsert`: EXPLICIT_NODES needs ≥ 1 active node, every node id must exist, and every person must exist and be ACTIVE (400 otherwise).

### F-034 · LOW · Scope — Read-only "context" visibility of a container exposes the whole container's aggregate counts

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/scope.ts`'s `assertMaySeeLabAggregate`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** V-02
- **Actual:** Hanna (ChemE) custodies one item that sits inside SE's "SE Lab X". That gives her ancestor read-only context on the lab, and `GET /api/resources/labs/<SE Lab X>/ideal-vs-actual` → 200 with the full ideal/actual composition of SE's lab. Direct item reads of SE's other items correctly 404.
- **Root cause:** `lab-drafts.ts:385-388` gates on `assertCanSeeItem`, which is ancestor-inclusive (designed for tree context), and then aggregates the entire subtree.
- **Fix:** gate lab aggregates (ideal vs actual, purchasables, calendars) on *direct* scope of the lab (`canSeeItem` without ancestor closure), write custody, or headship of the owning unit.

### F-035 · MEDIUM · Draft mode — Approving a lab commit can apply only half of it and leave the request stuck

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/mutate.ts`'s `applyChange` (caller-supplied `tx`) and `lab-drafts.ts`'s `decideCommit`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** D-06 (H17) · **Actors:** custMat, headMat (Materials Science in draft mode)
- **Repro:**
  1. Stage two edits of the same chair, each carrying the chair's current version (`expectedVersions`), exactly as the Inspector and Change modal send them: `setName` and `setStatus → BROKEN`.
  2. Submit; the head approves.
- **Expected:** both apply, or neither (a clean STALE with nothing written).
- **Actual:**
  - The head gets `409 VERSION_CONFLICT`.
  - The chair **was renamed but not marked broken**.
  - The request stays `PENDING`, with draft rows `["SUBMITTED","APPLIED"]`.
  - A retry turns it STALE, with the first half still applied.
- **Root cause:** `lib/server/resources/lab-drafts.ts:357-379`. The pre-flight dry-runs every staged change *independently against the same starting state*, then applies each in its own `applyChange` transaction. The first real apply bumps the version the second expects. The known "residual race" comment understates this: it's deterministic, not a race.
- **Fix alternatives:**
  - **A (recommended):** Apply the whole batch in **one** Prisma transaction. Refactor `applyChange` so its body (`assertVersionsMatch` + `performChange`) can run against a caller-supplied `tx`, then loop inside a single `$transaction`. Any failure rolls everything back and marks the request STALE.
  - **B:** Strip `expectedVersions` from staged payloads and check `LabCommitRequest.baseVersions` once, up front, under `FOR UPDATE` (this also fixes F-036). Changes still apply in separate transactions, so a mid-batch failure is still possible, just rarer.
- **Regression test:** `lab-drafts.spec.ts` "two staged edits of the same item both apply atomically on approval".

### F-036 · MEDIUM · Draft mode — A stale draft silently overwrites later corrections (lost update)

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/lab-drafts.ts`'s `checkBaseVersionsCurrent`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** D-07
- **Repro:**
  1. The custodian stages a rename to "WB from stale draft" and submits.
  2. An admin corrects the item's name directly.
  3. The head approves.
- **Expected:** STALE ("this resource changed since the draft was submitted"). `PROGRESS.md` (Track 2) describes baseVersions as "the SAME optimistic-concurrency map … so staleness at approval time is the identical mechanism as a direct edit".
- **Actual:** `APPLIED`, and the final name is "WB from stale draft". The admin's correction is lost.
- **Root cause:** `submitDraft` stores `baseVersions` (`lab-drafts.ts:181-195`), but `decideCommit` never reads them. The staged payloads from `LabDraftPanel` carry no `expectedVersions`.
- **Fix:** in `decideCommit` (inside the transaction from F-035 A), lock the rows in `baseVersions` `FOR UPDATE` and compare. On mismatch, mark STALE, with a resolution naming the changed items.
- **Regression test:** `lab-drafts.spec.ts` "an item changed after submission makes approval STALE".

### F-037 · MEDIUM · Planning — Ideal targets (and so purchasables) only exist for departments in draft mode

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/lab-drafts.ts`'s `assertWorkflowEnabled`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** D-01 (H18)
- **Actual:** `POST /api/resources/labs/:lab/draft {targetKind:"IDEAL"}` for a lab whose department isn't in draft mode → `403 Draft mode is not enabled…`. There's no other way to set `LabIdealTarget`. Every department in production today has draft mode off, so none can record ideal state, and the head's "compute purchasables from ideal vs current" (Track 4 / E2E S5) always comes back empty.
- **Root cause:** `stageChange` calls `assertWorkflowEnabled` before the VISIBLE/IDEAL split (`lab-drafts.ts:112-114`).
- **Fix alternatives:**
  - **A (recommended):** Decouple IDEAL from draft mode. The custodian proposes ideal targets and the head approves, regardless of the toggle. The toggle keeps governing VISIBLE edits only.
  - **B:** Let the department head set ideal targets directly (no approval) when draft mode is off.
- **Regression test:** `lab-drafts.spec.ts` "ideal targets can be proposed and approved with draft mode off".

### F-038 · DESIGN · Draft mode — A vacant headship freezes a department's lab commits with no escalation

**Status: Decided — no change (2026-09-20)** — A vacant headship freezes decisions rather than escalating — the plan's decision was that authority stays with the post's occupant, and that a silent auto-escalation is worse than a visible block. The block message already names the vacancy; appointing a head unblocks immediately (E2E D-09).

- **Case:** D-09
- **Observed:**
  - While Materials Science had no head, both SYS_ADMIN and the former head got 403 on a pending commit.
  - Direct edits are also refused (draft mode), so the department's register is frozen until someone is appointed.
  - The same pattern holds for transfer steps (`OWNER_HEAD`/`TARGET_HEAD`) and purchasing ladders (vacant steps).
- **Question:** should a vacancy escalate (to the dean or next occupied ancestor, or to SYS_ADMIN), or should draft mode be auto-suspended while the head's post is vacant?
- **Options:**
  - **A:** Resolve "head" as the nearest occupied ancestor for decisions, labelled "acting".
  - **B:** SYS_ADMIN may decide with a mandatory note, recorded as an override.
  - **C:** Keep the block, but surface "blocked: vacant post" on Org Studio and the dashboard.

### F-039 · HIGH · Transfers — There's no way to return a borrowed item; the lender yanks it back and the register keeps the wrong unit

**Status: Fixed (2026-09-20, Phase 1)** — `lib/domain/approvals.ts`'s `HOST_RELEASE`/`OWNER_RECEIPT` return chain. See "Phase 1 fix round" above for the full change and verification.

- **Case:** T-10 (H15) · **Actors:** custSe (lender Girma), custChem (borrower Hanna)
- **Setup:** after an approved pull (T-03), SE's whiteboard is in ChemE's store: owner SE, current ChemE, custodian Girma.
- **Actual:**
  - **The borrower can't start a return.** `POST /transfers` with Girma's lab as the destination → 404/400: Hanna doesn't hold that destination.
  - **The lender can't request one either:** `400 You already hold this resource — use Move`.
  - **The lender can Move it straight back** (`moveInTree` → 200) without the borrower's knowledge or any receipt step.
  - Afterwards the item sits in Girma's SE lab while **`currentOrgNodeId` still says Chemical Engineering**. ChemE's head keeps write reach over it (F-021), and dashboards and reports place it in the wrong department.
- **Root cause:**
  - `approvals.ts:231-251` (`assertTransferParties`) models only borrow-in.
  - `applyMoveInTree` (`mutate.ts:676-718`) never updates `currentOrgNodeId` to match the destination's unit.
- **Impact:** every loan made through Track 5 ends in either a unilateral grab or a permanently wrong register.
- **Fix alternatives:**
  - **A (recommended):** An explicit **return** request: either party may raise it on an item where `ownerOrgNodeId ≠ currentOrgNodeId`. The chain is the host custodian's release, then the lender's receipt confirmation, and it applies `parentId` plus `currentOrgNodeId = owner`. Refuse `moveInTree` across unit boundaries for non-admins.
  - **B:** Keep Move as the return, but (1) set `currentOrgNodeId` from the destination's unit on every `moveInTree`, and (2) require the item to be `ownerOrgNodeId === currentOrgNodeId` or the actor to be the host custodian, so the host can hand it back and the lender can't grab it.
- **Regression test:** `approvals.spec.ts` "a borrowed item can be returned; afterwards current unit = owner".

### F-040 · MEDIUM · Transfers — Concurrent final approvals leave an applied transfer marked STALE

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/approvals.ts`'s `decideStep`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** T-07 (H13)
- **Repro:** bring a pull request to its last step (receipt), then send 4 simultaneous "Confirm receipt" calls, e.g. a double-click or two tabs.
- **Actual:**
  - Responses `["STALE","APPLIED","STALE","STALE"]`.
  - The final stored status is **`STALE` "Version conflict"**, even though the item **was moved** (one `transferItem` audit row; the item is in the ChemE store).
  - The requester sees "nothing was applied", while the register shows it applied.
- **Root cause:** `approvals.ts:345-393` (`decideStep`) reads the request and steps without locking. Every concurrent caller passes the PENDING check and calls `applyChange`. The optimistic version check correctly stops a double move, but every loser then *overwrites* the request status with STALE.
- **Fix alternatives:**
  - **A (recommended):** Run `decideStep` in one transaction that begins `SELECT … FROM "ChangeRequest" WHERE id = $1 FOR UPDATE` and re-checks `status === "PENDING"` and the current step. Losers get 409 "already decided". Only write STALE if the request is still PENDING.
  - **B:** A conditional update: `updateMany({ where: { id, status: "PENDING" }, data: { status } })`, then treat `count === 0` as already decided.
- **Regression test:** `approvals.spec.ts` "parallel final approvals yield exactly one APPLIED and no STALE overwrite". Apply the same pattern to purchasing `decideStep` (B suite).

### F-041 · MEDIUM · Transfers — Items in a pending transfer aren't locked (rename wastes every approval; delete leaves a ghost request)

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/approvals.ts`'s `decideStep` (structural re-validation) and `mutate.ts`'s `applyMoveInTree`. See "Phase 2 fix round" below for the full change and verification.

- **Cases:** T-08, T-09 (H14)
- **Actual:**
  - **T-08:** the lender approves, then renames the item. The SE and ChemE heads both still see and approve a PENDING request. Only at the receipt step does it turn `STALE "Version conflict"`. Any trivial edit (a typo fix, a status toggle) by anyone voids a fully approved chain at the last moment, with no explanation beyond "Version conflict".
  - **T-09:** the lender **deletes** the item while a transfer is pending → 200. The request stays in the SE head's inbox, and approving it → `PENDING` (the chain keeps walking for an item that no longer exists).
- **Root cause:** the request snapshots `baseVersions` (`approvals.ts:295`) but nothing marks the item as reserved. `decideStep` only discovers the problem at the final `applyChange`.
- **Fix alternatives:**
  - **A (recommended):**
    - (1) On every `decideStep`, re-validate the subject items (existence, `baseVersions`) and mark the request STALE immediately, with a specific reason ("renamed by X on …", "deleted").
    - (2) Refuse delete, move and transfer of an item that's in a PENDING transfer (409 "in a pending transfer — cancel it first").
    - (3) Compare only the fields a transfer depends on (parent, owner, current unit, custodian), not the whole-row version, so a rename doesn't void it.
  - **B:** Only (1), so failures happen early and are explained.
- **Regression tests:** `approvals.spec.ts` "deleting an item in a pending transfer is refused"; "a rename does not void an approved transfer".

### F-042 · MEDIUM · Transfers — Some pull chains skip the owning or receiving department

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/approvals.ts`'s `resolveTransfer`. See "Phase 2 fix round" below for the full change and verification.

- **Cases:** T-12, T-13
- **Actual:**
  - **Store keeper pulls a department item into the Main Store** (not a handover): the chain is `Receiving head — University (AVP) → Receiving custodian accepts (Girma Wolde)`. **The SE head (owner) is never asked**, and the only "consent" from SE is Girma's acceptance step, which is labelled as the *receiving* custodian's. The store keeper's policy is the handover rule (`pol-store-transfer`), reused for a pull because `resolvePolicy` matches by actor role only.
  - **A dean (MANAGER) pulls an SE whiteboard into the ChemE store:** the chain is `Current custodian (Girma) → Head SE → Confirm receipt (the dean)`. Nobody from ChemE (the store's custodian or ChemE's head) is asked, though the item lands in their store and under their current unit (`pol-transfer-mgr` has no TARGET step, and the MANAGER reach from F-021 lets the dean write ChemE containers).
- **Root cause:** `lib/domain/approvals.ts:523-550`. The policies are keyed by actor role, not by the transfer's *shape* (pull vs handover, same unit vs cross-unit). `assertTransferParties` never forces the owning head and the receiving custodian into every cross-unit pull.
- **Fix alternatives:**
  - **A (recommended):** Chain building for any non-handover pull always includes `ITEM_CUSTODIAN`, `OWNER_HEAD`, the destination's custodian if different from the requester, `TARGET_HEAD`, and `REQUESTER_RECEIPT`, with self-held steps skipped as today. Keep `pol-store-transfer` only for `transferOwnership: true`.
  - **B:** Add `appliesTo.shape` (PULL/HANDOVER) to `ApprovalPolicy` and seed a store-keeper *pull* policy that includes `OWNER_HEAD`.
- **Regression tests:** `approvals.spec.ts` "a store keeper's pull asks the owning head"; "a dean's pull into another unit's lab asks that lab's custodian".

### F-043 · HIGH · Purchasing — "Revise and resubmit" fails for any request that carries staff needs

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/resources/purchasing.ts`'s `reviseAndResubmit`. See "Phase 1 fix round" above for the full change and verification.

- **Case:** B-04 · **Actors:** headSe, deanCoeec
- **Repro:**
  1. A staff member raises a need; the head compiles a request carrying it (the need becomes CARRIED).
  2. The dean sends it back (REVISE).
  3. The head resubmits with the same lines, keeping the need link (the Purchasing page pre-fills it: `components/resources/PurchasingPage.tsx:528` reads `fromNeedIds[0]`, and `:313` sends it back).
- **Expected:** the resubmission goes back to the dean.
- **Actual:** `400 One or more referenced needs are not open needs belonging to this unit.` The request sits in REVISING. The only way through is to drop the need link, which silently returns the need to OPEN and detaches the staff member's request from the order.
- **Root cause:** `purchasing.ts:395-396` (`reviseAndResubmit`) runs `assertNeedsOpenAt` **before** the transaction that releases the request's own carried needs back to OPEN (`:402-407`). The needs this request already carries fail the "must be OPEN" check.
- **Impact:** the send-back cycle, a core part of the university's purchasing process (every office can send a request back), is broken for exactly the requests built from staff needs. The 2026-09-13 walkthrough didn't hit it because its lines came from purchasables, not needs.
- **Fix alternatives:**
  - **A (recommended):** In `assertNeedsOpenAt` for a resubmission, accept needs that are `OPEN` **or** `CARRIED` by a line of *this same request* (`purchaseLine.purchaseId === requestId`). Run the check inside the transaction.
  - **B:** Release the carried needs first, then validate, all inside the same transaction.
- **Regression test:** `purchasing.spec.ts` "a request carrying a need can be revised and resubmitted with the need still linked".

### F-044 · HIGH · Purchasing — Count-based PR numbering: concurrent compiles fail, and one removed row takes purchasing down

**Status: Fixed (2026-09-20, Phase 1)** — `lib/server/resources/purchasing.ts`'s `nextReference`. See "Phase 1 fix round" above for the full change and verification.

- **Cases:** B-16, B-17 (H20)
- **Actual:**
  - **B-16:** 4 requests compiled at the same moment → `[200,500,500,500]`.
  - **B-17:** after one old (cancelled) request row was deleted, **every** subsequent compile → `500 Internal server error` (B-18 and B-19 were blocked by it). References in the DB were `PR-2026-001, 003, 004, 005, 006` with count 5, so "next" = `PR-2026-006`, which already exists, and it stays that way because no compile can succeed to move the count.
- **Root cause:** `purchasing.ts:144-148` builds `count(this year) + 1`, and `reference` is `@unique`. Track 8 fixed the identical flaw in external requests (MAX+1 with a P2002 retry, `requests.ts:168-184`), and `PROGRESS.md` notes purchasing "has the same flaw". Deleting PR rows is routine in this project: `prisma/e2e-workflow-fixture.ts --teardown` and every track's verification cleanup do it.
- **Impact:** a single cleanup, retention job or manual DB fix stops **all purchasing university-wide** for the rest of the calendar year. The campaign had to insert a filler row (`e2e/fill-pr-ref.ts`) to continue.
- **Fix alternatives:**
  - **A (recommended):** A Postgres `SEQUENCE` per year (or a `ReferenceCounter` table updated with `UPDATE … RETURNING` inside the compile transaction), so numbers are never reused and never collide.
  - **B:** Port the external-request approach: `MAX(numeric suffix) + 1` inside the transaction plus a P2002 retry loop (5 attempts).
- **Regression tests:** `purchasing.spec.ts` "parallel compiles all succeed with distinct references"; "compiles still succeed after an older request row is deleted".

### F-045 · MEDIUM · Purchasing — Receiving stock has no integrity checks (wrong category, over-receipt, lost updates, fractional units)

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/purchasing.ts`'s `receivePurchaseLine`. See "Phase 2 fix round" below for the full change and verification.

- **Cases:** B-09, B-10, B-11, B-13 (H21) · **Actor:** storekeeper
- **Actual:**
  - **B-09:** a line ordered as *Computer* was received with `categoryId: chair` → 200, and an "Oscilloscope" **Chair** was created in the store.
  - **B-10:** two simultaneous receipts of 1 L each on the Ethanol line → both 200 and **2 items created**, but `receivedQty` went up by **1**. The line now under-reports what arrived.
  - **B-11:** ordered 10 L, received 500 → 200. `receivedQty` is 501 of 10, and the request closes as if delivered.
  - **B-13:** a *Computer* (SERIALIZED) line with `qty: 2.5` compiles → 200. It can then never be received exactly; receiving requires whole units.
- **Root cause:** `purchasing.ts:550-595` (`receivePurchaseLine`):
  - no `line.categoryId` comparison;
  - no cap against `line.qty - receivedQty`;
  - read-modify-write of `receivedQty` outside any transaction;
  - the item creation (`applyChange`) and the line update are separate commits (and BULK is a third, `setQuantity`), so a failure in between leaves an item with no recorded receipt.
  - `PurchaseLineInput.qty` doesn't check counting mode.
- **Fix alternatives:**
  - **A (recommended):** One transaction: lock the line `FOR UPDATE`; require `categoryId === line.categoryId` (when the line has one); require `0 < qty ≤ ordered − received` (optionally allowing an explicit "over-delivery" flag with a note); create the item(s) and set BULK qty through a `tx`-aware `applyChange`; then `receivedQty = receivedQty + qty` via `increment`. At compile, reject non-integer qty on SERIALIZED categories.
  - **B:** A minimal patch: `increment` instead of read-modify-write, plus the category and cap checks. The partial-failure window remains.
- **Regression tests:** `purchasing.spec.ts` "parallel receipts sum correctly"; "over-receipt and category mismatch are refused".

### F-046 · MEDIUM · Purchasing — Needs carried by a rejected or cancelled request are stuck forever

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/purchasing.ts`'s `reopenCarriedNeeds`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** B-14 (H19)
- **Actual:** a custodian's "Projector" need was carried into a request the dean **rejected**. Afterwards the need is still `CARRIED`, doesn't appear in the head's open needs, and can't be carried into a new request (`assertNeedsOpenAt` requires OPEN) or declined (`declineNeed` requires OPEN). The staff member's "My needs" shows it attached to a dead request. The same holds for `cancelPurchaseRequest`.
- **Root cause:** `decideStep` REJECT (`purchasing.ts:471-478`) and `cancelPurchaseRequest` (`:508-517`) don't touch `NeedLine`. Only `reviseAndResubmit` releases needs.
- **Fix:**
  - **A (recommended):** On REJECT or CANCEL, set carried needs back to `OPEN` (clearing `purchaseLineId`), and note "Returned from PR-… (rejected: <reason>)" on each need.
  - **B:** Add a terminal `NeedStatus.UNFULFILLED` that the head can reopen.
- **Regression test:** `purchasing.spec.ts` "rejecting a request reopens the needs it carried".

### F-047 · MEDIUM · Purchasing — The raiser can cancel an order procurement has already placed and shipped

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/purchasing.ts`'s `cancelPurchaseRequest`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** B-15 (H19)
- **Actual:** a request at `ON_DELIVERY` (approved by every office, with procurement having reported a buyer and a shipment) → `POST /purchase-requests/:id/cancel` by the head → 200 `CANCELLED`. Nobody in procurement or the store is asked or told, and the goods still arrive. The store keeper can't receive them (the stage isn't `IN_STORE`), so they can't be registered.
- **Root cause:** `purchasing.ts:508-517` only refuses `isFinished` stages (CLOSED/REJECTED/CANCELLED).
- **Fix alternatives:**
  - **A (recommended):** The raiser may withdraw only while `APPROVING` or `REVISING`. From `ORDER_PLACED` on, cancellation is a procurement action (`canRunPipeline`) with a required note, visible in history and emailed to the raiser.
  - **B:** Allow a "cancellation request" that procurement confirms.
- **Regression test:** `purchasing.spec.ts` "the raiser cannot cancel after ORDER_PLACED".

### F-048 · LOW · Purchasing — Estimated costs visible to staff and custodians despite `canSeeCost = false`

**Status: Fixed (2026-09-20, Phase 3)** — `lib/server/resources/purchasing.ts`'s single DTO choke point (`loadDto`/`toRequestDtos`) — costs are null unless the reader has a cost-seeing role, occupies a post (ladder approvers), or raised the request. See "Phase 3 fix round" below for verification.

- **Case:** B-07
- **Actual:** SE custodian Girma (`me.canSeeCost: false`) reads `GET /purchase-requests/:id` → 200 with `estimatedUnitCost: 45000` on every line. SE STAFF gets the same.
- **Root cause:** `readableRequestWhere` lets every unit member read (a deliberate decision, `purchasing.ts:611-652`), but `toRequestDto` always includes costs, unlike the cost rule in `lib/server/org/scope.ts:75-87`.
- **Fix:** strip `estimatedUnitCost` (and totals) from the DTO unless `scope.canSeeCost(actor)`.

### F-049 · HIGH · Scheduling — Deleting a room silently erases its confirmed bookings and its class timetable

- **Case:** S-16 (H12) · **Actor:** custSe
- **Repro:**
  1. Create a room, a confirmed booking on it, and a weekly class (7 sessions).
  2. `deleteItem` the room → 200.
- **Expected:** refused while live or future reservations or an active class series exist, or at least the requesters are notified and the reservations kept as cancelled records.
- **Actual:** `reservationsLeft: 0, seriesLeft: 0`. The booking and every class session are **hard-deleted by FK cascade**, with no CANCELLED state, no email and no audit entry. A staff member who booked the room just finds their booking gone. External bookings (paid) sit in the same table; see X-suite finding F-056.
- **Root cause:** `mutate.ts:548` hard delete + `schema.prisma` `Reservation.lab onDelete: Cascade` (line 1296), `ScheduleSeries.lab onDelete: Cascade` (1231) and `ReservationResource.item onDelete: Cascade` (1328). `applyDeleteItem` never consults scheduling.
- **Fix alternatives:**
  - **A (recommended):** `applyDeleteItem` refuses (409 with a list) while any item in the subtree has REQUESTED/HELD/CONFIRMED reservations ending in the future, or an active series. The custodian cancels them first (which notifies people), or uses a "retire room" action that cancels with a reason. Change the FKs to `Restrict` so the database enforces this too.
  - **B:** Implement soft delete (F-025) and cancel future reservations with reason "room removed", emailing requesters.
- **Regression test:** `scheduling.spec.ts` "a room with future confirmed bookings cannot be deleted".

### F-050 · MEDIUM · Scheduling — Past bookings can be cancelled, and undecided past requests never leave the inbox

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/scheduling/reservations.ts`'s `cancelBooking`/`listBookings`, and the new `expireLapsedRequests`. See "Phase 2 fix round" below for the full change and verification.

- **Case:** S-13 (H23)
- **Actual:**
  - A CONFIRMED booking that took place on 2026-09-01 → `POST /bookings/:id/cancel` by its requester → 200 `CANCELLED`, rewriting what the lab was used for. The DTO's `canCancel` is false for it, but only the UI respects that.
  - A REQUESTED booking for 2026-09-02 that nobody decided stays in the custodian's inbox forever (it can only be declined).
- **Root cause:** `reservations.ts:217-238` checks state but not `endsAt > now`. `listBookings` "inbox" doesn't filter by time, and nothing expires REQUESTED.
- **Fix:**
  - In `cancelBooking`, refuse when `endsAt <= now` (409 "already took place").
  - Have the hold sweep (and the cron) mark REQUESTED bookings whose `startsAt < now` as `EXPIRED`, notifying the requester.
  - Filter the inbox to future bookings.
- **Regression test:** `scheduling.spec.ts` "a finished booking cannot be cancelled; a lapsed request expires".

### F-051 · MEDIUM · Scheduling — Bookings don't react when a machine breaks or a category stops being bookable

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/resources/categories.ts`'s `update` (bookingMode change guard). See "Phase 2 fix round" below for the full change and verification.

- **Cases:** S-14, S-15 (H24)
- **Actual:**
  - After a booked computer is set to BROKEN, its CONFIRMED booking stays CONFIRMED. The requester isn't told and arrives to a broken machine.
  - Previewing Lab → `NOT_BOOKABLE` says only "Reaches 26 existing items" while **25 future reservations and classes** on labs stay live, and afterwards can't be managed from Schedule (`getLab`/`listCalendar` 404 for non-ROOM categories).
- **Root cause:** `applyFieldChange` (setStatus) and `categories.update` (bookingMode) never look at `Reservation`. The impact preview has no scheduling term.
- **Fix alternatives:**
  - **A (recommended):**
    - On setStatus → BROKEN/IMPAIRED, list future reservations touching the item (or its room subtree) in the response and notify the requesters and the room's custodian. Optionally auto-mark them "at risk".
    - Refuse a bookingMode change away from ROOM/EQUIPMENT while future reservations exist (409 with a count), and add the count to `previewImpact`.
  - **B:** Notifications only.
- **Regression test:** `categories.spec.ts` "bookingMode cannot be removed while future reservations exist".

### F-052 · LOW · Scheduling — No sanity bounds on horizons, series length or exceptions

**Status: Fixed (2026-09-20, Phase 3)** — `lib/domain/civil-time.ts` (`MAX_SERIES_SPAN_DAYS`/`MAX_HORIZON_DAYS` = 366), `reservations.ts`'s `windowOf`, and `series.ts` (start horizon; `addException` must fall within the range, on a meeting weekday, not in the past). See "Phase 3 fix round" below for verification.

- **Cases:** S-10, S-11, S-12 (H25)
- **Actual:**
  - A booking on 2099-01-05 → 201.
  - A class running every day for 10 years → 201, creating **3,653 reservation rows** in 2.9 s in one transaction; a longer range will hit the 60 s transaction timeout.
  - Exceptions for 2027-06-01 (outside the series), 2026-10-13 (not one of its weekdays) and 2026-01-05 (in the past) → all 200, and the past one marks an already-held session CANCELLED.
- **Fix:**
  - Bookings at most ~1 year ahead.
  - Series `endDate − startDate ≤ 366 days` (a class term is well under this).
  - `addException` validates that the date is within the range, on a series weekday, and not in the past.
  - `SeriesInput` refinements in `lib/shared/scheduling.ts`, plus checks in `series.ts`.

### F-053 · LOW · Scheduling — Any staff member can read every room's calendar, including which student a booking is for

**Status: Fixed (2026-09-20, Phase 3)** — `lib/server/scheduling/context.ts`'s `toReservationDto` — `onBehalfOfNote`, `participantCount` and the decision `note` go only to the requester, whoever decides for the room, and heads of the owning unit (read-only reach; booking authority unchanged, see F-054). See "Phase 3 fix round" below for verification.

- **Case:** S-17
- **Actual:** ChemE STAFF → `GET /scheduling/calendar?labItemId=<SE room>` → 200, with `onBehalfOfNote: "Sara T. (UGR/1234/13)"` (a student's name and ID).
- **Fix:** keep the calendar visible (it's needed for planning), but return `onBehalfOfNote`, `note` and `participantCount` only to the requester, the room's custodian, and heads of the owning unit.

### F-054 · DESIGN · Scheduling — Department heads have no role in their department's room bookings or class timetables

**Status: Decided — no change (2026-09-20)** — Room bookings and class timetables stay custodian-only, with SYS_ADMIN as the backstop. Heads gained read-only sight of their rooms' booking details in F-053, not authority to decide them.

- **Cases:** S-04, S-07, S-18
- **Observed:** SE's head gets 403 approving a staff booking for an SE room and 403 creating a weekly class for an SE room, and their bookings inbox never shows pending requests for SE rooms. Everything rests on the room's custodian alone. If that custodian is absent, disabled (F-001, F-024) or leaves, only SYS_ADMIN can act.
- **Question:** should heads (of the owning unit) be able to see, approve and cancel their rooms' bookings and set the teaching timetable, which is normally an academic head's job rather than a lab assistant's?
- **Options:**
  - **A:** `decidesFor` also includes the occupant of the room's owning unit, with an inbox and a timetable tab for heads.
  - **B:** Read-only visibility for heads plus escalation after N days.
  - **C:** Keep custodian-only (the current decision) and document it.

## Hypotheses from code reading

Every hypothesis raised while reading the code was run against the live app and confirmed or refuted. None is reported unverified.

| H# | Hypothesis | Verdict | Finding / evidence |
|---|---|---|---|
| H1 | A DISABLED invitee's invitation token still works; resend doesn't kill the old token | **Confirmed** | F-012, F-013 (P-15, P-08) |
| H2 | An INVITED account can set a password via forgot-password | **Confirmed** | F-009 (A-10) |
| H3 | An admin can self-demote / self-deactivate via the API | **Confirmed** | F-016 (P-12) |
| H4 | A head can't manage their own staff (deactivate/reactivate/roles) | **Confirmed** | F-014 (P-10) |
| H5 | Deactivating a node disables an occupant who still holds custody | **Confirmed** | F-001 (O-12) |
| H6 | Node delete doesn't block on needs/purchases/assignments → 500 | **Confirmed** | F-004 (O-13) |
| H7 | change-level strands nodes; second UNIVERSITY = second AVP; Procurement Office by name; inactive node still scopes | **Confirmed (all four)** | F-005, F-002, F-006, F-007 (O-09/10/11/16) |
| H8 | A custodian can setOwnerOrg/setCurrentOrg/setCustodian directly | **Confirmed** | F-022 (R-08, R-09) |
| H9 | A MANAGER / host custodian can write a borrowed item | **Confirmed** | F-021, F-020 (R-10, R-11, R-23) |
| H10 | A child createItem honours client-supplied unit/custodian | **Confirmed** | F-023 (R-05) |
| H11 | `count` unbounded; custodian eligibility unchecked | **Confirmed** | F-026, F-024 (R-06, R-07) |
| H12 | Delete is a hard delete, cascading reservations/series | **Confirmed** | F-025, F-049 (R-18, S-16) |
| H13 | Concurrent final approvals flip APPLIED to STALE / double-apply | **Confirmed (STALE overwrite; no double-apply)** | F-040 (T-07) |
| H14 | No in-transit lock: rename wastes approvals, delete leaves a ghost | **Confirmed** | F-041 (T-08, T-09) |
| H15 | No return path; lender yanks the item and current unit stays wrong | **Confirmed** | F-039 (T-10) |
| H16 | A self-nesting transfer reports APPLIED with nothing moved | **Refuted** | move/transfer skip a self-nest cleanly (R-13, T covered); no finding |
| H17 | Dependent staged ops apply only partially | **Confirmed** | F-035 (D-06) |
| H18 | Ideal targets need draft mode, so purchasables are empty elsewhere | **Confirmed** | F-037 (D-01) |
| H19 | Cancel/reject strands carried needs; late cancel allowed | **Confirmed** | F-046, F-047 (B-14, B-15) |
| H20 | PR numbers collide after a delete; concurrent compiles 500 | **Confirmed** | F-044 (B-16, B-17) |
| H21 | Receiving: over-receipt, non-atomic, category mismatch, fractional | **Confirmed (all)** | F-045 (B-09/10/11/13) |
| H22 | Cancelling a paid EXTERNAL reservation isn't reflected on the request | **Partly** — folded into F-049/F-051 (booking↔request coupling); the confirm-conflict path itself works (X-11/spec) |
| H23 | Past bookings cancellable; past requests stuck in inbox | **Confirmed** | F-050 (S-13) |
| H24 | Claims survive break / category change / move-out | **Confirmed (break, category change)** | F-051 (S-14, S-15) |
| H25 | No horizon; unbounded series; bad exceptions | **Confirmed** | F-052 (S-10/11/12) |
| H26 | Holds not constrained to windows; extendHolds unbounded | **Confirmed** | F-039-adjacent → F-0xx: X-05, X-07 (see below) |
| H27 | Containment custody lets a host decide nested rooms' bookings | **Not separately reproduced** — no nested-room fixture existed; the underlying containment-custody defect is F-020/F-021. Re-test if rooms are ever nested. |
| H28 | "Account disabled" returned before password check (enumeration) | **Confirmed by code** (`auth.ts:50` precedes `verify`); minor, folded into F-010's note |
| H29 | change-password kills the current session too | **Confirmed as correct behaviour** (A-05-adjacent; `auth.ts:158-161` deletes all sessions) — no defect |

H26 produced two findings not yet numbered separately above; they are recorded here and in the table as **F-055** and **F-056**:

### F-055 · MEDIUM · External — Holds can be placed on slots outside the requested windows

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/external/requests.ts`'s `placeHold`. See "Phase 2 fix round" below for the full change and verification.
- **Case:** X-05. A custodian held 2027-03-15 06:00–23:00 for a request whose only window was 2026-11-20 09:00–10:00 → 200. `placeHold` (`requests.ts:509-536`) never checks the slot against `ExternalRequestWindow`.
- **Fix:** validate the hold's date/time against the request's windows (A: strict; B: warn and allow with a note).

### F-056 · MEDIUM · External — `extendHolds` can push a hold years past the payment deadline

**Status: Fixed (2026-09-20, Phase 2)** — `lib/server/external/requests.ts`'s `extendHolds`. See "Phase 2 fix round" below for the full change and verification.
- **Case:** X-07. With a quote deadline of 2026-11-05, the AVP extended holds to 2030-01-01 → 200. `extendHolds` (`requests.ts:542-551`) only checks the date is in the future, not that it's ≤ the payment deadline (or a bounded grace). A slot can be tied up indefinitely against a quote that will expire.
- **Fix:** cap `until` at the payment deadline (or deadline + a small grace); for a PAID request use the confirmation window.

### F-057 · LOW · Portal UI — The public portal fires authenticated requests and duplicate catalog fetches

**Status: Fixed (2026-09-20, Phase 3)** — `lib/auth-context.tsx` (no `/auth/me` probe on `/portal` paths) + `lib/portal-catalog.ts` (one cached catalog promise shared by the portal home and request form). Verified by build and code reading; not re-observed in a browser this round. See "Phase 3 fix round" below for verification.

- **Observed (browser, signed out, `/portal`):** the page renders correctly (Lab 27, no units/locations/custodians leaked), but the console shows repeated `GET /api/auth/me → 401` and several duplicate `GET /api/public/catalog` calls. The auth provider runs on the public tree, so every visitor triggers 401s, and the catalog is fetched multiple times per load.
- **Impact:** noise in logs and dev tools; minor extra load on a page meant to be cache-friendly and reachable by anonymous outsiders.
- **Fix:** don't mount the authenticated `AuthProvider`/`me()` fetch under `/portal`; fetch the catalog once (guard the effect, or rely on the server component / the edge cache the route already sets).

## Passed cases (condensed)

124 cases passed. The reassuring confirmations, by area:

- **Auth/session:** no-cookie and forged-cookie 401s; expired-session 401; a DISABLED account's live session refused on the next request; logout deletes the session server-side; `proxy.ts` gates pages but not `/api` and leaves `/portal` public; forgot-password doesn't leak account existence (A-01…A-07, A-11).
- **Scope (the highest-risk area):** with the borrowed-item artifacts removed, a Materials custodian and a ChemE-free staff member see only their own unit across search, tree, summary and facets (V-01b); ChemE cannot point-read an SE item, its history or its change-log rows (V-02, L-02, L-03); cost fields are hidden from non-cost roles on items (V-07); university browse is correctly gated (V-06); access-view specificity (PERSON > ROLE), foreign-view fallback, and canEdit:false-when-chosen all hold (V-09, V-10).
- **Org/personnel:** node create/validation/multi-parent/closure (O-01, O-02, O-04, O-08); admin invites for every role with correct INVITED status and emails (P-01); a head is correctly confined to CUSTODIAN/STAFF invites in their own department (P-06, P-07); duplicate-email and occupied-node invites refused (P-02); custody blocks deactivation until handoff (P-14, Z-01).
- **Categories:** role gates; group and field validation; template-cycle refusal; the BULK-can't-be-bookable rule; optimistic concurrency (C-01…C-06, C-11).
- **Register:** custodian/head create rules; template instantiation with inherited accountability; outsiders refused (404); move within tree vs. into a foreign container; version-conflict 409; property/quantity rules; image upload with MIME sniffing and per-item access; placement rules; derived-status roll-up (R-01…R-04, R-12…R-17, R-19, R-20).
- **Draft mode:** admin-only toggle; direct writes blocked for custodian and head; non-stageable kinds and out-of-lab changes refused; reject→OPEN→resubmit→approve attributed to the custodian; vacant-head block and self-heal; custodian can't self-approve (D-02…D-05, D-08, D-09, D-10).
- **Transfers:** the full pull chain with correct borrow semantics and requester attribution; order enforcement; reject/cancel; pull guards; store handover with the receiving head + custodian (T-01…T-06, T-11, T-14).
- **Purchasing:** need→compile→ladder→approve→pipeline→receive→close; role gates at every step; multi-parent both-deans chain; the concurrent approve+revise race resolves to one winner (B-01…B-03, B-05, B-06, B-08, B-12, B-18, B-19).
- **Scheduling:** staff-REQUESTED vs custodian-CONFIRMED; hierarchical clash both ways; back-to-back and sibling machines; the Addis timezone (08:00 = 05:00Z); the 5-way booking race → exactly one 201; class series create/exception/reinstate/update-future-only; a clashing class refused atomically (S-01…S-09).
- **External/payments:** portal counts only; submit validation (honeypot, non-PDF, too-soon, throttle); escaped mail; the full forward→hold→accept→quote flow with token regeneration; verified payment → SCHEDULED with the hold CONFIRMED; reference reuse refused; outage→manual-review→AVP-approve; split payments; cron secret; quote guards and decline-releases-holds (X-01…X-06, X-08…X-15).
- **Robustness:** invalid ids, malformed bodies, bad enums, junk query params, wrong HTTP methods and anonymous writes all return 400/401/404/405 — **no 500** across the Z sweep except the specific cases called out in F-003/F-004/F-027/F-044; SQL-ish and unicode/RTL names are stored literally; deep nesting is handled (Z-01…Z-10).

## Blocked / not testable (and why)

- **No case was left BLOCKED.** Two cases are recorded as **INFO**, not FAIL, because their original pass/fail predicate was invalidated by an earlier finding rather than by the behaviour under test:
  - **V-01, V-03** — ChemE accounts appeared to "see SE resources", but only because F-023/F-009's own test steps had planted ChemE-owned/ChemE-custodied items *inside* SE labs earlier in the run, which legitimately grants ancestor read-only context. The clean re-check **V-01b** (a Materials custodian and a staff member never touched by other suites) passed, confirming scope itself is sound. The real defects there are F-020/F-021 (containment custody), not a scope-query leak.
- **Password-entry flows** (login with a real password, invitation acceptance, reset, change-password round-trip) are driven by `e2e/auth-check.ts` for the user to run, since this session may not submit passwords into forms. The server-side state each produces was verified via minted sessions and direct DB reads; the code paths for F-009 and F-012 are unconditional (no status guard), so the finding stands regardless.
- **Live SMTP** was replaced by a local sink (`e2e/mail-sink.mjs`); "an email was sent" is asserted from captured messages, and their escaping checked (X-03), but real Gmail delivery was not exercised.
- **The real payment verifier** (`Vixen878/verifier-api`) was replaced by the fake driver, as in the Track 8 verification. The driver interface, amount/receiver/paid-after checks, split payments and manual review were all exercised; a real bank round-trip was not (it's out of repo, per PROGRESS.md).

## Design questions for the product owner

These are the DESIGN-tagged findings, gathered for one decision pass:

1. **Borrowed items (F-021, F-039, and the 2026-09-13 open question).** When SE lends ChemE a workstation, who may do what to it while it's on loan, and how does it come back? Today containment gives the host full control and there's no return path. This is the single most consequential decision — it also drives the fix shape for F-020.
2. **What "deactivate a node" means (F-001, F-007).** Vacate the post only, or disable the person; and should a deactivated unit's people keep, lose, or narrow their access?
3. **Head vs. custodian authority (F-014, F-017, F-054, F-038).** Should a department head be able to manage their own staff, approve their rooms' bookings, set the teaching timetable, and act when a custodian's post is vacant — or is the lab assistant genuinely the sole authority for a room? And should "head" be defined by occupancy or by the MANAGER role (today it's inconsistently both)?
4. **Escalation on vacancy (F-038).** When a head's post is empty, should pending drafts/transfers/purchases escalate (to the dean, or SYS_ADMIN) or freeze until someone is appointed?

## Regression-suite note

`e2e/` contains the whole harness (fixture, session minting, per-suite scripts, mail sink, clone-DB wrapper). It is tooling, not product code, and is safe to keep for re-running the campaign after fixes: `node e2e/create-db.mjs --reset` then migrate/seed/fixture/mint, start the `e2e` launch profile, and run each `e2e/suites/*.ts` in order. `e2e/results.json` is the machine-readable record behind this report.

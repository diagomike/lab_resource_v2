# End-to-end lab lifecycle walkthrough — run log (2026-09-13)

Plan: `~/.claude/plans/i-have-added-multiple-federated-reddy.md`. Branch `track-3-transfers`.

**Result: all 11 scenes (S0–S10) pass.** Two defects were found and fixed during the run, and each fix got a regression test. The run also left 2 open usability findings and 1 design question.

## How it was run

- **Data:** the real local SE/ChemE data. `prisma/e2e-workflow-fixture.ts --setup` added the missing posts:
  - the CoEEC dean, reactivated and occupying CoEEC;
  - a store keeper;
  - known passwords for the dean, store keeper and procurement officer.
- **Teardown:** `--teardown` restored every prior value and removed every workflow row and run-created item. Counts after teardown equal counts before setup.
- **Server:** the already-running `next dev` on :3000. It was another session's, so it wasn't restarted; Turbopack hot-reloaded every edit.
- **Driver:** nobody had this session's window open, so the Browser pane could not draw. That ruled out screenshots and coordinate clicks. The UI was driven instead by dispatching real DOM events on the rendered React components:
  - `click`;
  - native-setter `input`/`change`.
  
  That exercises the same handlers, fetches and re-renders a person's clicks do. Every scene's outcome was read back from the rendered page **and** confirmed in Postgres.
- **To watch it yourself:** re-run `--setup`, sign in as the cast below, then `--teardown`.

| Actor | Account (`astu1234`) |
|---|---|
| Admin / University (AVP step) | admin@astu.edu.et |
| SE head | head.se@astu.edu.et |
| ChemE head | head.chem@astu.edu.et |
| SE custodian (Girma Wolde) | custodian.se@astu.edu.et |
| ChemE custodian (Hanna Bekele) | custodian.chem@astu.edu.et |
| CoEEC dean | dean.coeec@astu.edu.et |
| Procurement | procurement@astu.edu.et |
| Store keeper | storekeeper@astu.edu.et |

## Scenes

### S0 — admin set-up · PASS
- **SE draft mode:** Org Studio → Software Engineering → "Resource drafts" on. DB `draftWorkflowEnabled = true`.
- **Main Store custody:** Register → ASTU Main Store → Change this… → Custody. The picker offers "Main Store Keeper", an account that has never held anything (A5). After applying, the custodian is the store keeper and the change is logged as `setCustodian` with its note.

### S1 — custodian builds a lab, ideal first (Girma) · PASS
- **New lab:** + Add resources → Lab, top level, "E2E Robotics Lab". It is created directly (new roots are exempt from draft mode) and owned by SE, held by Girma.
- **Ideal targets:** Manage draft… shows the new "Add resource" kind (A1).
  - E2E Robotics Lab: Computer 6, Monitor 6, Chair 10 → Submit ideal.
  - SE Lab X Software Lab 3: Computer 8, Monitor 8 → Submit ideal.
- DB: 2 PENDING IDEAL lab commits.

### S2 — head approves ideal (head.se) · PASS
- The Lab commits inbox shows readable diffs, e.g. "Ideal target → 6 × Computer".
- Both approved through the confirm dialog, creating 5 `LabIdealTarget` rows.

### S3 — current data in drafts, with a reject-and-fix cycle · PASS
- **Staging:** Girma stages Add 4 × Computer, 3 × Monitor, 10 × Chair.
- **Draft-mode block:** a direct `POST /api/resources/items/changes` from Girma's session returns **403** ("Software Engineering uses draft mode…").
- **Reject:** head.se rejects with "Chairs: count is 8, not 10". The 3 drafts go back to OPEN and no items are created.
- **Fix and resubmit:** Girma sees the reason, withdraws the chair line, stages 8 × Chair and resubmits. head.se approves. The lab now has 4 Computers (each with its template parts), 3 Monitors and 8 Chairs, all held by Girma and logged with Girma as actor.
- **Status change:** Girma stages Computer 01 → BROKEN, and head.se approves.
- **Ideal vs actual:** Computer 6/4 (1 broken), Monitor 6/7, Chair 10/8.
  - The Monitor count is 7 because each Computer template includes a Monitor. That's by design.

### S4 — cross-department transfer, with a reject cycle · PASS
- **Destination search:** it shows who holds each lab ("Chemical Engineering · held by Hanna Bekele").
- **Rejected attempt:** Computer 01 → Mechanical Unit Operations Laboratory. Chain: custodian step self-skipped → Head SE → Receiving head ChemE → Confirm receipt. head.se approves, head.chem rejects ("No bench space…"). The item is untouched.
- **Applied attempt:** Chair 01. The preview matches the chain, and no Hand-over option appears for a custodian. Both heads approve, and the item has not moved yet. Girma clicks "Confirm receipt", which applies the transfer:
  - location: the ChemE lab, current unit ChemE;
  - owner still SE, custodian still Girma (a borrow);
  - logged with Girma as actor.

### S5 — head computes purchasables and compiles (head.se) · PASS
- **Compute from labs' ideal vs current (A2):**

  | Category | Ideal / current | Gap | Broken | Note |
  |---|---|---|---|---|
  | Chair | 10 / 7 | 3 | — | Reflects the S4 loan |
  | Computer | 14 / 15 | 2 | 4 | SE Lab X's surplus does not cancel E2E's gap |
  | Monitor | 14 / 18 | 0 | 1 | |

- **Fill request lines**, with "include broken" ticked: Chair 3, Computer 6, Monitor 1, each with a per-lab justification.
- **PR-2026-001** submitted. Chain: SE head (self-skipped) → CoEEC Dean → University (admin) → Procurement Office.

### S6 — every approving body sends it back once; decline path · PASS
- **Cycle 1:** the dean sends it back ("Reduce computers by 2…"). head.se edits and resubmits with Computer 4, and the chain restarts at the dean.
- **Cycle 2:** the dean approves; the University sends it back ("Chairs: max 2…"). head.se resubmits with Chair 2; the dean and the University approve.
- **Cycle 3:** Procurement sends it back ("Split chairs to next quarter"). head.se removes the Chair line and resubmits. The dean, the University and Procurement approve → **ORDER_PLACED**.
- **History:** every submission, send-back (with its step and reason), resubmission and approval is recorded (A3).
- **Decline path:** PR-2026-002 "E2E reject test" is rejected by the dean. It is final: the card shows no actions, plus the reason and history.

### S7 — pipeline and visibility · PASS
- Procurement advances three times, with notes, to **IN_STORE**.
- The "Purchase request status" panel, `box=tracking` and `GET /purchase-requests/:id` all agree:
  - **Can read:** Girma (SE member), the dean and the store keeper — all history visible.
  - **Cannot read:** head.chem and Hanna — panel empty, direct GET **404**.

### S8 — store intake (store keeper) · PASS
- Receive panel: Computer 2 + 2 (showing "received 2/4" in between), then Monitor 1 → **CLOSED** ("Every line registered.").
- 5 new root items in ASTU Main Store, held by the store keeper, owned by the University, each noted "Received against purchase request PR-2026-001".

### S9 — store hands stock to the lab · PASS (after fix #2)
- **Selection:** two received Computers ticked → Transfer… → "Transfer 2 resources". "Hand over to Girma Wolde and Software Engineering" is on by default for the store keeper. Preview: "Receiving head — Software Engineering → Receiving custodian accepts".
- **Rejected attempt:** head.se rejects ("Wrong lab…").
- **Applied attempt:** the store keeper re-requests and head.se approves. The items stay in the store until Girma clicks "Accept into my custody". Then:
  - both Computers sit under E2E Robotics Lab, owned by SE, current unit SE, custodian Girma;
  - their 8 nested parts moved intact with the same accountability;
  - `transferItem`, `setOwnerOrg` and `setCustodian` are logged in one batch.
- **Gap check:** the Computer gap is now 0 in both Girma's lab view (6/6) and the head's purchasables (it was 2).

### S10 — close-out · PASS
- **Browser errors:** only the 3 deliberate probes (the draft-mode 403 and the two outsider 404s). No 5xx; the dev-server log is clean.
- **Teardown:**
  - counts back to baseline;
  - dean and store keeper disabled, CoEEC vacant;
  - Main Store custody back with admin;
  - SE draft mode off.
- **Final gate:** `tsc` clean, `npm test` **353/353**, `npm run build` clean.
  - One full-suite run failed a single `views.spec.ts` case that passes in isolation. That is the documented shared-dev-DB flakiness; the next full run was green.

## Defects found and fixed during the run

1. **Tree selection flattened on bulk move/transfer (S9, pre-existing for Move).**
   - **Cause:** ticking a row ticks its whole subtree. Bulk Move and the new bulk Transfer treated every ticked id as a root, which would re-parent RAM, cables and so on directly into the destination, or refuse the whole move on placement.
   - **Fix:** `mutate.ts`'s `topMostItemIds` collapses selections to top-most items. It is used by `applyMoveInTree`, `applyTransferItem`, `previewTransfer` and `requestTransfer`, and the Register now sends and labels top-most ids.
   - **Test:** `approvals.spec.ts` "a tree selection…". Nothing had been submitted before the fix.
2. **Duplicated wording in purchase history (S6).** "Sent back for revision — Sent back for revision — College…". Notes now read "<step>: <reason>" beside the stage label; the spec was updated.

## Open findings (not fixed — for decision)

- **Medium — receipt naming.** Each delivery restarts numbering at 01, so a store can hold several "Computer 01"s. Received units are only distinguishable by their custodian or history. Options:
  - continue numbering from existing siblings (`instantiateMany` already takes `startIndex`);
  - or suffix the PR reference.
- **Low — Receive "Into" picker.** It lists every nested container in the store (cables, motherboards), not just places.
- **Low — rejected lab commit card.** It shows the reason but no longer lists its changes, because those rows return to draft.
- **Design question — borrowed items.** A borrowed item is editable by the host lab's custodian (custody resolves through physical containment). Chair 01 in the ChemE lab was `readOnlyContext: false` for Hanna. Decide whether borrowing should keep edits with the lender.

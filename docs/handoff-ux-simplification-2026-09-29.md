# Hand-off: simplifying LRMS v2 and fixing its UX/UI (for a fresh session)

Written 2026-09-29 at the end of an evaluation-only session (no product code changed).
Also kept at `~/.claude/plans/pasted-content-id-ac29-this-mellow-quilt.md`.
Repo: `D:\py_yaddessa\lab_resource_v2`, `master` = `origin/master` = `307b7a2`.

## 0. Read this first: how the last session went wrong

The previous session described "how the system works" from assumptions and from old
screenshots, and got several things wrong. That cost the user's trust. **Don't repeat it:**
- **Never state current behaviour without a `file:line` you have just read.** If you
  haven't read it, say "unverified".
- **Do not trust the walkthrough, guide or story documents as a description of the
  system.** That covers:
  - `docs/user-guide/**`, `docs/walkthrough/**` and its `stories/`;
  - `public/help/**` (the in-app Help built from them);
  - `lab_resource_additions`;
  - their screenshots (`docs/user-guide/img/**`, `public/help/img/**`, `docs/walkthrough/img/**`).

  They were written by earlier sessions, lag the code, and the screenshots date from Sep 24, before the
  Sep 28–29 round. Read them only to learn which screens and words exist. For how anything
  actually works, **read the code** (and run it on the clone or dev-nomail). Where a doc and
  the code disagree, the code wins, and the doc is a bug to fix later.
- The same applies to code comments and `PROGRESS.md` prose: they are leads, not proof. Confirm them in the code itself.
- **Before proposing anything, read `PROGRESS.md`'s Timeline from 2026-09-28 onward**
  (roughly line 4648 to the end) and the plan `~/.claude/plans/so-i-want-you-serialized-gadget.md`.
  Many rules you might ask about are already decided and built.
- **Wrong statements made last time (they are not true):**
  - that the purchase chain is "Head → Dean → AVP → Procurement";
  - that the transfer matrix is undecided;
  - that "a custodian books a lab they don't hold";
  - that "students ask their teacher" is current behaviour.

## 1. What the system does today (verified against code on 2026-09-29)

**Purchasing**
- **Ladder:** Head → Dean(s) → **CMD** → AVP → Procurement (`lib/server/resources/purchasing.ts:110-121`, `buildLadderSteps`).
- **Arrival:** at IN_STORE, Property Admin is emailed and creates an **import record**, either from the PR or standalone (EGP). The store keeper loads the store from it (`lib/server/resources/imports.ts`: `createImport`, `loadImportLine`, `cancelImport`).
- **Documents:** attachments on purchase requests (PDF, images, .xlsx) with size caps (`lib/server/resources/purchase-attachments.ts`, `attachment-sniff.ts`, `ATTACHMENT_LIMITS` in `lib/shared/resources/purchasing.ts`).

**Movements**, chain chosen by the movement's shape (`lib/domain/approvals.ts:401` `movementChain`):

| Shape | Chain |
|---|---|
| LOAN | item custodian → owning head → [receiving custodian] → receiving head → receipt |
| PERMANENT | … → receiving head → **CMD** → [**Property Admin** if colleges differ] → receipt |
| STORE_OUT | receiving head → Property Admin → custodian |
| FROM_STORE | keeper → receiving head → Property Admin → receipt |
| TO_STORE | owning head → Property Admin → keeper |

**Approval policies.** The `ApprovalPolicy` rows are enforced **only for transfers**
(`resolvePolicy` is used only in `lib/server/resources/approvals.ts:218`). Ordinary edits are
different:
- in a unit **with drafts on**, they stage into the lab's draft, and the head approves the
  whole batch (`lib/server/resources/mutate.ts:80-88` → `lab-versions.stageFromRegister`);
- otherwise they apply directly after `assertAuthorized`.

**Bookings.** Staff, custodians, heads and the admin *request* a room or machine, and that
room's custodian decides. Students cannot book (`lib/server/scheduling/context.ts:26`
`BOOKING_ROLES`; the `reservations.ts` header). Weekly classes live in
`lib/server/scheduling/series.ts`.

**External line** (`lib/server/external/requests.ts`):
1. The requester signs up and verifies (`app/portal/signup`, `/verify`).
2. AVP → dean(s) → head(s) (`forwardToDepartments`).
3. The head assigns custodians (`assignCustodians`), who hold rooms or machines (`finishTask`).
4. The head submits the cost and contacts (`submitDepartment`).
5. The dean reviews (`reviewAssignment`) and submits the college's answer (`submitCollege`).
6. The AVP sends the quote (`sendQuote`).
7. The requester pays, and the verifier checks it.
8. The AVP confirms the payment (`payments/verify.ts:250` `confirmPayment`), which books the holds and reveals the contacts.

**Register.** One Register with a Mine / Whole-university switch (`components/resources/RegisterPage.tsx`, `RegisterScopeSwitch.tsx`).

**The two previous sessions were real, not faked.** Checked against transcripts and the repo:
- **`271a523e`:** commits `b484343`…`43751a5`. Vitest went 554 → 563 passed, and there were 68 e2e checks in `e2e/validation-2026-09-28.json`.
- **`473cd6eb`:** commit `9dd7360` (577 passed). Neon was migrated, and the backup is at `backups/neon-prod-2026-09-29-before-attachments.dump`.
- `npx tsc --noEmit` is clean on `307b7a2`.

## 2. The direction the user set (simplify to one purpose)

**Purpose:** resource management with transparency across ASTU, plus only:
- **sharing:** loans and transfers, bookings, the weekly class timetable;
- **purchase requesting:** through to import and store;
- **external usage:** portal and payments.

Cut everything else, and make the UX simple for what remains. **The work goes on a new
branch. `master` and production (Neon/Vercel) stay untouched until the user approves.**

**Confirmed by the user:**
1. **Remove the STAFF and STUDENT roles**, and all complexity built for them. Staff and students deal with custodians outside the system.
2. **Remove Staff holdings:** the per-department "Staff holdings" place, "Hand over → To a person", and staff as custodians.
3. **Remove access views:** the admin-defined views and the sidebar picker. Replace them with a fixed rule: signed-in staff accounts read the whole university; writes follow role and custody.
4. **All approval chains stay** ("that's how the university chain of authority works"): purchase, movements, store, external, **and lab drafts**.
5. **Lab drafts stay exactly as intended:** a custodian's changes accumulate in the lab's draft, and the custodian submits **once** to the head for approval (compile, then send). Do **not** add a "submit now" default. Only the *Lab states page / its complexity* is up for simplification, not the draft-and-approve mechanism.
6. **Lab ideals are replaced by need requests.** Custodians raise needs that describe the lab's plan and requirements, and the head works out the department's requirements (the purchase request) from those needs. So "ideal" versions go, and needs become richer.
7. **Needs are raised by custodians only**, not staff.
8. **Bookings:** a custodian books **their own** labs and machines on someone's behalf and gives a reason (staff and students ask the custodian outside the system). Weekly class timetables stay. External holds stay.
9. **External portal and payment verification stay** as built.

**Still to confirm with the user before building:**
- **Needs (from 6):** what a richer need carries (per lab? category + qty + justification? attachments?), and how the head's compile screen uses them. Today's compile pre-fills from ideals: see `CompilePanel` in `components/resources/PurchasingPage.tsx` and `lib/domain/purchasing.ts`.
- **Bookings (from 8):** is a custodian's booking of their own resource confirmed instantly? (Probably yes.)
- **Lab states page:** the draft editing and submit needs a home. Options are a lab detail view or a Register mode. Ask the user to pick.
- **Production data** before any schema drop: how many users hold only STAFF or STUDENT, how many items sit in Staff-holdings places, how many ideals and access views are live. Report the counts and ask first.

## 3. The UX yardstick to evaluate against

Use these established rules and cite them per finding:
- **[Nielsen's 10 heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/):** system status; real-world language (no jargon); user control (undo, exits); consistency; error prevention; recognition over recall; efficiency; minimalism; error recovery; help.
- **[NN/g error-message guidelines](https://www.nngroup.com/articles/error-message-guidelines/):** show the message next to its source, in plain language, with a fix; preserve the user's input; never fail silently.
- **[Shneiderman's 8 golden rules](https://ixdf.org/literature/article/shneiderman-s-eight-golden-rules-will-help-you-design-better-interfaces):** especially informative feedback, dialogs that yield closure, and easy reversal.
- **[Laws of UX](https://lawsofux.com/):** Hick (fewer choices), Miller and cognitive load (chunking), Jakob (familiar patterns), Fitts (target size), Doherty (<400 ms), Zeigarnik (keep unfinished work visible), Tesler (the system absorbs the complexity).
- **[WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/):** text contrast ≥ 4.5:1; visible focus; targets ≥ 24 px; controls have names and roles; meaning is never conveyed by symbol or hover alone.
- **[Enterprise data tables (Pencil & Paper)](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables)** and **[NN/g bulk actions](https://www.nngroup.com/videos/bulk-actions-design-guidelines/):** sticky header, sortable columns, column chooser, a contextual bulk bar holding only the common actions, remembered view state, export.

## 4. Findings already verified in code (a starting list; re-check each)

| Finding | Evidence | Rule broken |
|---|---|---|
| Sidebar count badges are never filled | `app/(workspace)/layout.tsx`: `const counts = {}` ("Populated once the approvals-inbox count endpoint exists") | H1, Zeigarnik |
| Notification emails open generic pages, not the item | `path: "/approvals"` etc. in `lib/server/resources/approvals.ts:761-934`, `lab-versions.ts:369,405` | H1 |
| Login always lands on the default page, ignoring the link you came from | `app/(auth)/login/page.tsx:24` → `landingPathFor`; `components/ProtectedRoute.tsx` passes no `next` | H3 |
| Every modal closes on a backdrop click, with no unsaved-changes guard anywhere | `components/ui.tsx:216`; no `beforeunload`/dirty guard in `components/**` | H5 |
| A failed inline save throws away what was typed; an invalid quantity reverts silently | `components/resources/Inspector.tsx:163-185` | NN/g "preserve input" |
| Load failures look like empty data | 22 × `.catch(() => setX([]))` (e.g. `AddModal.tsx:332,361`, `FilterBar.tsx:290`); `InlineError` with retry (`components/states/index.tsx:126`) is used 0 times | H1, H9 |
| No handling of an expired session mid-use | `lib/api.ts` throws `ApiError`; nothing handles 401 | H9 |
| The `--faint` text colour fails contrast | `app/globals.css:27` `#8496a6` = 3.05:1 on white and 2.81:1 on `panel2`; dark `#69798a` ≈ 3.8–4.0:1; used 272 times | WCAG 1.4.3 |
| Most text is tiny and targets are small | ≤ 10.5 px text classes 492× vs 11–14 px 325×; `Button` is 24 px tall (`ui.tsx:66`); `Tag` is 9.5 px | WCAG, Fitts |
| "Warn" confirmations use the red danger button | `ui.tsx:271` | consistency |
| Modals have no initial focus, focus trap or focus return; expand chevrons have no aria | `ui.tsx:185-234`; `ResourceTable.tsx:138-146` | WCAG 2.4.3 / 4.1.2 |
| Register table has no sorting, no sticky header, no column chooser | `components/resources/ResourceTable.tsx` (display columns only; plain `<thead>`) | table practice |
| The bulk bar holds 9 inline controls; bulk rename works on Enter only | `RegisterPage.tsx:224-318` | Hick, table practice |
| Scope and mode switches look identical side by side | `RegisterPage.tsx:183-218`, `RegisterScopeSwitch.tsx` | consistency |
| Pending markers are a bare `*` / `⇄` whose meaning is only in a hover title | `ResourceTable.tsx:159-179` | WCAG, recognition |
| Internal values shown to users | "Version" in `Inspector.tsx:408`; `scopeMeta` "L2 · leaf" in `components/shell/Sidebar.tsx`; raw role enums in `TopBar.tsx` | H2 |
| Names don't link anywhere | the only cross-links go to Lab states (`Inspector.tsx:367-386`, `LabCommitCard.tsx:94`, `ResourceTable.tsx:160`) | recognition, efficiency |
| Admins can't correct a person's name or email | no `PATCH` under `app/api/people/**` | H3 |
| No success feedback or notice system | no toast/notice component in `components/**` | Shneiderman feedback |
| Mixed icons | lucide-react used in 6 files; nav and shell use Unicode glyphs (`lib/nav.ts` `icon:`) | consistency (user asked for official icons in `Direction.md`) |
| Approvals is four stacked panels, each with its own Routed/Raised toggle | `components/resources/ApprovalsPage.tsx:36-50, 522-533` | Hick, consistency |
| Purchasing is one long stack of panels | `PurchasingPage.tsx:1058-1076` | chunking |
| One `EmptyState`, and misleading empty text | `ResourceTable.tsx:366` says "No resources match the current filters" even with no filters set | H1 |
| No export (CSV/XLSX) anywhere | grep `components/**` | audit need |

Several of these disappear once the cuts land (student landing, the access-view picker,
Staff holdings), so re-evaluate after the cuts rather than fixing them first.

## 5. How to research live (safely)

- **Rules:** never use subagents (global rule). Update `PROGRESS.md`'s Timeline after each round (see the memory). Read `node_modules/next/dist/docs/` before writing Next.js code (`AGENTS.md`).
- **Mail safety:** plain `npm run dev` on `lrms_v2` sends real mail, and 11 ARAs have real addresses. For anything that approves, books or notifies, use either:
  - the **`dev-nomail`** profile in `.claude/launch.json` (:3000, SMTP pointed at nothing, fake payment verifier); or
  - the **E2E clone**: stop :3100, run `node e2e/reset-demo.mjs`, then `node e2e/with-env.mjs npx next dev -p 3100`, plus the mail sink `e2e/mail-sink.mjs`.
- **Accounts** (password `astu1234`): `avp@`, `coeec.dean@`, `cmd@`, `cse.head@`, `se.head@`, `head.chem@`, `procurement@`, `property.admin@`, `store.keeper@astu.edu.et`, and CSE custodians such as Ali Kibret Muhamed. Use the admin account from the seed (see `prisma/seed.ts`).
- **Sessions for scripted checks:** `e2e/mint-one.ts` / `mint-sessions.ts`. Flow drivers: `e2e/validate-approval-lines.ts` (re-run it after changes; 68 checks) and `e2e/drive-cse-cycle.ts`.
- **Tests:** `npm test` runs on `lrms_v2_test` only. Gates: `npx tsc --noEmit`, `npm run build`.
- **Visual pass:** screenshot each screen per role at 1280 px and phone width, in both themes. Time the Whole-university register load (Doherty threshold) and check console errors. Re-check contrast with a small script over the `globals.css` tokens.
- **Help and guide:** sources are in `docs/user-guide/*.md`; `npm run help:build` rebuilds `public/help/content.json`. Screenshots need retaking after UI changes.

## 6. Suggested order for the next session

1. **Re-read** §0–§2, the Sep-28 onward Timeline, and the approval-line plan. Confirm §2's open questions with the user.
2. **Branch** off `307b7a2` (e.g. `simplify/core`). Write the decisions (§2) into `docs/decisions/` and `PROGRESS.md`.
3. **Cut, in order:**
   - STAFF/STUDENT roles and Staff holdings;
   - access views, replaced by the fixed read rule;
   - ideals, replaced by richer custodian needs feeding the head's compile;
   - bookings, changed to custodians booking their own resources with a reason.

   Keep all approval chains, lab drafts included.
4. **Re-evaluate the UX** of the reduced surface against §3. Work through §4 (verified first), fixing silent failures and lost input before visual polish.
5. **Rewrite docs and Help** for the remaining roles, and retake screenshots.
6. **Schema clean-up migration last.** Report counts, back up dev and Neon, and get the user's explicit go-ahead. Production is a separate, confirmed step.

## 7. Where things live

- **Shell and nav:** `app/(workspace)/layout.tsx`, `components/shell/{Sidebar,TopBar,StatusBar,ContentHeader}.tsx`, `lib/nav.ts`.
- **UI primitives:** `components/ui.tsx`, `components/states/index.tsx`, `tailwind.config.js`, `app/globals.css`.
- **Register:** `components/resources/{RegisterPage,ResourceTable,FilterBar,GroupByBar,Inspector,ChangeModal,AddModal,BulkPropModal,TransferModal,PullTransferModal,ReturnToStoreModal,WholeUniversityRegister}.tsx`, `lib/register/*`.
- **Labs and drafts:** `components/resources/{LabStatesPage,LabCommitCard}.tsx`, `lib/server/resources/lab-versions.ts`, `app/api/resources/labs/**`, `app/api/resources/lab-commits/**`.
- **Approvals:** `components/resources/ApprovalsPage.tsx`, `lib/server/resources/approvals.ts`, `lib/domain/approvals.ts`.
- **Purchasing:** `components/resources/{PurchasingPage,ImportsPanel,PurchaseAttachments}.tsx`, `lib/server/resources/{purchasing,imports,purchase-attachments}.ts`, `lib/domain/purchasing.ts`.
- **Scheduling:** `components/scheduling/*`, `lib/server/scheduling/*`.
- **External:** `components/external/*`, `app/portal/**`, `lib/server/external/*`, `lib/server/payments/*`.
- **People and org:** `components/admin/*`, `components/people/PeopleTable.tsx`, `components/org-studio/OrgStudioPage.tsx`, `lib/server/people/*`, `lib/server/org/*`.
- **Access views (to cut):** `components/admin/AccessViewsPage.tsx`, `lib/domain/views.ts`, `lib/server/resources/{views,views-rollout}.ts`, `lib/register/active-view.ts`, `app/api/resources/access-views/**`.
- **Staff holdings (to cut):** `lib/server/resources/staff-holdings.ts` and its callers (`grep -rn staff-holdings\|issueToUserId`).
- **Roles:** `lib/shared/enums.ts`, `prisma/schema.prisma` `RoleKind`, `lib/server/auth/session.ts`, `lib/help/audience.ts`.

# LRMS manual test plan: real CSE labs, lab states, purchasing, bookings

Prepared 22 September 2026, **rewritten 23 September 2026** after the fix round (plan: `~/.claude/plans/sorry-i-have-put-wobbly-clarke.md`, which supersedes `docs/fix-plan-2026-09-22.md`). This plan is focused and ordered. Each part builds on the data from the part before it, so run them in order. For the broader walkthrough (org chart, categories, transfers, audit), see `docs/manual-verification-2026-09-21.md`.

**What changed since run 1**
- The seed now loads the **real CSE data**: 17 ARAs holding 31 labs from `docs/cse_labs.md`, each with its current inventory. Chemical Engineering's real data stays. The synthetic SE lab, the SE survey labs and the `*@e2e.test` cast are gone. Part 1 now **verifies** CSE rather than creating it.
- **Heads don't edit resources.** Only custodians do. Heads manage people and approve. SYS_ADMIN keeps direct edit for setup and corrections.
- **Draft and Ideal are whole named trees** on the **Lab states** page, started as a copy of the lab. Draft merges into the register on approval. Ideal never merges; purchasing measures the lab against it.
- **CSE starts with drafts ON.** Every CSE edit in the register is staged into the lab's draft for the head. Chemical Engineering stays in direct mode, so both modes are covered.
- **No one-time sign-in links** (the old AUTH-03 is gone). An admin or head can instead email a reset link, set a temporary password that must be changed at next sign-in, or copy an invite link.

**How to use it**
- Each test has an ID, an **actor**, the steps, and an **Expect:** line.
- Tick the box when the result matches; otherwise record it in the results log at the bottom.
- Use a separate browser profile or private window per actor. Ordinary tabs share one login cookie.
- Prefix everything you create by hand with `MT-` so it's easy to find in the change log.

> **Mail safety.** Eleven ARAs are seeded with their **real** email addresses. Run this plan only on the E2E clone (:3100), whose mail goes to the local sink. On the dev database (`npm run dev`, :3000) the app uses real SMTP, and any notification this plan triggers would reach those people.

---

## Part 0 — A clean environment

Run from the repo root, in order:

```powershell
# terminal 1 — the mail catcher (leave running). Mail lands in e2e/mail/*.eml, listed in e2e/mail/index.jsonl
node e2e/mail-sink.mjs

# terminal 2 — rebuild the clone (DROPS lrms_v2_e2e only; the wrapper refuses to touch lrms_v2)
node e2e/create-db.mjs --reset
node e2e/with-env.mjs npx prisma migrate deploy
node e2e/with-env.mjs npx tsx prisma/seed.ts
node e2e/with-env.mjs npx tsx prisma/resource-seed.ts
node e2e/with-env.mjs npx tsx prisma/seed-policies.ts --apply

# terminal 2 — the app on http://localhost:3100 (leave running)
node e2e/with-env.mjs npx next dev -p 3100
```

Don't run `e2e/fixture.ts` for this plan. It adds the automated suites' `*@e2e.test` cast, which this plan no longer uses.

- [ ] **ENV-01** Sign in as `admin@astu.edu.et` / `astu1234`. **Expect:**
  - Org structure: ASTU → CoEEC → {Software Engineering, Computer Science and Engineering}; ASTU → CoMCME → Chemical Engineering; ASTU → Procurement Office (**active**).
  - People & roles: the admin, the role accounts below, the 17 CSE ARAs, and the Chemical Engineering people. No `@e2e.test` accounts.
  - University resources: 31 `Software Laboratory — B5xx-Rnn` labs under CSE, the Chemical Engineering labs and stores, and the **ASTU Main Store** (it starts with 3 tables and 3 chairs).

Background hold expiry runs on a cron that `next dev` does not schedule. Don't wait for holds to lapse on their own.

**Optional: the rest of the department.** To make CSE's need complete (Part 3's numbers assume it), the other 29 labs can go through the same steps as Ali's by script, through the app's own API and never the DB. See `e2e/drive-cse-cycle.ts` for the steps (`ideals`, `approve-ideals`, `handover`, `accept`, `report`, and more), run like this:

```powershell
node e2e/with-env.mjs npx tsx e2e/drive-cse-cycle.ts ideals --skip-ali
```

### Cast (all passwords `astu1234`)

Role accounts are placeholders; rename them to the real people later from People & roles.

| Role in these tests | Account | Notes |
|---|---|---|
| System admin | admin@astu.edu.et | Setup only. **Do not use admin to approve.** SYS_ADMIN can decide some things and would hide broken routing. |
| AVP (university post) | avp@astu.edu.et | Purchase approval step; owner of external requests |
| CoEEC dean | coeec.dean@astu.edu.et | Parent college of SE and CSE |
| **CSE head** | cse.head@astu.edu.et | Approves CSE drafts, ideals, handovers; compiles purchases. **Read-only on resources.** |
| **Ali Kibret Muhamed** (CSE ARA) | alikibretmuhamed@gmail.com | Custodian of **Software Laboratory — B510-R8** and **B510-R9** |
| Yohannes Alemu (CSE ARA) | yohanesalemu0069@gmail.com | Custodian of B508-R15; a second CSE custodian for cross-lab checks |
| SE head | se.head@astu.edu.et | Negative tests only (other department; SE has no labs now) |
| Procurement officer | procurement@astu.edu.et | Occupies the Procurement Office |
| Store keeper | store.keeper@astu.edu.et | Holds the ASTU Main Store |
| Chemical Eng. head | head.chem@astu.edu.et | The second department, for cross-department tests |
| Chemical Eng. custodian (Hanna Bekele) | custodian.chem@astu.edu.et | Direct mode (drafts off) |
| **MT CSE staff** | mt.staff.cse@e2e.test | *Invited in SET-04* — staff only, not a custodian |
| **MT student** | mt.student@e2e.test | *Invited in SET-04* — negative tests only |

The other 15 ARAs are listed in `prisma/cse-lab-data.ts` with their labs.

---

## Part 1 — Verify the real data, people and set-up

### 1A. Make labs and computers bookable (admin)

A fresh seed has **no** bookable category, so do this before anything that touches scheduling.

- [ ] **SET-01** Admin → Categories → **Lab**. Set booking mode **Bookable room** and turn on **public listing**. Review the impact preview, then save. **Expect:** saved, and the preview names how many labs are affected (the CSE and Chemical Engineering labs).
- [ ] **SET-02** Admin → Categories → **Computer**. Set booking mode **Bookable equipment**; leave it not public. **Expect:** saved. A bulk-counted category (e.g. Chemical) must refuse a booking mode.
- [ ] **SET-01a** Admin → Categories → new category `MT Curtains`. Open the icon picker and type `curtain`, then `blind`. **Expect:** a searchable list, each option showing its icon beside its name, and **Blinds** offered. Pick it and save. **Expect:** the Blinds icon appears in the category list and in Add resources' category picker.

### 1B. CSE and its people (admin)

- [ ] **SET-03** Admin → Org structure → **Computer Science and Engineering**. **Expect:** under CoEEC next to SE, code `CSE`, occupied by *CSE Department Head*, with **Resource drafts ON**. Chemical Engineering shows drafts OFF.
- [ ] **SET-04** Admin → People & roles → Invite:
  - `mt.staff.cse@e2e.test` (`MT CSE Staff`), role **Staff**, department CSE;
  - `mt.student@e2e.test` (`MT Student`), role **Student**, department CSE.

  **Expect:** both appear as invited, each with a copyable invite link, and two invite lines in `e2e/mail/index.jsonl`.
- [ ] **SET-04a** Close that dialog. Open **Manage** on `mt.staff.cse@e2e.test`, still invited. **Expect:** **Copy invite link** shows a fresh link, with a note that it was emailed too. The older link for the same person now reports as invalid.
- [ ] **SET-05** Open each invite link in a private window, set password `astu1234` and sign in. **Expect:** MT CSE Staff sees Register and Schedule, but no Administration menu and no edit controls. MT Student lands without Register access.
- [ ] **SET-06** Negative test: try creating a second active department named `computer science and engineering` (different case). **Expect:** a clear duplicate-name refusal. The tree is unchanged.

### 1B′. Sign-in help

Watch `e2e/mail/index.jsonl` for each email.

- [ ] **AUTH-01** Signed out → **Forgot password** → `mt.staff.cse@e2e.test`. **Expect:** a "Reset your … password" email. Its link sets a new password, and the old one stops working. Set it back to `astu1234` the same way.
- [ ] **AUTH-02** Invite a throwaway `mt.pending@e2e.test` and **don't** accept it. Use Forgot password for that address. **Expect:** the same on-screen message as AUTH-01, and the email is a **fresh invitation**, not a reset and not nothing.
- [ ] **AUTH-03** Admin → People → Manage `mt.staff.cse@e2e.test` → **Set temporary password** → confirm. **Expect:**
  - a 12-character password shown **once**, with a Copy button;
  - MT CSE Staff's open session is signed out;
  - an email telling them an admin reset their password, **without** the password in it.

  Sign in as MT CSE Staff with the temporary password. **Expect:** a **change your password** screen. Any other page, or a direct API call, is refused until it's changed. After changing it back to `astu1234`, the app works normally.
- [ ] **AUTH-04** Request four resets for one address inside an hour. **Expect:** the screen looks the same each time, but only three emails arrive.
- [ ] **AUTH-05** Admin → Manage `mt.staff.cse@e2e.test` → **Email reset link**. **Expect:** the admin sees only "sent", never the link; the person gets the email and the link works once.
  As **CSE head** → People: the same Sign-in help is offered for MT CSE Staff (CSE is the head's subtree), but **not** for Hanna Bekele (Chemical Engineering).

### 1C. The seeded CSE labs

- [ ] **SET-07** As **Ali** → Register. **Expect:** exactly his two labs, **B510-R8** and **B510-R9**, each with:
  - `Workstation 01`–`20`, each a Computer (Motherboard with RAM and Storage, Monitor, keyboard, mouse, speakers, cables), a Table and a Chair;
  - **4 PCs broken**, each by one part: R8 has 1 RAM, 2 Storage and 1 Monitor failure; R9 has 1 RAM, 1 Storage and 2 Monitor failures. The broken part's Computer and Workstation show *Impaired/Broken* through the critical-part rule;
  - more than 10 broken workstation chairs (R8: 13, R9: 12), with their workstations still Working because chairs aren't critical;
  - a Teacher Table, Teacher Chair, Whiteboard, and a Switch Rack with 2 Network Switches and `Network Outlet 01`–`20`.
- [ ] **SET-07a** A PC has **no GPU**, because the Motherboard template no longer includes one. Opening a Motherboard's **+ add** still offers GPU.
- [ ] **UI-01** As **Hanna Bekele** (direct mode) → Register → expand a Chemical Engineering lab, open an item's details, and change a field. **Expect:** no skeleton or blank flash. The table stays expanded at the same scroll position, the details panel stays open, and the value updates in place.
- [ ] **UI-02** As Hanna, open Change → **Position** for an item, and as the store keeper open **Hand over…**'s destination. **Expect:** indented tree pickers with icons that filter as you type and never show `A / B / C` paths. Owning-unit pickers nest College → Department.

### 1C′. Naming (in direct mode, Chemical Engineering)

- [ ] **SET-08** As **Hanna** → Register → **+ Add resources** inside one of her labs, category **Chair**, count 3. **Expect:** the **Name** field is pre-filled with the category name. **Preview…** lists the lab's contents with the new rows highlighted in place, numbered after any existing `Chair NN`. **Back** changes nothing; **Apply** creates them.
- [ ] **SET-08a** Add 2 more Chairs to the same lab. **Expect:** numbering continues. It never restarts at 01.
- [ ] **SET-08b** Delete the middle one of the new chairs, then add 2 more. **Expect:** the preview fills the gap first, then continues past the highest number.
- [ ] **SET-08c** Rename one new chair to the exact name of a sibling. **Expect:** refused, naming the clash. The same name in a different case or with a trailing space is refused too.
- [ ] **SET-08d** The same name in a **different** lab is allowed. Names only need to be unique among siblings (and among one unit's top-level items).

  Delete the `MT` chairs afterwards. Part 3's numbers don't involve Chemical Engineering, so the counts don't matter there.

### 1D. Ideal: each lab's target, as a tree (Lab states)

The ideal is what a lab *should* hold. Purchasing measures the lab against it. It's a full named tree, started as a copy of the lab, and it never changes the register.

- [ ] **SET-12** As **Ali** → **Lab states** → B510-R8 → **Ideal** → **Start** (a copy of the lab as it is). **+ add** at the lab's top level: category **Workstation Setup**, name `Workstation`, count **5**. **Expect:** the preview names them **Workstation 21–25**, continuing the lab's numbering. Apply. Then **+ add** inside **Switch Rack**: **Network Outlet** ×5. **Expect:** Network Outlet 21–25.
- [ ] **SET-12a** The **Proposal vs Current** table shows, per category, **Ideal · Current · Gap · Needs attention · Missing**. **Expect:** Workstation Setup 25 · 20 · 5 (needs attention 4); Computer 25 · 20 · 5; Network Outlet 25 · 20 · 5. Missing reads like `Computer ×5` and `Workstation 21, …`, with no long repeated lists. **Submit for approval.**
- [ ] **SET-13** As **SE head** → Lab states. **Expect:** Ali's labs aren't listed, and the proposal can't be decided (the API refuses too).
- [ ] **SET-14** As **CSE head** → Lab states → B510-R8 → Ideal. **Expect:** the proposal card lists `Workstation 21 … Added in Software Laboratory — B510-R8 (with 13 parts)` and `Network Outlet 21 … Added in Switch Rack`. **Approve.** **Expect:** the lab's badge reads **ideal set**, and the register is unchanged.
- [ ] **SET-15** Repeat SET-12 to SET-14 for **B510-R9**. (The other 29 labs: by hand, or `drive-cse-cycle.ts ideals --skip-ali` then `approve-ideals --skip-ali`.)

### 1E. Scope checks

- [ ] **SET-16** As **Ali** → University resources. Find a Chemical Engineering lab. **Expect:** visible read-only. No rename, status or custody editing.
- [ ] **REG-01** University resources opens **Grouped** by **Owning unit**. **Expect:** ASTU → CoEEC → Computer Science and Engineering → 31 labs → their contents; CoMCME → Chemical Engineering → its labs; the Main Store under ASTU. Each group header has counts and a status summary.
- [ ] **REG-02** Change Group by to **Category → Custodian**, then **Current unit**. **Expect:** re-nests immediately; each lab still shows its contents beneath it; reloading keeps the choice; `/register` still opens in Tree mode.
- [ ] **SET-17** As **CSE head** → Register → Ali's lab. **Expect:** read-only. No Add resources, no Change, no bulk edit, no Hand over. Heads approve; they don't edit.
- [ ] **SET-18** As **MT student** → type `/register` into the URL. **Expect:** refused or redirected. No register data.

---

## Part 2 — Status updates through the Draft

**How it works.** In a department with **Resource drafts** on (CSE), a custodian's ordinary edit in the register (status, name, quantity, properties, add, delete, move within the lab) is **staged** into that lab's **Draft**, a whole copy of the lab. The register doesn't change. The custodian can also edit the Draft directly on **Lab states → Draft**. **Submit for approval** sends it to the department head, who **approves** (everything merges in one transaction, credited to the custodian) or **sends it back** with a reason. Custody, ownership and moves out of the lab can never be staged; those go through transfers.

### 2A. Baseline: direct mode (Chemical Engineering)

- [ ] **STA-01** As **Hanna Bekele**, change an item's status to **Under maintenance** directly. **Expect:** applies instantly; the change log shows her name. Set it back to **Working**.

### 2B. Staging from the register (CSE)

- [ ] **STA-03** As **Ali** → Register → B510-R8 → Workstation 01 → Computer → **Monitor** → Change → Status **Broken**. **Expect:**
  - it is **staged, not applied and not refused**: a notice says it went into the lab's draft;
  - the Monitor row gets a **`*`** marker. Hovering shows "Status: Working → Broken", and clicking opens **Lab states → Draft** on that item;
  - **Lab states → Current** still shows the Monitor Working.

### 2C. Draft → send back → fix → approve

- [ ] **STA-04** Still as **Ali** → **Lab states → Draft** (B510-R8). **Expect:** the whole lab with the staged change marked in place, and **What it changes · 1 entry**. In the tree, set one **broken chair** to **Maintenance** and **rename** the Whiteboard to `MT Whiteboard`. **Expect:** 3 entries, each readable (e.g. "Status: Broken → Under maintenance"). **Submit for approval.** **Expect:** *Waiting for the head*; the lab list shows **draft submitted**.
- [ ] **STA-05** As **CSE head** → Lab states → B510-R8 → **Draft**. **Expect:** the same entries on the request card, with Approve and Send back. **Send back** with reason `MT: keep the whiteboard's name`. **Expect:** nothing in Current changed.
- [ ] **STA-06** As **Ali** → Lab states → Draft. **Expect:** the reason is shown and the draft is editable again. Rename the whiteboard back to `Whiteboard`. **Expect:** that entry disappears, leaving 2. Submit again.
- [ ] **STA-07** As **CSE head**, **Approve**. **Expect:**
  - the Monitor is **Broken** and the chair **Under maintenance** in Current, and the draft is closed;
  - the change log shows both edits by **Ali Kibret Muhamed**, not the head;
  - on Lab states → Ideal, B510-R8's needs-attention for Computer and Workstation Setup goes **4 → 5**, and Monitor **1 → 2**.

### 2E. Guard rails

- [ ] **STA-10** As **MT CSE staff**, open B510-R8. **Expect:** no way to edit or stage anything. Lab states shows no editable draft.
- [ ] **STA-11** As **Ali**, try a custody change on a computer, or a move of a chair into **B510-R9** (his other lab). **Expect:** refused as not stageable ("…see the transfer flow" / "reaches outside the lab"). Nothing is staged.
- [ ] **STA-12** Stale-approval check:
  - As **Ali**, stage a rename of B510-R9's `Teacher Table` to `MT Teacher Table` and submit.
  - As **admin** (SYS_ADMIN edits apply directly, even with drafts on), rename the same Teacher Table to `MT Admin Table`.
  - As **CSE head**, approve Ali's draft.

  **Expect:** the request becomes **Stale** and names the changed item. Nothing is applied, and the admin's name stays. Rename it back to `Teacher Table` as admin, and have Ali discard the draft.
- [ ] **STA-13** As **Yohannes Alemu**, open Lab states. **Expect:** only his own lab (B508-R15). Ali's drafts aren't visible or editable.

CSE drafts **stay on** for Part 3. The repair at the end of Part 3 goes through a draft too.

---

## Part 3 — The purchase path, on real need (CSE)

**The chain.** The CSE head compiles the request; the head's own step is satisfied by raising it. Then **CoEEC dean → AVP → Procurement Office**. Procurement advances the order: *Order placed on EGP → Buyer found → On delivery → Arrived at the main store*. The **store keeper** receives the stock into the Main Store and **hands it over** to each lab. The CSE head approves the handover and the lab's custodian accepts it.

The numbers below assume **all 31 labs have an approved ideal** (Part 1D, by hand or by the driver). They count a fresh seed plus Part 2's approved edit: one more broken monitor, and one broken chair moved to maintenance.

### 3A. Needs

- [ ] **PUR-01** As **MT CSE staff** → Purchasing → **Raise a need**: `MT projector for B510-R8`, qty 1, justification. **Expect:** listed under My needs as open.
- [ ] **PUR-02** As **Ali**, raise a need: `MT extra keyboards`, qty 5.
- [ ] **PUR-03** As **Hanna Bekele** → Purchasing. **Expect:** CSE's needs are not visible.

### 3B. Purchasables and compile (CSE head)

- [ ] **PUR-04** As **CSE head** → Purchasing → open needs. **Decline** the keyboards need with the reason `MT: every workstation already has one`. **Expect:** Ali sees it declined with the reason.
- [ ] **PUR-05** Purchasables for CSE. **Expect:** "31 labs with an approved ideal", and:

  | Category | Gap (ideal − current) | "Not working" |
  |---|---|---|
  | Workstation Setup | **151** | 190 |
  | Network Outlet | **155** | 0 |
  | Computer | 151 | 190 |
  | RAM | 151 | **60** |
  | Storage | 151 | **56** |
  | Monitor | 151 | **74** |
  | Chair | 151 | **412** (411 broken + 1 under maintenance) |

  Workstation 151 = 31 × 5, minus the labs that already hold more than 20. The parts inside each missing workstation show the same gap. "Broken" counts everything not working, so it includes items under maintenance.
- [ ] **PUR-06** **Compile a purchase request** `MT CSE labs to ideal + repairs`:
  - Workstation Setup ×151, Network Outlet ×155 (the gaps);
  - RAM ×60, Storage ×56, Monitor ×74, Chair ×412 (the repairs);
  - the projector need carried in, ×1.

  Try a quantity of `2.5` on a line first. **Expect:** refused (serialized items order whole units). Fix and submit.
  **Expect:** a reference `PR-2026-…`, and the chain *Head ✓ (skipped, self-raised) → CoEEC dean (current) → AVP → Procurement*.

### 3C. Send back, revise, approve

- [ ] **PUR-07** As **CoEEC dean** → Approvals → **Send back for revision** with note `MT: attach the lab list`. **Expect:** stage Revising; the CSE head is notified.
- [ ] **PUR-08** As **CSE head**, revise the justification and resubmit. **Expect:** the chain restarts at the dean; the history keeps the send-back note.
- [ ] **PUR-09** As **SE head**, try to open or decide it. **Expect:** cannot decide; costs hidden.
- [ ] **PUR-10** Approve as **CoEEC dean** → **AVP** → **Procurement officer**, each with a note. **Expect:** stage **Order placed on EGP** after the last approval.

### 3D. Procurement pipeline

- [ ] **PUR-11** As **procurement**, advance to *Buyer found*, *On delivery*, then *Arrived at the main store*, with a note each time. **Expect:** each stage is timestamped in the history. MT CSE staff can track the stage but not the costs.

### 3E. Receive into the store

- [ ] **PUR-12** As **store keeper** → Receiving → the request → receive **Workstation Setup 75** of 151. **Expect:** Received 75/151; 75 complete workstations (13 parts each) appear in the **ASTU Main Store** in the store keeper's custody. The request stays open.
- [ ] **PUR-13** Try receiving **77** more. **Expect:** refused (over-receipt). Receive **76**, then every other line (a wrong category is refused). **Expect:** every line received and the request **closes**.

### 3F. Hand over to the labs

- [ ] **PUR-14** As **store keeper** → Register → ASTU Main Store → expand **Workstation Setup ×151** → tick 5 → **Hand over…** → destination `B510-R8`. **Expect:** "Needs approval: Receiving head — CSE → Receiving custodian accepts"; **Request handover** leaves it pending, and nothing moves yet.
  Hand over R8's 5 outlets into its **Switch Rack**, and its replacement parts and chairs, the same way. Then do B510-R9.
  **Expect:** the modal's **Name them there as** suggests the lab's own name when the lab uses a numbered one (e.g. `Workstation`), and lists the names they'll arrive with. The already-promised items now show **⇄** in the store (a cluster row says "⇄ 5 promised").
- [ ] **PUR-14a** Tick one of those promised items again and **Hand over…** to B510-R9. **Expect:** refused in the modal before submitting, naming the item and "already in a pending handover to Software Laboratory — B510-R8"; **Request handover** stays disabled. (Fix for R2-1.)
- [ ] **PUR-15** As **CSE head** → Approvals → approve each B510-R8/R9 handover. As **Ali** → Approvals → **Accept into my custody** for each. **Expect:** the items sit in the lab, owned by CSE, in Ali's custody. Lab states → Ideal shows **Gap 0** for Workstation Setup and Network Outlet. Current may *exceed* ideal for Monitor, Storage and Chair while the spare parts sit loose in the lab.

### 3G. Repair through the Draft

- [ ] **PUR-16** As **Ali** → Register → B510-R8 → find a received RAM (`RAM NN`, at the lab's top level) → Change → **Position** → into the **Motherboard** of the PC whose RAM is broken. **Expect:** staged (the `*` marker), not applied. Then **Lab states → Draft** → **✕** the dead RAM. **Expect:** 2 entries: "RAM NN · Moved into Motherboard" and "RAM · Removed". Submit.
- [ ] **PUR-17** As **CSE head**, approve. **Expect:** that PC is **Working** again; R8's RAM reads 25 · 25 with 0 needing attention; Computer needs-attention drops by one; the change log credits Ali.

### 3H. Rejection and cancellation

- [ ] **PUR-18** As **MT CSE staff**, raise a need. As **CSE head**, compile it into a small request. As **CoEEC dean**, approve. As **AVP**, **Reject** with a reason. **Expect:** stage Rejected, and the carried need **reopens** with the reason shown.
- [ ] **PUR-19** As **CSE head**, compile another small request, then **cancel** it while still Approving. **Expect:** cancelled; its needs reopen. (Once it reaches Order placed, only procurement may cancel, with a note.)

---

## Part 4 — Bookings

Three kinds of booker:
- **Internal (own department)**: MT CSE staff booking a CSE lab.
- **Internal (another department)**: MT CSE staff booking a Chemical Engineering lab.
- **External**: an outside organisation, through the public portal, with a quote and payment.

**Who decides.** Staff bookings are decided by the **room's custodian**, never the head. A custodian booking their own room is auto-confirmed. Dates below assume today is Wed 23 Sep 2026. Any future dates work.

### 4A. Internal: own department

- [ ] **BKI-01** As **MT CSE staff** → Schedule → **Book** → `Software Laboratory — B510-R8` (whole room), **Mon 5 Oct, 09:00–11:00**, title `MT lecture`. **Expect:** the preview names **Ali** as decider; the booking shows **Requested**.
- [ ] **BKI-02** As **Ali** → Schedule → **My labs** → approve. **Expect:** **Confirmed**; after refresh the time is still 09:00–11:00.
- [ ] **BKI-03** As **CSE head**, find the request. **Expect:** visible, but no approve action.

### 4B. Clashes and another department

- [ ] **BKI-04** As **MT CSE staff**, book B510-R8 **Mon 5 Oct, 10:00–12:00**. **Expect:** a clash with the confirmed booking. Change to **11:00–12:00** (back-to-back). **Expect:** accepted as Requested.
- [ ] **BKI-05** As **MT CSE staff**, book one of **Hanna Bekele's** Chemical Engineering labs, **Tue 6 Oct 14:00–15:00**. As **Hanna**, **reject** it with note `MT: reserved for practicals`, then have MT CSE staff book **Wed 7 Oct 14:00–15:00** and approve that one. **Expect:** Rejected with the note, then Confirmed. Cross-department booking works.
- [ ] **BKI-06** Privacy: as **Ali**, view the Chemical Engineering calendar. **Expect:** the slots are visible, but not the on-behalf-of note or decision notes.

### 4C. Equipment inside a room

- [ ] **BKI-07** As **Ali**, book **Workstation 01's Computer** in B510-R8, **Thu 8 Oct 09:00–10:00**. **Expect:** auto-confirmed (his own room).
- [ ] **BKI-08** As **MT CSE staff**, book **Workstation 02's Computer** at the same time. **Expect:** allowed; different machines don't clash. Book the **whole room** at that time. **Expect:** refused; it clashes with the machine bookings inside.
- [ ] **BKI-09** As **MT CSE staff**, try booking a **broken** computer in B510-R8 (one Lab states still counts as needing attention). **Expect:** refused: "not working right now".
- [ ] **BKI-10** Try one computer from B510-R8 together with one from B510-R9 in one booking. **Expect:** "Book one room at a time".

### 4D. Classes, cancellation, limits

- [ ] **BKI-11** As **Ali**, create a weekly class series in B510-R8, Fridays 14:00–16:00, for 4 weeks. Cancel one occurrence, then restore it. **Expect:** the others are unchanged; a staff booking overlapping a class slot is refused.
- [ ] **BKI-12** As **MT CSE staff**, cancel a future Confirmed booking. **Expect:** the slot is released and can be rebooked.
- [ ] **BKI-13** Try a booking in the past, one longer than 16 hours, and one more than a year ahead. **Expect:** each refused with a clear message.
- [ ] **BKI-14** As **MT student** → `/schedule`. **Expect:** no booking ability ("ask your advisor").

### 4E. External requester → both departments → payment

To check email, open the newest `.eml` in `e2e/mail/`. `index.jsonl` lists recipients and subjects.

**Request A — the happy path, split across CSE and Chemical Engineering**

- [ ] **BKE-01** Signed out → http://localhost:3100/portal. **Expect:** Lab is listed publicly. No custodian names, room numbers or item details are visible.
- [ ] **BKE-02** Portal → request:
  - organisation `MT Adama Polytechnic`, your contact details;
  - two days: **Tue 13 Oct 09:00–12:00** and **Wed 14 Oct 09:00–12:00**;
  - needs: "a computer lab for 25 students, and a unit-operations demo";
  - attach a small PDF letter.

  **Expect:** a reference `EXT-2026-…` and a tracking link, also emailed.
- [ ] **BKE-03** As **AVP** → External requests → open it → view the letter → **Forward** to **Computer Science and Engineering** and **Chemical Engineering**. **Expect:** Under review; one assignment per department.
- [ ] **BKE-04** As **Ali**, **Hold** B510-R8 on 13 Oct 09:00–12:00. As **Hanna**, hold one of her labs on 14 Oct 09:00–12:00. Try holding a date the request never named (e.g. 15 Oct). **Expect:** refused.
- [ ] **BKE-05** As **MT CSE staff**, try to book B510-R8 on 13 Oct 10:00–11:00. **Expect:** refused; the hold blocks it.
- [ ] **BKE-06** As **CSE head**, accept the assignment: pricing-sheet link (any `https://` URL) and **ETB 2,000**. As **Chemical Eng. head**, accept with **ETB 1,500**.
- [ ] **BKE-07** As **AVP**, **Send quote**: **ETB 3,500**, deadline a few days ahead. **Expect:** Quoted, and a quote email with a **new** tracking link. The old link stops working.
- [ ] **BKE-08** Pay with CBE, reference `FAKE-3500-WRONG` (any 8-digit account suffix). **Expect:** refused (paid someone else); still unpaid.
- [ ] **BKE-09** Pay `FAKE-2000` (telebirr). **Expect:** accepted as partial; ETB 1,500 still due.
- [ ] **BKE-10** Pay `FAKE-1500`. **Expect:** **Paid → Scheduled**; both holds become **Confirmed** bookings; emails to the requester, both custodians and both heads.

**Request B — department declines, AVP declines**

- [ ] **BKE-11** Submit `MT Request B` (a date ≥ 2 days ahead). As AVP, forward to **CSE only**. As **CSE head**, **Decline** with a note. **Expect:** AVP cannot send a quote ("No department accepted"). AVP **declines** with a reason, and the tracking page shows it.
- [ ] **BKE-12** On Request B's tracking page, try paying `FAKE-2000` again. **Expect:** refused; that reference already paid for Request A.

**Request C — verifier outage and manual review**

- [ ] **BKE-13** A third request through forward → hold → accept (Chemical Engineering, ETB 800) → quote ETB 800. Pay with reference `FAKE-DOWN`. **Expect:** "verifier unreachable", with an option for **manual review**. Submit it, stating ETB 800.
- [ ] **BKE-14** As **Chemical Eng. head**, open Request C. **Expect:** no payment-review action. As **AVP**, accept the manual payment, amount 800. **Expect:** Paid → Scheduled; the hold becomes Confirmed.

**Request D — requester cancels before paying**

- [ ] **BKE-15** A fourth request up to Quoted. On its tracking page, **Cancel**. **Expect:** Cancelled; holds released; the slot is bookable again.

---

## Results log

### Run 1 (user, 22 Sep 2026): stopped before Part 1D

| ID | Actor | Expected | Actual | Outcome |
|---|---|---|---|---|
| pickers | all | Readable placement choices | Flat `A / B / C` paths | Fixed (A4) |
| SET-04 | admin | Link recoverable later | Copy link only shown once | Fixed (A1) |
| SET-16 | custodian | Hierarchy of university resources | Long list of lab roots | Fixed (A7) |
| reset | — | Reset email arrives | No email for an invited account | Fixed (A1) |
| SET-08 | custodian | Unique, continued numbering | Second batch re-used 01… | Fixed (A6) |
| SET-08 | custodian | Name defaults to category | Name field blank | Fixed (A6) |
| edit | custodian | Field saves in place | Whole table re-skeletons | Fixed (A3) |
| SET-01 | admin | Any suitable icon | 37 icons, no Blinds | Fixed (A5) |
| STA-03 | custodian | Edit gets staged under drafts | Edit refused | Fixed (B) |
| 1D | all | See the draft and ideal states | Only opaque commit cards | Fixed (B, Lab states) |

### Run 2 (Claude, 22–23 Sep 2026): Phase D cycle on the real CSE data, E2E clone

Ali Kibret's two labs went through the in-app browser: his own ideal edits and submits, the head's approvals, the draft edits, R8's workstation handover, and his acceptances. The other 29 labs and the purchase chain went through `e2e/drive-cse-cycle.ts`, which calls the app's own API.

| Step | Result |
|---|---|
| Ideal (SET-12–15) | Ali's R8/R9: Workstation 21–25 and Network Outlet 21–25 named by continuation; stats 25 · 20 · 5. All 31 proposals submitted; R8/R9 approved in the UI, 29 by driver. ✓ |
| Draft (STA-04/07) | Ali set Workstation 01's Monitor → Broken and a broken chair → Maintenance in the Draft tree. The head approved, and it merged: the change log credits Ali, and R8's Computer needs-attention went 4 → 5, Monitor 1 → 2. ✓ |
| Purchasables (PUR-05) | Gap: Workstation 151, Outlet 155. Broken: RAM 60, Storage 56, Monitor 74, Computer 190 (= 60 + 56 + 74), Chair 412. Matches an independent DB count, where Chair is 411 broken + 1 under maintenance. ✓ |
| Chain (PUR-10/11) | PR-2026-001: dean → AVP → procurement → Order placed → Buyer found → On delivery → In store. ✓ |
| Receipt (PUR-12/13) | Each line received in two partial receipts; the request **closed** after the last. ✓ |
| Handover (PUR-14/15) | R8's 5 workstations handed over in the UI; the head approved and Ali accepted in the UI. The rest were routed by driver, and Ali accepted his 11 in the UI. All stock was placed with none spare. ✓ (see R2-1) |
| Repair (PUR-16/17) | Ali moved "RAM 59" into Workstation 20's Motherboard (staged from the register API) and removed the dead RAM in the Draft. The head approved: R8 RAM 25 · 25 with 0 needing attention, and Computer needs-attention 5 → 4. ✓ |
| Final | Gap **0** in all 31 labs for every category. Needs-attention remains for the broken parts still in the other labs, which is expected: only Ali's one repair was staged. |

**Findings from run 2**

| # | Where | What | Severity |
|---|---|---|---|
| R2-1 | Hand over | An item already in a **pending** handover can be put into a second one. Nothing refuses it at request time. The second request only fails at apply time (stale). In the run, 5 workstations were promised to B510-R11/R12 and then handed to R8; the head had to reject both requests and the store re-issued them. | Medium · **Fixed** — refused (409) at preview and request, subtree both ways, under a lock; ⇄ markers in the register |
| R2-2 | Receiving | Partial receipts pad names per batch: the first 75 became `Workstation Setup 01`–`75`, the next 76 became `076`–`151`. Mixed padding in one store sorts confusingly (`100` before `11`), and it contributed to R2-1. | Low · **Fixed** — later batches keep the siblings' padding (…99, 100) |
| R2-3 | Received names | Received stock is named after the category (`Workstation Setup NN`, `RAM NN`), not the lab's own scheme (`Workstation NN`). | Low · **Fixed** — a handover can name them as the lab does ("Name them there as", suggested from the lab's numbered names) |
| R2-4 | Approvals | Handover cards for outlets read "5 resources → Switch Rack" without naming the lab. With 31 labs, the head can't tell them apart. | Low · **Fixed** for new requests — "→ Switch Rack in Software Laboratory — B510-R11" |
| R2-5 | Draft diff | "RAM 59 · Moved into Motherboard" doesn't say which workstation's motherboard. | Low · **Fixed** — "Moved from … into Workstation 20 › Computer › Motherboard"; removals say where from |
| R2-6 | Purchasables | The "broken" column counts every item needing attention, including *under maintenance*. The label should say so. | Low · **Fixed** — the column is "Not working", with what it counts |

When something fails, record:
- the account you were signed in as;
- the page;
- the resource or reference number;
- the exact steps;
- what you expected and what happened.

## Clean-up

Everything lives in the throwaway `lrms_v2_e2e` clone. To start over, rerun Part 0. The dev database `lrms_v2` is only reset deliberately, after a `pg_dump` backup into `backups/`.

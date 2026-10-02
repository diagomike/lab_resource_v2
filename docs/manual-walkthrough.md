# Manual walkthrough: ASTU Lab Resources, feature by feature

*Written 2026-10-02 for branch `feat/ux-flow` (the UX-flow round, P0–P6, plus the follow-ups:
highlighted needs and arrivals, the ADAA's college stores, Mailpit).* It replaces the older
acts in [`docs/walkthrough/`](walkthrough/README.md), which describe roles and screens that
no longer exist.

Go through it in order. Each act is one person's turn; it ends with what you should have
seen. Tick the boxes as you go. Anything that doesn't match is worth writing down: the act,
the step, what you expected, and what happened.

---

## Before you start

### 1. Start Mailpit and the app

Every email the dev server sends goes to **Mailpit** on this machine, never to a real
inbox. The dev database holds the real ARAs' addresses, so start Mailpit first.

```bash
npm run mail:catch
```

```bash
npm run dev
```

Or use the **mail** and **dev** launch configurations. Then open:

- the app: http://localhost:3000
- Mailpit's inbox: http://127.0.0.1:8026

This relies on `.env.development.local` (git-ignored). If it's missing, copy it from the
example:

```bash
cp .env.development.local.example .env.development.local
```

That file also switches on the **fake payment verifier** for act 12. A receipt reference
`FAKE-<birr>` is a payment of that many birr; `FAKE-<birr>-WRONG` paid someone else;
`FAKE-DOWN` acts as if the verifier were unreachable.

### 2. The accounts

Every password is **astu1234**.

| Role | Sign in as |
|---|---|
| System administrator | `admin@astu.edu.et` |
| CSE department head | `cse.head@astu.edu.et` |
| CSE lab custodian | **Ali Kibret Muhamed** (runs Software Laboratory B510-R8); his email is in People & roles |
| Another CSE custodian | **Kebede Tegene Alemu** (runs B508-R13 and B510-R13), same |
| CoEEC dean | `coeec.dean@astu.edu.et` |
| CoEEC ADAA | `adaa.coeec@astu.edu.et` |
| College Managing Director | `cmd@astu.edu.et` |
| Academic Vice President | `avp@astu.edu.et` |
| Procurement officer | `procurement@astu.edu.et` |
| Property Administration | `property.admin@astu.edu.et` |
| Main Store keeper | `store.keeper@astu.edu.et` |
| ChemE head / custodian | `head.chem@astu.edu.et` / `custodian.chem@astu.edu.et` (Hanna Bekele) |
| An outside institution | you create it in act 12 |

**Use one browser window per person.** Tabs in the same window share one sign-in. Use
browser profiles or private windows, or sign out between acts.

### 3. Let the custodians' emails through

The CSE custodians carry their real addresses, so the seed switches their **email
notifications off**. Their bell still gets everything. To see their emails in Mailpit too, sign in as
the admin → **People & roles** → open **Ali Kibret Muhamed**, then **Kebede Tegene Alemu**
→ switch **Email notifications** on. With Mailpit in place, nothing reaches their real inboxes.
Switch them off again when you're done if you'll later run the app without Mailpit.

### 4. Optional: a clean start

The dev database already holds a few things from the build checks (a "Digital multimeter"
and an "HDMI cable" need, a Robotics Laboratory and a CoEEC College Store). That's
harmless. For a completely clean start, back up and reseed. **This wipes `lrms_v2`.**

```bash
"C:/Program Files/PostgreSQL/18/bin/pg_dump" -Fc -f backups/lrms_v2-before-walkthrough.dump "postgresql://<user>:<password>@localhost:5432/lrms_v2"
```

```bash
npx prisma migrate reset --force --skip-seed
```

```bash
npx tsx prisma/seed.ts
```

```bash
npx tsx prisma/resource-seed.ts
```

Stop the dev server before `migrate reset`, because Windows locks Prisma's engine while it runs.

---

## Act 1: Getting around (any account; start with the CSE head)

1. Open http://localhost:3000. You land on **Sign in**. Sign in as the CSE head.
2. You land on **Home**. Read it top to bottom:
   - **Next step**: one sentence and one button (e.g. "2 lab needs are waiting for you").
   - **Waiting for you**: counts by kind, each linking straight to the filtered list.
   - **Your requests**: where each of your open requests is now ("with the CoEEC Dean, 2 days").
   - **Unfinished**, **Due soon**, **Recent updates**, **At a glance** (your department's labs, items, % working).
3. Look at the **sidebar**. A head sees **Overview** first (Insights, History), then **Work**
   (Home, Resources, Labs & stores, Bookings, Approvals, Purchasing, Outside requests,
   Categories), then People & roles. The badges count what is waiting. There is no "You"
   section and no Sign out at the bottom any more; they are behind your initials.
4. Click the **bell** (top bar). Your latest updates appear; click one, and it opens
   **exactly that item**, marked. **Mark all read** clears the count.
5. Click **Help** on any screen. It opens the guide at the section for *this screen and
   your role*.
6. Switch **Light/Dark** (top bar). Click **your initials** (top right): a menu opens with
   **Help & guides**, **Profile & password** and **Sign out**. Open **Profile & password**: the
   text size is **Large** unless you changed it; try the others. Find **Email me when
   something needs me or my request is decided**.
7. **A link survives sign-in.** Copy the address of any screen, for example an Approvals item
   (`/approvals?focus=…`). Sign out (your initials → **Sign out**), paste the address, and sign in. You come back to that
   exact item, not to Home. Signing out on purpose goes to a plain sign-in page.

- [ ] Home shows a next step, and its button goes to the right screen
- [ ] Sidebar badges match Home's counts
- [ ] The bell opens the exact item, and reading it lowers the count
- [ ] Help opens the section for this screen and role
- [ ] Your initials open Help & guides, Profile & password and Sign out; text starts at Large
- [ ] Signing in from a pasted link returns to that link

## Act 2: The administrator: organisation, people, categories

Sign in as `admin@astu.edu.et`.

1. **Home** shows the admin's **Loose ends**: vacant posts, places without a custodian,
   people with no role, invitations still pending.
2. **Organisation.** It opens on **Cards** (one list per level); **Graph** is the second view. Click **+ New unit**. There is **no level box**: a unit sits one below
   what it sits under. Try making a department under CoEEC; the headings read "Colleges",
   "Departments", not "Level 2". Delete it again (an empty unit can be deleted).
3. **People & roles → Invite.** Invite yourself a test custodian: any `@example.org` address,
   role **Lab custodian**, home **Computer Science and Engineering**.
4. Open **Mailpit**. The invitation is there. Open its link: it goes to *accept invitation*.
   Set a password, and the person is active. You'll use them in act 3.
5. **Categories.** Search the list (e.g. "oscilloscope"). Open **Computer**: no storage keys
   anywhere; **More options** holds the impair rule in plain words. Open **+ Add a category**
   and look at **Start from a template** and **+ A common detail…** (Manufacturer, Model,
   Serial no., Calibration due, CAS no.…). Close without saving: an unsaved-changes prompt asks first.

- [ ] Organisation opens on Cards; Graph is one click away
- [ ] Unit levels follow from their parent; no level input
- [ ] The invitation arrives in Mailpit, and its link registers the person
- [ ] The category editor shows no storage keys, and warns before discarding changes

## Act 3: The head adds a lab and chooses who runs it

Sign in as the **CSE head**.

1. **Labs & stores** lists the department's labs and stores: custodian, block and room,
   seats, bookable, items, needs-attention.
2. **+ Add a lab or store.** Kind **Lab**; name it "Walkthrough Lab B510-R40"; Block 510,
   Room 40, Seats 20; **Who runs it**: the custodian you invited in act 2. **Create**.
3. The lab's page opens with "Created. Its custodian has been told." The **bell** of that
   custodian, and **Mailpit**, have "You now run Walkthrough Lab B510-R40". Its button
   opens the lab.
4. On the lab's page: **Change who runs it** → Ali Kibret Muhamed, with a reason. Both people
   are told (two emails in Mailpit).
5. Try it the wrong way: sign in as Ali and look for any way to add a lab. There is none.
   **Labs & stores** shows only what he runs ("You run"), with no Add button, and the
   register refuses a new top-level place.

- [ ] The new lab is created with its details, and the custodian is told (bell + email)
- [ ] Changing the custodian tells both people
- [ ] A custodian can't add a lab

## Act 4: The ADAA: the college's stores, and their keepers

Sign in as `adaa.coeec@astu.edu.et`.

1. The sidebar: Home, Resources, Labs & stores, Approvals, Categories, Insights, History.
   No Bookings, no Purchasing.
2. **Home → At a glance** covers the whole college. **Resources → Mine** shows everything in
   CoEEC's departments (6 units).
3. **Labs & stores** lists **only the college's own stores**; the button reads **+ Add a store**.
4. **+ Add a store**: the only kind offered is **Store**. Name it "CoEEC College Store —
   B508-R3"; Level **College store**; Block 508, Room 3.
5. **Its store keeper**: the list offers everyone who works in the college and its
   departments. Some are marked **becomes a custodian** (e.g. a head or the dean): they hold
   no custodian role yet, and choosing one makes them a custodian. Pick someone, and **Create**.
6. The keeper is told: "You now keep CoEEC College Store B508-R3" (Mailpit). If you picked
   someone marked *becomes a custodian*, check **People & roles** as the admin: they now hold
   **Lab custodian**.
7. On the store's page, **Change its store keeper** works the same way.
8. Things the ADAA can't do: there is no way to add a lab, and a department's labs show on
   Resources but not on Labs & stores as the ADAA's to manage.

- [ ] The ADAA sees "+ Add a store" and only the Store kind
- [ ] The keeper list includes non-custodians, marked; choosing one makes them a custodian
- [ ] The keeper is told "You now keep …"
- [ ] The ADAA can't add or manage labs

## Act 5: A custodian keeps the lab's record

Sign in as **Ali Kibret Muhamed**.

1. **Home** names Ali's next step, and **Labs & stores** lists the labs he runs.
2. Open **Software Laboratory B510-R8**. It has three tabs: **In the lab**,
   **My changes**, **Approvals**.
3. **Resources.** Sort by **Name** (click the column heading; again for Z→A). The heading
   stays put while you scroll. Filter to a status; the empty message says why it's empty.
   **Export** downloads what you see as an `.xlsx`.
4. **Record a change.** Open a workstation's monitor and set **Status → Broken**, with a
   reason ("No signal"). A toast says it was **added to the lab's changes (not sent
   yet)**. The register still shows *Working*. Changes wait for the head.
5. Add a whole workstation: **+ Add resources** into the lab. Type a name, then press
   **Escape**. It asks "Discard them?" first, and keeps your typing if you say no. Add it.
6. Open the lab's **My changes**: both changes are listed in plain lines ("Status: Working
   → Broken"). Click **Send to the head**.
7. While you wait: the item panel keeps what you typed if a save fails (try a 10,000-character
   name); the dialog's focus starts in its first field and returns to the button afterwards.

- [ ] A custodian's edit goes into "My changes", not the register
- [ ] Sorting, the sticky header, the empty message and Export work
- [ ] Escape on a dialog with typed text asks before discarding
- [ ] Sending the changes tells the head (Mailpit: "…: changes are waiting for your approval")

## Act 6: The head decides the lab's changes

Sign in as the **CSE head**. Open the email from act 5 in **Mailpit** and click its button.

1. You land on **Approvals → Waiting for me**, scrolled to that request and marked "the one
   you followed". Each change reads as a plain line, with Ali's reasons.
2. **Send back** with a note ("Check the monitor cable first"). Ali gets it back (bell and
   email), and his **My changes** shows your note. As Ali, send it again.
3. As the head, **Approve**. The register now shows the monitor *Broken* and the new
   workstation, and **History** credits **Ali**, not the head.
4. **Someone else's correction doesn't spoil a batch.** As Ali, stage one more change (e.g.
   rename a chair). Before sending, sign in as the admin and rename a *different* item in
   the same lab directly. As Ali, send; as the head, approve. It applies, and the admin's
   rename stays.
5. **A real conflict is refused.** As Ali, rename a chair again and send. As the admin,
   rename that *same* chair. As the head, approve: it's refused as changed in the register
   meanwhile, and nothing is overwritten. Ali's **My changes** explains, with **Start again
   from the lab**.

- [ ] The emailed link opens the exact request, marked
- [ ] Send back returns the changes with the note; approve applies them, credited to the custodian
- [ ] An unrelated correction doesn't block the batch or get undone
- [ ] A change to the same item is refused, never silently overwritten

## Act 7: Categories that can't be broken

Sign in as **Ali**.

1. **Categories → + Add a category**: "Walkthrough Bench Meter", one detail **Reading**
   (Text). Save. It applies at once and is **looked after by CSE**. The CSE head is told
   (Mailpit: "… added the category Walkthrough Bench Meter").
2. Add a bench meter to one of Ali's labs with Reading "16", send it, and approve it as the
   head (as in acts 5–6).
3. Back on the category, change **Reading** from Text to **Number**. The review says what
   it changes ("Changes 'Reading' from text to a number (1 value)"). Save. It **waits for the
   head** ("Pending change" on the category).
4. As the head, open the notice: **Categories** opens that category and its waiting change.
   **Approve**. The meter's reading is now the number 16, converted, not erased.
5. Rename a detail that holds values. It asks: **Yes, rename it. The values stay**, or
   **No, add it as a new detail**.
6. Make a detail **required** on a category that already has items. It offers to **fill the
   existing items** with a value, or leave them blank.
7. Open a category another department looks after (e.g. a ChemE one). You can still add to
   it, but a change that would alter data waits for approval. **Make a copy for my
   department** gives you your own.

- [ ] A new category applies at once and tells the head
- [ ] A change to values it holds waits, and approval converts the values
- [ ] Renaming asks "same property or a new one"; making a detail required offers to fill

## Act 8: Needs → a purchase request → up the ladder

**As Ali:**

1. **Purchasing → Lab needs → Ask for something**: for B510-R8, "Soldering station" × 3,
   **Essential**, a reason and a specification. Ask for a second thing too ("Projector
   screen", Nice to have).
2. If something in his lab is broken or lost, **Broken or lost, not asked for yet** lists
   it; **Ask for a replacement** raises the need in one click.

**As the CSE head:**

3. Mailpit has "Software Laboratory B510-R8 needs Soldering station". Click its button. It
   opens **Purchasing → Lab needs** with **that need marked** (accent edge) and scrolled into view.
4. **Decline** the projector screen with a reason. Ali is told.
5. Tick the soldering stations → **Build a request from 1 need**. Give a title and an
   estimated cost, and **Send**. The need now shows **Carried**.
6. The request climbs **Dean → College Managing Director → AVP → Procurement**. Sign in as
   each in turn (`coeec.dean`, `cmd`, `avp`, `procurement`), each time from the email's
   button. As the dean, try **Send back** for revision once; the head edits and resubmits,
   and the ladder starts again.
   Each approver sees the request **in full**, not only its title: every line with its
   estimated unit cost, line total and the request's **estimated total**, and (open from the
   start for the person deciding) **Why each line is asked for**: the lab need behind each
   line, with the lab, who asked, how urgent, what it replaces, the specification and the reason.
7. **As procurement:** approve (Order placed), then **advance** it: buyer found, on
   delivery, **Arrived at the main store**.

- [ ] The need notice opens Lab needs with that need marked
- [ ] Declining tells the custodian; carrying marks the need Carried
- [ ] The ladder runs dean → CMD → AVP → procurement, each opened from its email
- [ ] Every step is in the request's history, across the send-back
- [ ] Each approver sees every line's cost, the total, and the lab need behind each line

## Act 9: Arrivals: recording and loading

**As Property Administration** (`property.admin@astu.edu.et`):

1. Mailpit: "PR-… has arrived at the main store". Its button opens **Purchasing → Arrivals**
   with **that purchase request already chosen** in **Record an import**, its lines filled in,
   and the form marked.
2. Correct to what actually arrived (add a model or serial numbers), and **Record**. You can't
   record more than was ordered.

**As the store keeper** (`store.keeper@astu.edu.et`):

3. Mailpit: "IMP-… is ready to load into the store". Its button opens **Arrivals** with **that
   import record marked**.
4. Load the lines into the **ASTU Main Store** (part now, the rest later if you like).
   Loading more than arrived is refused.
5. When everything is loaded, the request **closes** and the head is told ("… is in the store").

- [ ] The "arrived" notice opens Arrivals with the request chosen and marked
- [ ] The "ready to load" notice opens Arrivals with that record marked
- [ ] Loading everything closes the request and tells the head

## Act 10: Moving things

1. **Store → a lab.** As the store keeper, open a stocked item in the Main Store →
   **Move to another place…** → Ali's lab. The chain shows **receiving head → Property
   Administration → the custodian accepts**. Walk it (CSE head, property admin, Ali); the
   item ends owned by CSE, in Ali's custody, in his lab.
2. **Ask the store for something.** As Ali, **Resources → Whole university**, find a table in
   the Main Store → **Request to my lab…**. Store keeper → CSE head → Property Administration
   → Ali confirms receipt.
3. **Return to the store.** As Ali, **Return to store…** on an item: CSE head → Property
   Administration → store keeper accepts.
4. **A loan.** As Hanna (ChemE), request one of Ali's items into her lab: Ali → CSE head →
   ChemE head → Hanna confirms. The owner stays CSE.
5. **A permanent transfer** between colleges goes through the **College Managing Director**
   and **Property Administration** too.
6. **What each approver reads.** Every transfer in **Approvals** has **What is moving, from
   where, to whom** (open from the start for the person deciding): **From** (place, owner,
   who answers for it now) and **To** (place, unit, whether ownership moves, who will answer
   for it), then each resource with its kind, status, recorded details (serial number,
   model…) and what travels inside it ("Monitor ×1, Keyboard ×1…"). Anything edited since it
   was asked for is marked **Changed since it was asked for**.

- [ ] Each chain shows its steps in order, and only the current approver can decide
- [ ] Each step's email opens the exact request
- [ ] Ownership, custody and place end up as each chain promises
- [ ] Each approver sees what moves (kind, status, details, parts), from where and to whom

## Act 11: Bookings

1. **As Ali**, **Bookings** → his lab → book a slot. He must say **who it is for** and why
   ("3rd-year OS practical"); it's confirmed at once.
2. **As Kebede** (another custodian), request Ali's lab for a slot. It is **Requested**, and
   Ali is asked (bell + email; the link opens it in Approvals).
3. **As Ali**, approve it. Kebede is told.
4. **Weekly classes:** as Ali, add a class (Mon + Wed 08–10 for 8 weeks). A clash with a
   confirmed booking is refused, with nothing written.

- [ ] A custodian's own booking needs "who for" and is confirmed at once
- [ ] Someone else's request waits for the room's custodian
- [ ] A clashing class is refused

## Act 12: An outside institution's request, through to payment

1. Sign out. Open **/portal** → **Create an account** (organisation, name, an `@example.org`
   email, phone, password).
2. Mailpit: **Confirm your email**. Open the link, then sign in. You can't sign in before
   confirming.
3. **New request:** a facility request for a date at least a day ahead, with a PDF letter.
   The requester and the AVP are told.
4. **AVP:** sign in. **Home** is **Insights** for the whole university (filters, condition,
   problems, the register), with a small **Outside requests** card above it because one is
   waiting. Then the email opens **Outside requests** with **that request open** (not the newest).
   **Forward** to CoEEC.
5. **CoEEC dean:** forward to CSE. **CSE head:** ask Ali to hold his lab.
6. **Ali:** **Hold** the room on the requested date, then mark the task done.
7. **CSE head:** answer with the cost sheet link, an amount and the contact people. **Dean:**
   approve and answer. **AVP:** approve, then **Quote** (amount and payment deadline).
8. **Requester:** the quote, the bank details and the held room show on the request's page.
   **Pay**: provider CBE, reference `FAKE-12500` for a 12,500 birr quote (or
   `FAKE-12500-WRONG` first, to see it rejected).
9. **AVP:** **Confirm the payment**. The booking is confirmed on Ali's calendar (his email's
   link opens **Bookings** at that lab), and the requester now sees who to call.

- [ ] The AVP's Home is Insights, with a card only for what waits
- [ ] Sign-in is refused until the email is confirmed
- [ ] Each staff email opens that request, not the newest one
- [ ] A wrong receiver is rejected; a correct receipt makes it Paid; the AVP's confirmation schedules it
- [ ] The confirmation reveals the contact people to the requester

## Act 13: The record

1. **History**: every applied change, with who, what, when and why. Filter to an item.
2. **Insights**: condition across the department (head), the college (dean, ADAA) or the
   university (AVP, Property Administration).
3. **Resources → Whole university**: everyone can read across ASTU; changes stay with
   whoever looks after the item.

- [ ] History credits the person who made each change (the custodian, for approved changes)

## Act 14: Readability and resilience

1. **Dark and light**: every text is readable (no faint grey on grey), in both themes.
2. **Phone width**: narrow the window to a phone's width. The sidebar becomes a drawer and
   nothing scrolls sideways.
3. **Keyboard**: open any dialog. Focus starts inside, **Tab** stays inside, **Escape**
   closes it (asking first if you typed something), and focus returns to the button.
4. **Errors**: stop the dev server for a moment and click around. Lists say what failed,
   with **Try again**, instead of looking empty. Start it again and retry.
5. **Mail safety**: everything you did today should be in Mailpit, and nothing should have
   reached a real inbox.

- [ ] Readable in both themes and at phone width
- [ ] Dialogs are keyboard-friendly (Move, Request to my lab and Return to store also ask before discarding what you typed)
- [ ] No em-dashes in the app's own wording (lab names keep theirs)
- [ ] Failures say so, with Try again
- [ ] Every email is in Mailpit

---

## When something doesn't match

Write down the act and step, who you were signed in as, what you expected, and what
happened (a screenshot helps). The automated checks that cover the same ground run on a
separate copy of the database:

```bash
node e2e/reset-demo.mjs
```

```bash
node e2e/mail-sink.mjs
```

```bash
node e2e/with-env.mjs npx next dev -p 3100
```

```bash
node e2e/with-env.mjs npx tsx e2e/validate-approval-lines.ts
```

```bash
node e2e/run-campaign.mjs
```

The validator follows every emailed link (96 checks); the campaign runs the 181 API cases
in `e2e/suites/`. Three of those are known, long-standing ✘: O-11, S-14 and S-18, design
decisions recorded in `docs/e2e-findings-2026-09-15.md`.

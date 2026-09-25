# Before you start

*A cross-role walkthrough of ASTU Lab Resources:* one lab's cycle, from a broken monitor to new workstations on the bench, plus an outside institution's booking. Each act is one person's turn. They sign in, do their part, and hand over to the next person. Run the acts in order, and every screen will look as it does here.

## The story

Software Laboratory **B510-R8** (CSE, custodian **Ali Kibret Muhamed**) has two monitors that just failed, and the lab is five workstations short of what it should hold. A lecturer also wants a projector and a lab session.

| Act | Who signs in | What they do |
|---|---|---|
| [1](01-admin.md) | System admin | Checks the College Managing Director office, invites a lecturer, makes labs bookable, adds a *Projector* category |
| [2](02-custodian.md) | Custodian (Ali) | Stages the two broken monitors in the lab's draft, submits it, and proposes the lab's ideal (+5 workstations) |
| [3](03-staff.md) | Staff (lecturer) | Raises a need for a projector and asks to book the lab |
| [4](04-head.md) | CSE head | Approves the draft and the ideal, then compiles one purchase request |
| [5](05-dean.md) | Dean | Sends the request back for costs; the head revises; the dean approves |
| [6–7](06-avp-cmd.md) | AVP, then College Managing Director | Approve |
| [8](08-procurement.md) | Procurement | Approves, then moves the order to *Arrived at the main store* |
| [9](09-store-keeper.md) | Store keeper | Receives the delivery, then hands the workstations and projector to B510-R8 |
| [10](10-handover.md) | CSE head, then Ali | Approves the handover; accepts it; the lab's gap closes |
| [11](11-bookings.md) | Ali, then the lecturer | Approves the booking; the lecturer sees it confirmed |
| [12](12-external.md) | Outside institution, AVP, Ali, CSE head | A training request from the public portal, through to payment |
| [13](13-audit.md) | CSE head, procurement | The record: change log, dashboard, order history |

## The accounts

Every password is **astu1234**. The role accounts are placeholders; rename them from People & roles when the real people are known.

| Role | Sign in as |
|---|---|
| System admin | `admin@astu.edu.et` |
| Custodian of B510-R8 | Ali Kibret Muhamed (his email is in People & roles) |
| Staff / lecturer | `mt.staff.cse@e2e.test`, invited in Act 1: accept the invitation to set the password |
| CSE department head | `cse.head@astu.edu.et` |
| CoEEC dean | `coeec.dean@astu.edu.et` |
| Academic Vice President (AVP) | `avp@astu.edu.et` |
| College Managing Director (CMD) | `cmd@astu.edu.et` |
| Procurement officer | `procurement@astu.edu.et` |
| Main store keeper | `store.keeper@astu.edu.et` |
| Outside institution | nobody: the public portal needs no account |

**Use one browser window per person.** Ordinary tabs share one sign-in, so use separate browser profiles or private windows (Chrome: *Profiles*; Edge: *InPrivate*), or sign out and in between acts.

## A clean start (the demo copy)

The walkthrough is written for the **demo copy** of the database (`lrms_v2_e2e`, the app on port 3100), whose email goes to a local mailbox instead of the real people. From the project folder:

```bash
node e2e/reset-demo.mjs
```

It rebuilds the demo copy: the real CSE and Chemical Engineering data, every role account, the College Managing Director and ICT offices, and the approval rules. Then start the mail catcher and the app, each in its own terminal:

```bash
node e2e/mail-sink.mjs
```

```bash
node e2e/with-env.mjs npx next dev -p 3100
```

Open **http://localhost:3100**. The emails the app sends (invitations, "waiting for your approval", the requester's quote) land in `e2e/mail/`: each is an `.eml` file, and `index.jsonl` lists them. Run the reset again whenever you want to repeat the demo.

> **Good to know**
> - The CSE lab custodians (the ARAs, Ali among them) start with **notification emails off**, so Ali's steps send him nothing. Everyone else gets an email at their step. Turn Ali's on in his **Profile** to show his emails too.
> - Dates in the story (bookings on 6, 13 and 14 October 2026) are in the future on purpose. If you run it later, pick later dates.
> - To run this against the **live** system instead, read [Running it on production](production.md) first.

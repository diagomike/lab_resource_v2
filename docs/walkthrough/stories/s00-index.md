# Stories at a glance

Every user story ASTU Lab Resources supports, grouped by area. **Flow** shows how each one travels between people (→ is a hand-off; ✉ marks an email sent at that point). Each story's page has the screenshots. **Demo** points to the act of the end-to-end demo where you can run it live.

**Roles:** Admin = system admin · Head = department head · Cust. = lab custodian (ARA) · Staff = staff / lecturer · Dean · AVP = Academic Vice President · CMD = College Managing Director · Proc. = procurement officer · Store = main store keeper · Portal = an outside institution (no account) · ICT = ICT maintenance officer · Prop. = property admin

## Accounts and access

| # | Story | Flow | Demo |
|---|---|---|---|
| [A1](s01-accounts.md#a1-join-by-invitation) | Join by invitation | Admin or Head invites ✉ → person sets a password | [Act 1](../01-admin.md) |
| [A2](s01-accounts.md#a2-sign-in-and-find-your-way) | Sign in and find your way | Anyone | — |
| [A3](s01-accounts.md#a3-reset-a-forgotten-password) | Reset a forgotten password | Person ✉ → person | — |
| [A4](s01-accounts.md#a4-get-someone-back-in) | Get someone back in (temporary password) | Admin or Head → person (forced change) | — |
| [A5](s01-accounts.md#a5-search-from-anywhere) | Search from anywhere | Anyone | — |
| [A6](s01-accounts.md#a6-choose-which-emails-reach-you) | Choose which emails reach you | Person; or Admin/Head for them | — |
| [A7](s01-accounts.md#a7-see-only-what-your-role-allows) | See only what your role allows | Anyone (e.g. a student) | — |

## The register

| # | Story | Flow | Demo |
|---|---|---|---|
| [B1](s02-register.md#b1-see-the-condition-at-a-glance) | See the condition at a glance | Cust., Head, Dean, AVP, ICT… | [Act 13](../13-audit.md) |
| [B2](s02-register.md#b2-browse-a-lab-and-inspect-an-item) | Browse a lab and inspect an item | Anyone with the Register | [Act 2](../02-custodian.md) |
| [B3](s02-register.md#b3-find-exactly-what-you-need) | Find exactly what you need (filters, `@key`, summaries) | Anyone with the Register | — |
| [B4](s02-register.md#b4-report-that-something-broke-or-was-mended) | Report that something broke, or was mended | Cust. (direct mode) | — |
| [B5](s02-register.md#b5-record-new-resources) | Record new resources | Cust. | — |
| [B6](s02-register.md#b6-change-many-at-once) | Change many at once | Cust. | — |
| [B7](s02-register.md#b7-see-who-changed-what) | See who changed what | Head, Admin, Cust. | [Act 13](../13-audit.md) |

## Lab states: drafts and ideals

| # | Story | Flow | Demo |
|---|---|---|---|
| [C1](s03-lab-states.md#c1-update-a-lab-through-its-draft) | Update a lab through its draft | Cust. stages → submits ✉ → Head approves ✉ → register | [Acts 2, 4](../02-custodian.md) |
| [C2](s03-lab-states.md#c2-send-a-draft-back) | Send a draft back | Head ✉ → Cust. revises → Head | — |
| [C3](s03-lab-states.md#c3-set-what-a-lab-should-hold) | Set what a lab should hold (the Ideal) | Cust. proposes ✉ → Head approves ✉ | [Acts 2, 4](../02-custodian.md) |

## Purchasing

| # | Story | Flow | Demo |
|---|---|---|---|
| [D1](s04-purchasing.md#d1-ask-for-something-to-be-bought) | Ask for something to be bought (a need) | Staff/Cust. → Head carries it, or declines ✉ | [Act 3](../03-staff.md) |
| [D2](s04-purchasing.md#d2-compile-a-purchase-request) | Compile a purchase request | Head (from ideals + needs) ✉ → Dean | [Act 4](../04-head.md) |
| [D3](s04-purchasing.md#d3-approve-a-purchase-request) | Approve a purchase request | Dean ✉ → AVP ✉ → CMD ✉ → Proc. ✉ → Head | [Acts 5–8](../05-dean.md) |
| [D4](s04-purchasing.md#d4-send-back-and-revise) | Send back, and revise | Any approver ✉ → Head revises ✉ → chain restarts | [Act 5](../05-dean.md) |
| [D5](s04-purchasing.md#d5-withdraw-reject-or-cancel) | Withdraw, reject or cancel | Head / approver / Proc. ✉ | — |
| [D6](s04-purchasing.md#d6-run-the-order) | Run the order (EGP → arrived) | Proc. ✉ → Head; ✉ → Store | [Act 8](../08-procurement.md) |
| [D7](s04-purchasing.md#d7-follow-a-request) | Follow a request | Everyone involved | — |

## Store and handovers

| # | Story | Flow | Demo |
|---|---|---|---|
| [E1](s05-store.md#e1-receive-a-delivery) | Receive a delivery | Store ✉ → Head | [Act 9](../09-store-keeper.md) |
| [E2](s05-store.md#e2-hand-new-stock-over-to-a-lab) | Hand new stock over to a lab | Store ✉ → Head approves ✉ → Cust. accepts ✉ → Store | [Acts 9–10](../09-store-keeper.md) |

## Transfers between units

| # | Story | Flow | Demo |
|---|---|---|---|
| [F1](s06-transfers.md#f1-borrow-or-take-over-another-units-resource) | Borrow or take over another unit's resource | Cust. requests ✉ → lending Cust. ✉ → owning Head ✉ → receiving Head ✉ → Cust. confirms receipt ✉ | — |

## Bookings

| # | Story | Flow | Demo |
|---|---|---|---|
| [G1](s07-bookings.md#g1-book-a-lab) | Book a lab | Staff ✉ → Cust. approves or declines ✉ → Staff | [Acts 3, 11](../11-bookings.md) |
| [G2](s07-bookings.md#g2-book-specific-machines) | Book specific machines | Staff → Cust. | — |
| [G3](s07-bookings.md#g3-timetable-a-weekly-class) | Timetable a weekly class | Cust. | — |
| [G4](s07-bookings.md#g4-change-your-mind) | Change your mind (cancel) | Staff ✉ → Cust.; Cust. ✉ → Staff | — |

## Outside institutions

| # | Story | Flow | Demo |
|---|---|---|---|
| [H1](s08-external.md#h1-host-an-outside-training) | Host an outside training | Portal ✉ → AVP forwards ✉ → Cust. holds, Head prices ✉ → AVP quotes ✉ → Portal pays ✉ → confirmed | [Act 12](../12-external.md) |
| [H2](s08-external.md#h2-track-a-request-without-an-account) | Track a request without an account | Portal | [Act 12](../12-external.md) |
| [H3](s08-external.md#h3-decline-or-review-a-payment-by-hand) | Decline, or review a payment by hand | AVP ✉ → Portal | — |

## Administration

| # | Story | Flow | Demo |
|---|---|---|---|
| [I1](s09-admin.md#i1-build-the-org-chart) | Build the org chart and fill its posts | Admin ✉ → occupant | [Act 1](../01-admin.md) |
| [I2](s09-admin.md#i2-manage-people-and-roles) | Manage people and roles | Admin, or Head for their staff | [Act 1](../01-admin.md) |
| [I3](s09-admin.md#i3-define-kinds-of-resources) | Define kinds of resources (categories) | Admin, Prop. | [Act 1](../01-admin.md) |
| [I4](s09-admin.md#i4-decide-who-sees-what) | Decide who sees what (access views) | Admin, Prop. → the people it's for | — |
| [I5](s09-admin.md#i5-turn-drafts-on-for-a-department) | Turn drafts on for a department | Admin | — |

## Oversight

| # | Story | Flow | Demo |
|---|---|---|---|
| [J1](s10-oversight.md#j1-plan-maintenance-across-the-university) | Plan maintenance across the university | ICT (read-only, every department) | — |
| [J2](s10-oversight.md#j2-watch-the-whole-university) | Watch the whole university | Prop., Proc., AVP | — |
| [J3](s10-oversight.md#j3-keep-an-eye-on-the-store) | Keep an eye on the store | Store | — |

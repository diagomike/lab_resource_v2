# Running it on production

You can run the same story on the live system, but everything it does is **real**: real requests, bookings, custody moves and emails. Only do this for a planned demonstration, and clean up afterwards.

## Before

- **Accounts:** the role accounts have the same emails as on the demo copy (`cse.head@`, `coeec.dean@`, `avp@`, `cmd@`, `procurement@`, `store.keeper@`, `admin@astu.edu.et`). **Change their `astu1234` passwords** before production is used for real, and give the live passwords only to the people demonstrating.
- **Custodian:** use a lab whose custodian agrees to take part. The ARAs' notification emails are off, so they won't be emailed unless they turn them on.
- **Lecturer:** invite a real staff member, or use a test mailbox you control. Never an `@e2e.test` address on production.
- **Dates:** choose bookings well in the future, on a morning the lab really is free.
- **The outside request:** use your own email as the requester's. Payment on production goes to the **real** bank and telebirr accounts, so either stop at the quote or have the AVP decline it.

## What each act leaves behind, and how to undo it

| Act | Leaves behind | To undo |
|---|---|---|
| 1 | An invited person; bookable labs and computers; the Projector category | Deactivate the person in People & roles. Keep the category settings if you want them; otherwise set them back (every change is logged). |
| 2, 4 | Two monitors marked Broken; the lab's Ideal | Stage *Working* again with a reason, and have the head approve. Or keep the Ideal: it's real planning data. |
| 3 | A need; a booking request | The head declines the need with a note; the lecturer cancels the booking. |
| 4–8 | Purchase request PR-2026-… | Before it's placed: the head **withdraws** it. After: procurement **cancels** it with a note. Stop before *Advance* unless an order really exists. |
| 9–10 | Stock in the Main Store, handed over | Don't receive or hand over unless goods really arrived. Receiving creates real items. |
| 11 | A confirmed booking | The custodian cancels it, with a note. |
| 12 | EXT-2026-… and held slots | The AVP **declines** it with a reason; held slots are released. |

> **Good to know**
> - Nothing can be deleted from the Change log, so a production demo stays visible there, which is intended.
> - The safest demonstration is the demo copy. Production is best for showing the same screens with real people signed in.

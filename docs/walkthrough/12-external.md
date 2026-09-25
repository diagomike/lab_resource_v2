# Act 12 · An outside institution books a training

Another college wants to run a two-day training in a CSE lab. The request comes in through the **public portal**, is forwarded by the **AVP**, priced by the **department**, quoted by the AVP, and paid.

## 1. The request (no sign-in)

Open **http://localhost:3100/portal**, the public portal. It shows what the university can host, as counts only.

![Public portal: anyone can see what ASTU offers](img/12-external/01-portal.jpg)

**Request resources**: the institution, a contact, what it's for, the dates (13 and 14 October, 09:00–12:00), what they need, and the **official letter** (a PDF). **Send request**.

![The request, with an official letter](img/12-external/02-request-form.jpg)

They get a reference (**EXT-2026-001**) and a private tracking link, also emailed.

![A reference and a tracking link, also emailed](img/12-external/03-request-sent.jpg)

## 2. The AVP forwards it (sign in as the AVP)

**External requests** shows the request and its letter. Press **Forward…** (1).

![AVP: the request and its letter](img/12-external/04-avp-request.jpg)

Tick **Computer Science and Engineering**, add a note to the head, and **Forward**.

![Forward it to the departments that can host it](img/12-external/05-forward.jpg)

## 3. The custodian holds the lab; the head prices it

**Sign in as Ali.** In **External requests**, press **Hold a slot…**, and choose the room (1) and each requested window (2). **Hold slot** (3). Do it for both mornings, so nobody else books them meanwhile.

![Custodian: hold the lab so nobody else books it](img/12-external/06-hold-slot.jpg)

**Sign in as the CSE head.** Press **Accept…**, then enter a link to the pricing breakdown (1) and the department's amount (2): ETB 2,000. **Accept** (3).

![Head: accept, with the department's price](img/12-external/07-head-accept.jpg)

## 4. The AVP sends the quote (sign in as the AVP)

Press **Send quote…**, add a note to the requester, and **Send quote**.

![AVP: send one quote for every department's part](img/12-external/08-send-quote.jpg)

## 5. The requester pays (the tracking link, no sign-in)

The tracking page (from the quote email) shows the amount and how to pay:

![Requester: the quote, and how to pay](img/12-external/09-quote.jpg)

Choose how it was paid and enter the transaction number. On the demo copy, telebirr with **FAKE-2000** passes the test verifier. **Verify payment**.

![Requester: enter the payment reference](img/12-external/10-pay.jpg)

Paid in full, the request is **Confirmed**:

![Paid in full — the booking is confirmed](img/12-external/11-confirmed.jpg)

**Sign in as Ali:** on **Schedule → My labs**, the week of 13 October shows both mornings as external bookings.

![Custodian: the held slots are now bookings](img/12-external/12-on-the-calendar.jpg)

> **Good to know**
> - **Emails:** the AVP (new request), the CSE head (forwarded to you), the AVP again (the department accepted), and the requester (received, quote, confirmed) are all emailed. On the demo copy, the requester's emails are in `e2e/mail/`.
> - On the live system, payments are checked with the bank or telebirr. If the check can't reach them, the requester can ask for a manual review by the AVP.

# Payment verification

External requesters (Track 7) pay their quote into the university's account, then confirm the payment on their tracking page by giving the transaction reference from their receipt. The app never trusts that reference on its own. It asks a **self-hosted instance of [verifier-api](https://github.com/Vixen878/verifier-api)**, which fetches the bank's own receipt, and then checks the receipt.

## What the app checks

A receipt counts only if all of the following hold:

1. **The bank shows it as completed**, when the receipt carries a status line.
2. **It paid the university.**
   - The receipt's receiver account must fit the configured account. Masked digits like `1****6789` must line up at both ends.
   - When the receipt shows no account digits, the holder's name decides instead.
3. **It was paid no earlier than the quote was sent.** A minute of slack covers receipt rounding. Receipt times are read as Addis Ababa time.
4. **It was submitted before the payment deadline.**
5. **The reference has never paid for anything else.** `PaymentVerification.claimKey` is unique. A refused attempt does not claim its reference, so a typo can be corrected.

Amounts from several receipts add up (split payments). Once they reach the quote:
- the request becomes **PAID**;
- its held slots become **CONFIRMED** bookings;
- the request becomes **SCHEDULED**;
- the requester, each lab's custodian and the accepting heads are emailed.

If a hold lapsed and its slot was taken in the meantime:
- the request stays **PAID**;
- a `CONFIRMATION_CONFLICT` event names the lost slot and the AVP is emailed;
- a custodian holds a replacement slot, and the AVP presses **Confirm booking**.

**Manual review.** When the verifier can't be reached, or the bank isn't supported, the requester can send the reference for manual review and state the amount. The AVP's office checks the bank statement and accepts (with the amount actually received) or rejects (with a reason the requester sees).

## Configuration

```env
VERIFIER_DRIVER=http                       # or "fake" for local dev / tests
VERIFIER_BASE_URL=https://verifier.internal.example
VERIFIER_API_KEY=...                       # sent as the x-api-key header

PAYMENT_PROVIDERS=CBE,TELEBIRR             # CBE, TELEBIRR, DASHEN, ABYSSINIA, CBEBIRR
PAYMENT_CBE_RECEIVER_ACCOUNT=1000123456789
PAYMENT_CBE_RECEIVER_NAME=Adama Science and Technology University
PAYMENT_TELEBIRR_RECEIVER_NAME=...
```

A provider is offered to requesters only if it is listed **and** has a receiver account or name configured. Without one, any receipt to anyone would pass.

If `VERIFIER_BASE_URL` or `VERIFIER_API_KEY` is missing, every automatic attempt reports that verification isn't set up, and requesters are pointed to manual review.

## What the requester types, per provider

| Provider | Endpoint | Besides the reference |
|---|---|---|
| CBE | `POST /verify-cbe` | last 8 digits of the paying account (`accountSuffix`) |
| telebirr | `POST /verify-telebirr` | none |
| Dashen | `POST /verify-dashen` | none |
| Bank of Abyssinia | `POST /verify-abyssinia` | last 5 digits of the paying account (`suffix`) |
| CBE Birr | `POST /verify-cbebirr` | paying phone number, `2519XXXXXXXX` |

The response fields each one relies on live in `lib/server/payments/verifier/http-driver.ts`. That file parses leniently: amounts may be numbers or strings like `"1,500.00 ETB"`. Parsing of amounts, dates and account masks is unit-tested in `lib/domain/payment-receipt.spec.ts`.

## Deploying verifier-api

- **Where to host it.** telebirr and CBE Birr receipts can only be fetched from Ethiopian IP addresses, so an instance serving them **must be hosted in Ethiopia**. CBE, Dashen and Abyssinia work from anywhere.
- **Access.** Keep the instance private: behind the API key and ideally reachable only from the app's servers.
- **Before go-live.** Run one real verification per enabled provider against the deployed instance. Banks change receipt layouts, and the field names above are the ones documented by verifier-api at the time of writing.

## Local development

Use `VERIFIER_DRIVER=fake` (the `dev-nomail` launch profile sets it). With the fake driver, a reference describes its own receipt:

| Reference | Result |
|---|---|
| `FAKE-18750` or `FAKE-18750.50` | A payment of that many birr to the configured account, made just now. |
| `FAKE-18750-WRONG` | Paid someone else. |
| `FAKE-DOWN` | The verifier is unreachable (offers manual review). |
| Anything else | No such receipt. |

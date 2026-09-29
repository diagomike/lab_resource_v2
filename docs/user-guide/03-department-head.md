# Department head

*You head a department. You don't edit resources yourself: your custodians do. You **approve** what they propose, turn the department's needs into **purchase requests**, and look after your **people**.* Most heads are also staff, so the [Staff chapter](04-staff.md) applies too.

Read [Getting started](00-getting-started.md) and [How LRMS thinks](01-concepts.md) first.

| Task | Section |
|---|---|
| See your department at a glance | [1. Your dashboard and register](#1-your-dashboard-and-register) |
| Approve or send back a lab's update or ideal | [2. Decide lab updates and ideals](#2-decide-lab-updates-and-ideals) |
| See who changed what | [3. The change log](#3-the-change-log) |
| Answer the department's needs | [4. Open needs](#4-open-needs) |
| Compile a purchase request | [5. Compile a purchase request](#5-compile-a-purchase-request) |
| Withdraw a request | [6. Withdraw a request](#6-withdraw-a-request) |
| Invite someone, or help them sign in | [7. Your people](#7-your-people) |
| Revise a request that was sent back | [8. When a request is sent back](#8-when-a-request-is-sent-back) |
| Approve new stock for your labs | [9. Approve a handover](#9-approve-a-handover) |
| Answer an outside institution's request | [10. External requests](#10-external-requests) |


---

## 1. Your dashboard and register

**Dashboard** shows your whole department: every lab, its condition and where the problems are. The scope panel (1) reads **My unit and below**.

![Dashboard — your department](img/head/01-dashboard.jpg)

**Register** shows every lab in your department, read-only for you: there is no **Add resources**, no **Change this…** and no bulk bar. Your custodians keep the records, and you approve them.

![The register, read-only](img/head/15-register-read-only.jpg)

## 2. Decide lab updates and ideals

When a custodian submits a lab's **Draft** (an update of what broke, was renamed, added or removed) or an **Ideal** proposal (what the lab should hold), it comes to you.

1. Open **Lab states**. Each lab shows what is waiting: **draft submitted**, **ideal submitted**, **ideal set**, **no ideal**.

![Lab states: every lab, with what is waiting](img/head/02-lab-states-pending.jpg)

2. Or open **Approvals → Lab commits** to see everything waiting on you in one place. Each card lists exactly what it changes: *Monitor in Workstation 03 › Computer · Status: Working → Broken*, with the custodian's reason in quotes.

![Lab commits waiting for you](img/head/03-approvals-lab-commits.jpg)

### Send it back

If something isn't right, click **Send back** and give a reason. The custodian sees it on the draft, revises and resubmits. Nothing in the register changes.

![Send back with a reason](img/head/04-send-back.jpg)

### Approve

1. Click **Approve** on the card.

   ![Approve the ideal](img/head/05-approve-ideal.jpg)

2. Confirm. You can add an optional note.

   ![Confirm](img/head/06-approve-ideal-confirm.jpg)

- **An approved Draft** applies to the live register in one step, **credited to the custodian**. If anything in the register changed since the draft was copied, nothing is applied, and it goes back to the custodian as **stale**.
- **An approved Ideal** becomes the lab's target. The lab's badge reads **ideal set**, and purchasing now measures the lab against it. The register itself doesn't change.

![Approve the revised draft](img/head/07-approve-draft.jpg)

![After approval: ideal set](img/head/08-lab-states-after.jpg)

> **Good to know:** only a lab's own department head decides its drafts and ideals. Another manager can't, and neither can the dean.

## 3. The change log

**Change log** lists every applied change in your department: when, which item, what changed from and to, **by whom** and **why**. Edits from an approved draft appear under the **custodian's** name, with the reason they gave.

![Change log — credited to the custodian](img/head/09-change-log.jpg)

## 4. Open needs

Anyone in your department (staff, custodians) can **raise a need**: "a projector for B510-R8". Needs aren't purchases. They wait for you.

1. Open **Purchasing**. Under **Compile a purchase request**, **Open needs in this unit** lists each need with who raised it, when and why.

![Open needs in your unit](img/head/10-open-needs.jpg)

2. For each one:
   - **Add to request** carries it into the request you're compiling (section 5). The person who raised it can then follow the request.
   - **Decline…** asks for a reason, which the person who raised it sees, then **Decline need**.

![Decline with a reason](img/head/11-decline-need.jpg)

## 5. Compile a purchase request

1. In **Purchasing → Compile a purchase request**, give it a **Title**.
2. Click **Compute from labs' ideal vs current**. For every category your labs' approved ideals include, you see:
   - **Ideal** and **Current**;
   - **Gap**;
   - **Not working**;
   - **To buy**: exactly what the next step will order. It never counts a part twice: a missing workstation is one *Workstation Setup*, and its computer, monitor and parts come with it. Replacements are for items that failed themselves (broken or lost). An impaired computer is mended by replacing its broken part.
   - **By lab**: open it to see which labs are short.

![Purchasables: what your labs need](img/head/12-purchasables.jpg)

3. Leave **Include replacements for items that are broken or lost** ticked (or untick it), then click **Fill request lines**.
4. Check and edit the lines: name, quantity, unit, category, an estimated unit cost, and justification. Each line's justification already explains itself: ideal vs current, and which labs need it (all of them by name when there are a few, the largest three when there are many). Use **+ Add line** for anything else, and **Add to request** for open needs.

![Request lines, filled — edit before submitting](img/head/13-request-lines.jpg)

5. Under **Supporting documents**, click **Attach minutes or letters** and choose the scanned approval minutes, stamped letters of authority, quotations, and so on. Each file uploads as soon as you choose it; click **×** to remove one before you submit. See [Attaching documents](#attaching-documents) for what's accepted.
6. Click **Submit for approval**. The request gets a reference (**PR-2026-…**) and starts its chain: **your step is already done** (you raised it) → **dean** → **AVP** → **College Managing Director** → **Procurement Office**. Each card shows who it's waiting on.

![Submitted: the approval chain](img/head/14-request-submitted.jpg)

> **Good to know**
> - Serialized items (computers, chairs…) are ordered in whole units. A quantity like 2.5 is refused.
> - Anyone in your department can follow the request's stage. Only roles that may see costs see the estimated costs.

### Attaching documents

Every card shows a **Documents** list: each file, who sent it, and with which action (submitting, approving, sending back, rejecting). Anyone who can follow the request can open them; nobody else can, even with the link.

- **Accepted:** PDF; a photo or scan (JPEG, PNG, WebP); an Excel workbook (**.xlsx**). Macro-enabled workbooks (.xlsm), old .xls/.doc files and password-protected files are refused.
- **Size:** up to **4 MB a file**, **5 files** with one action, and **20 files / 25 MB** on one request over its whole life.
- **Photos shrink themselves.** A phone photo of a letter is resized and saved as a JPEG before it uploads, usually a few hundred KB.
- **PDFs don't.** If a scan is over 4 MB, scan again at **150–200 dpi** (grayscale for plain text), or split a long document into parts. A one-page letter at 200 dpi is well under 1 MB.
- **The same file twice** on one request is refused, even under a different name.
- **Once sent, a file is part of the request's record** and can't be removed. A file you uploaded but never sent is removed when you cancel the form, or after 12 hours.
- Emails say which documents came with a request or decision, but don't carry the files: open the request in the app to read them.

## 6. Withdraw a request

While a request is still being approved, **Withdraw this request** stops it. It asks you to confirm first, and any needs carried into it reopen, so they can go into another request. Once procurement has placed the order, only procurement can cancel it, with a note.

![Withdraw — confirm first](img/head/16-withdraw-request.jpg)

## 7. Your people

**People & roles** lists your department's people.

![Your department's people](img/head/17-people.jpg)

- **Add personnel** invites someone into your department as a **custodian** or **staff**. They get an email with a registration link, and you get a copyable invite link in case the email doesn't arrive.

  ![Invite someone into your department](img/head/18-invite.jpg)

- **Manage** on a person lets you switch their **email notifications** on or off (the CSE ARAs start with them off), for your department's people only.
- **Manage** on a person offers **sign-in help**, for your department's people only:
  - **Email reset link** sends them a password reset;
  - **Set temporary password** shows a one-time password to give them directly, which they must change at their next sign-in;
  - **Copy invite link** is for someone who hasn't accepted yet.

Roles beyond custodian and staff, such as another head, the store keeper or procurement, are set by the system administrator.

## 8. When a request is sent back

If an approver (the dean, say) sends your request back, it shows **Sent back for revision**, with their note, in **Purchasing → My requests**.

![Sent back for revision](img/head/19-sent-back.jpg)

Click **Edit & resubmit**, change what was asked (lines, quantities, justifications), attach anything that was asked for (the documents already on the request stay), then **Resubmit**. The chain starts again at the dean, and the history keeps the note and your revision.

![Edit and resubmit](img/head/20-revise.jpg)

## 9. Approve a handover

When the store keeper hands stock over to one of your labs (after a purchase arrives, for example), or issues something to one of your staff, you approve it first. Then Property Administration approves it, and the lab's custodian (or the member of staff) accepts it. Things issued to your staff sit in your department's **Staff holdings**, which you answer for; you can send them back to the store with **Return to store…** in the Register. Open **Approvals → Transfers**. The card names the items and the destination lab.

![A handover into your department](img/head/21-approve-handover.jpg)

**Approve**, or **Reject** with a reason. Nothing moves until everyone on the chain has said yes.

Transfers between units come to you too: as the owning head when another unit asks for one of your resources, and as the receiving head when one of your custodians asks for something. A **permanent transfer** goes on to the College Managing Director after the heads (and to Property Administration when it crosses colleges); a **loan** ends with you.

Bookings of your labs are decided by each lab's **custodian**, not by you. You can see them, but they don't wait on you.

## 10. External requests

When your dean sends an outside institution's request to your department, you are emailed and it appears in **External requests**, with what they asked for (rooms or labs, or a sample analysis on a machine) and on which dates.

1. Click **Ask custodians…** on your department's line. Say what each custodian should hold — "B510-R8, mornings", "the XRD" — for as many labs as it takes. Leave the others empty. They're emailed.
2. Each custodian holds slots and reports back (**Held** or **Can't**, with a reason). The line shows how many slots each has held.
3. When everyone has answered, click **Send to the dean…** and give:
   - a link to your **cost breakdown** (a spreadsheet) and **your department's amount** in ETB;
   - the **contact persons** the requester should call once they have paid — name, role, phone (and email). The requester sees them only after the AVP confirms the payment.
4. Or **Decline…**, with a reason, if your department can't host it; anything held for it is released.

The dean approves your answer or sends it back with a note (then answer again). The dean sends the college's answer to the AVP, who quotes the requester. Once the payment is confirmed, the held slots become bookings and you're told.

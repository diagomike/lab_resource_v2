# Lab states: drafts and ideals

Each lab has three states side by side on **Lab states**: **Current** (the register), **Draft** (changes waiting for the head) and **Ideal** (what the lab should hold).

![Lab states — your labs](../../user-guide/img/custodian/17-lab-states-list.jpg)

## C1. Update a lab through its draft

**As** a custodian in a drafts department, **I want** my changes collected in the lab's draft and approved together, **so that** the register only ever shows approved changes. **As** the head, I want to see each change with its reason before it goes live.

**Flow:** Cust. stages changes (from the Register, or by editing the draft) → submits ✉ Head → Head approves ✉ Cust. → changes apply to the register, credited to the custodian.

1. Change an item as usual. In CSE the dialog says the change is staged, and the item shows where it went.

   ![CSE uses drafts: the change is staged](../img/02-custodian/02-stage-change.jpg)

   ![Staged in the lab's draft](../img/02-custodian/03-staged-notice.jpg)

2. Or edit the draft's tree directly: statuses, names, additions, removals.

   ![Edit the draft tree directly](../../user-guide/img/custodian/19-draft-edit-tree.jpg)

3. *What it changes* lists every entry, where it sits and its reason. Then **Submit for approval**.

   ![What the draft changes, with the reasons](../img/02-custodian/04-draft-changes.jpg)

4. The head approves from **Approvals → Lab commits**.

   ![The custodian's draft, with each change's reason](../img/04-head/01-approve-draft.jpg)

5. The changes are applied, and the lab's badges show it.

   ![Applied: the monitors are Broken in Current, and the lab has an Ideal](../img/04-head/03-lab-states-after.jpg)

## C2. Send a draft back

**As** a head, **I want** to return a draft with a reason, **so that** the custodian fixes it before it goes live.

**Flow:** Head sends back ✉ Cust. → Cust. revises and resubmits ✉ Head → Head approves.

![Send back with a reason](../../user-guide/img/head/04-send-back.jpg)

![Sent back, with the head's reason](../../user-guide/img/custodian/27-draft-sent-back.jpg)

![Approve the revised draft](../../user-guide/img/head/07-approve-draft.jpg)

## C3. Set what a lab should hold

**As** a custodian, **I want** to propose my lab's ideal contents, **so that** purchasing knows exactly what the lab is short of. **As** the head, I approve it.

**Flow:** Cust. starts a proposal (a copy of the lab), adds or removes → submits ✉ Head → Head approves ✉ Cust. → it becomes the lab's Ideal, which purchasing measures against.

![Start the ideal from the lab as it is](../../user-guide/img/custodian/22-ideal-start.jpg)

![Add five workstations to the ideal](../img/02-custodian/06-ideal-add.jpg)

![Proposal vs Current: five workstations short](../img/02-custodian/07-ideal-vs-current.jpg)

![The lab's ideal: five more workstations](../img/04-head/02-approve-ideal.jpg)

Once new stock arrives and is accepted, the gap closes and nothing is left *Missing*:

![Ideal vs Current: the workstation gap is closed](../img/10-handover/04-gap-closed.jpg)

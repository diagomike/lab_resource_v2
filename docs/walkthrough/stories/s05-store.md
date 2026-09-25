# Store and handovers

## E1. Receive a delivery

**As** the store keeper, **I want** to register what arrived against the order's lines, **so that** the stock exists in the register and the order closes when it's complete.

**Flow:** ✉ Store keeper (order arrived) → registers each line into the ASTU Main Store (partial deliveries add up; over-receipts are refused) → when complete, the request closes ✉ Head.

![Register what arrived, into the Main Store](../img/09-store-keeper/01-receive.jpg)

![More than was ordered is refused](../img/09-store-keeper/02-over-receipt.jpg)

![Everything registered: the request closes](../img/09-store-keeper/03-closed.jpg)

## E2. Hand new stock over to a lab

**As** the store keeper, **I want** to hand stock over to the lab that needs it, named the way the lab names its own. **As** the receiving head and custodian, I approve and accept it.

**Flow:** Store requests a handover ✉ receiving Head → approves ✉ Cust. → accepts into custody ✉ Store ("done"). Custody and ownership move on acceptance; until then the items show ⇄ (promised) and can't be promised twice.

![Tick what goes to the lab, then Hand over](../img/09-store-keeper/04-select-handover.jpg)

![Hand over to B510-R8 — named after the lab's own workstations](../img/09-store-keeper/05-handover.jpg)

![Promised items show ⇄ until the lab accepts them](../img/09-store-keeper/06-promised.jpg)

![Head: a handover into your department](../img/10-handover/01-head-approve.jpg)

![Custodian: accept it into your custody](../img/10-handover/02-custodian-accept.jpg)

![The new workstations and the projector, now in B510-R8](../img/10-handover/03-in-the-lab.jpg)

# How LRMS thinks

*For everyone. Five minutes.* A few ideas explain almost everything the screens do.

## Places, and the things inside them

Everything recorded is either a **place** or a **thing**.

- A **place** is a **lab**, **workshop**, **studio** or **store**. Places are the top of the register: nothing holds them. They are added and managed **from above**: a department's head adds its labs, a college's ADAA its college labs and stores, Property Administration the Main Store. A custodian is **assigned** to a place; custodians never create one.
- A **thing** is everything else, and always sits inside a place, or inside another thing that is made of it.

Things nest. A **lab** holds **workstations**. A workstation holds a **computer**, a **table** and a **chair**. The computer holds a **motherboard** (with **RAM** and **storage**), a **monitor**, a **keyboard** and so on.

```
Software Laboratory — B510-R8          (Lab: block 510, room 8, 20 seats)
├── Workstation 01                     (Workstation Setup)
│   ├── Computer
│   │   ├── Motherboard ─ RAM, Storage
│   │   ├── Monitor, Keyboard, Mouse
│   ├── Table
│   └── Chair
├── Teacher Table, Teacher Chair, Whiteboard
└── Switch Rack ─ Network Switch ×2, Network Outlet 01–20
```

Every resource belongs to a **category** (Lab, Computer, Chair, Chemical or reagent…). The category decides which **details** it records (brand, serial number, calibration due…), what it **comes with** (a workstation comes with a computer, a table and a chair), and how its condition affects what holds it. Many identical items are counted as one row with a quantity. Chemicals, for example, are counted in millilitres or grams.

## Condition travels upwards

Each resource has its own **status**:

| Status | Meaning |
|---|---|
| **Working** | In service |
| **Broken** | Doesn't work |
| **Maintenance** | Away for repair or servicing |
| **Lost** | Can't be found |
| **Consumed** | Used up (chemicals, supplies) |

A container also shows an **effective** status. If a **needed** part is not working, what holds it is **Impaired**. A computer with a dead monitor is impaired, and so is its workstation. A broken chair doesn't impair the workstation around it. The category decides which parts are needed.

Status is always stored on the part itself. Mend or replace the part, and everything above it recovers on its own.

## Three different "whose"

| Word | Meaning |
|---|---|
| **Owning unit** | The department or office the resource belongs to, on the books |
| **Current unit** | Where it physically is right now (it may be on loan) |
| **Custodian** | The one person accountable for it day to day |

Moving a resource to another unit or custodian is a **move** (a loan, a permanent transfer, a handover from the store, a return to it), and moves are approved. You can't simply edit them.

## A lab's changes go to its head

When a custodian changes something in their lab (a status, a name, something added or removed), the register doesn't change straight away. The change is added to the lab's **changes, not sent yet** (the **My changes** tab of the lab). The custodian sends them all together, the **department head approves**, and they apply at once, credited to the custodian. Anything waiting shows a `*` beside it in **Resources**.

The Main Store works directly: the store keeper's changes apply at once. The system administrator's corrections do too.

## Categories belong to the department that made them

Custodians and heads know their machines, so they define the categories for them.

- **Adding** a category, or adding to one (a new optional detail, a new option), applies **at once**, and the department head is told.
- A change that **alters what items already hold** (changing a detail's kind, renaming or removing a detail that has values, making one required) **waits for the head's approval**.
- A change that reaches **another department's items** also goes to the administrator and then Property Administration. The editor suggests the simpler path: **make a copy for your department**.

Changing a detail's kind **converts** the values ("16 GB" becomes 16). Values that can't convert are **kept** on their item as an extra detail, never thrown away.

## What you see, and what you may change

- **You can see the whole university.** Every member of staff can look at any unit's resources (**Resources → Whole university**), to find something and ask for it. **Mine** shows what you look after or manage.
- **Who changes what:**
  - custodians record what is in their labs (through the lab's changes);
  - heads, the ADAA and Property Administration manage places and choose their custodians;
  - heads, deans, the AVP, the College Managing Director and Property Administration approve;
  - the store keeper loads and moves stock;
  - the system administrator sets things up and makes corrections.
- **Everything is logged.** Every applied change records who made it and when. See **History**.

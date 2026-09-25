# How LRMS thinks

*For everyone. Five minutes.* A few ideas explain almost everything the screens do.

## Resources nest inside each other

The register is a tree. A **lab** holds **workstations**. A workstation holds a **computer**, a **table** and a **chair**. The computer holds a **motherboard** (with **RAM** and **storage**), a **monitor**, a **keyboard** and so on. Stores, switch racks and cabinets work the same way.

```
Software Laboratory — B510-R8          (Lab)
├── Workstation 01                     (Workstation Setup)
│   ├── Computer
│   │   ├── Motherboard ─ RAM, Storage
│   │   ├── Monitor, Keyboard, Mouse, Speakers, Cables
│   ├── Table
│   └── Chair
├── Teacher Table, Teacher Chair, Whiteboard
└── Switch Rack ─ Network Switch ×2, Network Outlet 01–20
```

Every resource belongs to a **category** (Lab, Computer, Chair, Chemical…). The category decides which details it records (brand, size, serial number…), what it may be placed inside, and how its condition affects its container. Many identical items are counted as one row with a quantity. Chemicals, for example, are counted in millilitres or grams.

## Condition travels upwards

Each resource has its own **status**:

| Status | Meaning |
|---|---|
| **Working** | In service |
| **Broken** | Doesn't work |
| **Maintenance** | Away for repair or servicing |
| **Lost** | Can't be found |
| **Consumed** | Used up (chemicals, supplies) |

A container also shows an **effective** status. If a **critical** part is not working, its container becomes **Impaired**. A computer with a dead monitor is impaired, and so is its workstation. Parts that aren't critical, such as a broken chair, don't impair the workstation around them. The item's details mark critical parts with **CRITICAL**.

Status is always stored on the part itself. Mend or replace the part, and everything above it recovers on its own.

## Three different "whose"

| Word | Meaning |
|---|---|
| **Owning unit** | The department or office the resource belongs to, on the books |
| **Current unit** | Where it physically is right now (it may be on loan) |
| **Custodian** | The one person accountable for it day to day |

Moving a resource to another unit or another custodian is a **transfer**, and transfers are approved. You can't simply edit them.

## Direct mode and drafts

Each department works in one of two modes:

- **Direct**: a custodian's edit applies at once and is logged. Chemical Engineering works this way today.
- **Drafts**: a custodian's edit is **staged** into the lab's **Draft**. The register doesn't change until the **department head approves** the draft, and then everything applies at once, credited to the custodian. Computer Science and Engineering works this way.

In a drafts department, anything staged shows a `*` beside it in the register.

## Current, Draft and Ideal

The **Lab states** page shows every lab three ways:

| State | What it is | Changes the register? |
|---|---|---|
| **Current** | The lab as it is: the live register | It *is* the register |
| **Draft** | The lab with its pending update (what broke, what was renamed, added or removed) | Yes, once the head approves |
| **Ideal** | What the lab **should** hold: 25 workstations, 25 outlets… | **Never.** Purchasing measures the lab against it |

The gap between Ideal and Current, plus whatever needs attention, is what the department buys.

## What you see, and what you may change

- **Scope** decides which rows you see: your own custody, your unit and everything under it, or the whole university. Two people with the same menu see different rows.
- **Access views** can widen what someone sees, for example a read-only university-wide view for the ICT maintenance office. A view can let someone look without being able to change anything.
- **Who writes:**
  - custodians update the resources they hold;
  - heads, deans, the AVP and the College Managing Director approve;
  - the store keeper receives and hands over stock;
  - the system administrator sets things up and makes corrections.
- **Everything is logged.** Every applied change records who made it and when. See **Change log**.

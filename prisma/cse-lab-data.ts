/**
 * Computer Science and Engineering's real labs — from docs/cse_labs.md ("Lab Holders and
 * Number of Computers required for each lab"): 17 ARA/SARA lab responsibles holding 31
 * rooms in blocks 508–510, each with the number of computers the room still needs.
 *
 * What the document gives is only "required"; the rest is the department's own account
 * of how these rooms are built (confirmed by the user, 2026-09-22):
 *  - every lab was built for 20 workstations and 20 network outlets; the ideal is now 25;
 *  - "required" = broken PCs + the 5 missing to reach 25 — so a lab needing 9 has 20 PCs,
 *    4 of them broken (Ali Kibret's Block 510 R8/R9); a lab needing 25 has all 20 broken;
 *    a lab needing fewer than 5 simply has 25 − required, all working;
 *  - a broken PC is broken by one part — RAM, storage or monitor;
 *  - more than 10 workstation chairs per lab are broken (not critical — the workstation
 *    still works);
 *  - every lab also has a whiteboard, a teacher's table and chair, and a switch rack.
 * Which PCs and chairs are broken is drawn from a PRNG seeded by the room, so every
 * reseed produces the same register.
 *
 * Only each lab's CURRENT state is seeded. Its ideal is created through the product's
 * own flow (Lab states → Ideal), by its custodian, approved by the head.
 */
import type { PrismaClient } from "@prisma/client";
import * as argon2 from "@node-rs/argon2";
import { buildSubtree, type InstantiateCtx } from "../lib/domain/instantiate";
import type { Category, Item as DomainItem } from "../lib/domain/types";

const DEMO_PASSWORD = "astu1234";

interface AraSpec {
  email: string;
  name: string;
  title: string;
}

/** Emails the user supplied for 11 of them (2026-09-22); fname.lname@astu.edu.et for the
 *  other six. Names as the department writes them. */
export const CSE_ARAS: AraSpec[] = [
  { email: "alikibretmuhamed@gmail.com", name: "Ali Kibret Muhamed", title: "ARA/SARA laboratory responsible" },
  { email: "yohanesalemu0069@gmail.com", name: "Yohannes Alemu", title: "ARA/SARA laboratory responsible" },
  { email: "haimanot.kiber@astu.edu.et", name: "Haimanot Kiber Temesgen", title: "ARA/SARA laboratory responsible" },
  { email: "shambel.lemma@astu.edu.et", name: "Shambel Lemma Gadisa", title: "ARA/SARA laboratory responsible" },
  { email: "birhanudamessa@gmail.com", name: "Birhanu Damessa Dibaba", title: "ARA/SARA laboratory responsible" },
  { email: "mesay.shemsu@astu.edu.et", name: "Mesay Shemsu Jemal", title: "ARA/SARA laboratory responsible" },
  { email: "12hach2006@gmail.com", name: "Hachalu Bekele Gadefa", title: "ARA/SARA laboratory responsible" },
  { email: "ephremtesema92@gmail.com", name: "Ephrem Tesema", title: "ARA/SARA laboratory responsible" },
  { email: "fanos.hinika@astu.edu.et", name: "Fanos Hinika Haro", title: "ARA/SARA laboratory responsible" },
  { email: "alemufikadu22@gmail.com", name: "Fikadu Alemu Dadi", title: "SARA laboratory responsible" },
  { email: "birukteferahunde@gmail.com", name: "Biruk Tefera Hunde", title: "ARA/SARA laboratory responsible" },
  { email: "mfirduma@gmail.com", name: "Milki Muleta", title: "ARA/SARA laboratory responsible" },
  { email: "kabetagane22@gmail.com", name: "Kebede Tegene Alemu", title: "ARA/SARA laboratory responsible" },
  { email: "bezawit.girma@astu.edu.et", name: "Bezawit Girma", title: "ARA/SARA laboratory responsible" },
  { email: "regesa.tesema@astu.edu.et", name: "Regesa Tesema", title: "ARA/SARA laboratory responsible" },
  { email: "berhanuendesha28@gmail.com", name: "Berhanu Endesha Bekele", title: "ARA/SARA laboratory responsible" },
  { email: "tamirat.alemu@astu.edu.et", name: "Tamirat Alemu", title: "ARA/SARA laboratory responsible" },
];

interface LabSpec {
  block: number;
  room: number;
  email: string;
  /** "Required Number of Computer" from the document. */
  required: number;
}

/** docs/cse_labs.md, row by row. Ali Kibret's second room is 510-9 — the document says
 *  "509 - 9", but he and the SE electricity/network survey both place it in block 510. */
export const CSE_LABS: LabSpec[] = [
  { block: 510, room: 8, email: "alikibretmuhamed@gmail.com", required: 9 },
  { block: 510, room: 9, email: "alikibretmuhamed@gmail.com", required: 9 },
  { block: 508, room: 15, email: "yohanesalemu0069@gmail.com", required: 11 },
  { block: 508, room: 16, email: "yohanesalemu0069@gmail.com", required: 7 },
  { block: 508, room: 12, email: "haimanot.kiber@astu.edu.et", required: 9 },
  { block: 509, room: 8, email: "haimanot.kiber@astu.edu.et", required: 25 },
  { block: 508, room: 11, email: "shambel.lemma@astu.edu.et", required: 25 },
  { block: 509, room: 7, email: "shambel.lemma@astu.edu.et", required: 7 },
  { block: 509, room: 6, email: "birhanudamessa@gmail.com", required: 15 },
  { block: 510, room: 6, email: "birhanudamessa@gmail.com", required: 15 },
  { block: 509, room: 3, email: "mesay.shemsu@astu.edu.et", required: 25 },
  { block: 510, room: 1, email: "mesay.shemsu@astu.edu.et", required: 4 },
  { block: 509, room: 2, email: "12hach2006@gmail.com", required: 5 },
  { block: 510, room: 11, email: "12hach2006@gmail.com", required: 6 },
  { block: 510, room: 14, email: "ephremtesema92@gmail.com", required: 12 },
  { block: 510, room: 15, email: "ephremtesema92@gmail.com", required: 8 },
  { block: 510, room: 3, email: "fanos.hinika@astu.edu.et", required: 8 },
  { block: 510, room: 5, email: "fanos.hinika@astu.edu.et", required: 9 },
  { block: 509, room: 4, email: "alemufikadu22@gmail.com", required: 9 },
  { block: 510, room: 12, email: "alemufikadu22@gmail.com", required: 6 },
  { block: 510, room: 16, email: "birukteferahunde@gmail.com", required: 6 },
  { block: 508, room: 9, email: "birukteferahunde@gmail.com", required: 4 },
  { block: 510, room: 2, email: "mfirduma@gmail.com", required: 3 },
  { block: 509, room: 1, email: "mfirduma@gmail.com", required: 16 },
  { block: 510, room: 13, email: "kabetagane22@gmail.com", required: 7 },
  { block: 508, room: 13, email: "kabetagane22@gmail.com", required: 25 },
  { block: 508, room: 10, email: "bezawit.girma@astu.edu.et", required: 11 },
  { block: 510, room: 17, email: "regesa.tesema@astu.edu.et", required: 7 },
  { block: 510, room: 4, email: "berhanuendesha28@gmail.com", required: 6 },
  { block: 508, room: 14, email: "berhanuendesha28@gmail.com", required: 6 },
  { block: 509, room: 5, email: "tamirat.alemu@astu.edu.et", required: 25 },
];

export const DESIGNED_FOR = 20;
export const IDEAL = 25;

/** The confirmed rule — how many workstations a lab has, and how many of those PCs are broken. */
export function labCounts(required: number): { present: number; brokenPcs: number } {
  if (required < IDEAL - DESIGNED_FOR) return { present: IDEAL - required, brokenPcs: 0 };
  return { present: DESIGNED_FOR, brokenPcs: Math.min(DESIGNED_FOR, required - (IDEAL - DESIGNED_FOR)) };
}

export const labName = (l: Pick<LabSpec, "block" | "room">) => `Software Laboratory — B${l.block}-R${l.room}`;

/** mulberry32 — small, deterministic, good enough to pick "which ones are broken". */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, from: T[], n: number): T[] {
  const pool = [...from];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/** Find-or-create by email, home unit CSE, CUSTODIAN + STAFF. */
export async function loadOrCreateCseAras(prisma: PrismaClient, cseNodeId: string): Promise<Record<string, string>> {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);
  const idByEmail: Record<string, string> = {};
  for (const p of CSE_ARAS) {
    const emailLower = p.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { emailLower } });
    idByEmail[p.email] =
      existing?.id ??
      (
        await prisma.user.create({
          data: { email: p.email, emailLower, name: p.name, title: p.title, passwordHash, status: "ACTIVE", homeNodeId: cseNodeId, roles: { create: [{ kind: "CUSTODIAN" }, { kind: "STAFF" }] } },
        })
      ).id;
  }
  return idByEmail;
}

export interface CseLabSummary {
  name: string;
  custodian: string;
  required: number;
  present: number;
  brokenPcs: Array<{ workstation: string; cause: string }>;
  brokenChairs: number;
  outlets: number;
}

/** Every CSE lab's current contents, built with the same template expansion the app
 *  itself uses (lib/domain/instantiate.ts). */
export function buildCseLabItems(
  categories: Record<string, Category>,
  catId: (key: string) => string,
  cseNodeId: string,
  custodianIdByEmail: Record<string, string>,
): { items: DomainItem[]; summary: CseLabSummary[] } {
  const now = new Date("2026-09-22T08:00:00Z").toISOString();
  const items: DomainItem[] = [];
  const summary: CseLabSummary[] = [];
  const childOf = (parentId: string, key: string) => items.find((i) => i.parentId === parentId && i.categoryId === catId(key));
  const add = (key: string, parentId: string | null, name: string, ctx: InstantiateCtx, critical = false) => {
    const built = buildSubtree(categories, catId(key), parentId, name, critical, ctx);
    items.push(...built);
    return built[0];
  };

  for (const spec of CSE_LABS) {
    const custodianId = custodianIdByEmail[spec.email];
    if (!custodianId) throw new Error(`No custodian for ${spec.email}`);
    const ctx: InstantiateCtx = { ownerOrgNodeId: cseNodeId, custodianId, now };
    const rand = prng(spec.block * 100 + spec.room);
    const { present, brokenPcs } = labCounts(spec.required);

    const lab = add("lab", null, labName(spec), ctx);
    lab.props.room = `B${spec.block}-R${spec.room}`;
    lab.props.seats = DESIGNED_FOR;
    lab.props.purpose = "Computer Science and Engineering computer laboratory";
    lab.props.source = "docs/cse_labs.md (Lab holders and number of computers required)";

    const setups = Array.from({ length: present }, (_, k) => add("setup", lab.id, `Workstation ${String(k + 1).padStart(2, "0")}`, ctx));
    add("table", lab.id, "Teacher Table", ctx);
    add("chair", lab.id, "Teacher Chair", ctx);
    add("whiteboard", lab.id, "Whiteboard", ctx);
    const rack = add("switchrack", lab.id, "Switch Rack", ctx, true);
    // The template gives 2 switches and 6 outlets; the rooms were wired for 20.
    const outlets = items.filter((i) => i.parentId === rack.id && i.categoryId === catId("outlet"));
    for (let k = outlets.length; k < DESIGNED_FOR; k++) outlets.push(add("outlet", rack.id, "Network Outlet", ctx));
    outlets.forEach((o, k) => (o.name = `Network Outlet ${String(k + 1).padStart(2, "0")}`));
    items
      .filter((i) => i.parentId === rack.id && i.categoryId === catId("netswitch"))
      .forEach((sw, k) => {
        sw.name = `Network Switch ${k + 1}`;
        sw.props.ports = 24;
      });

    const broken: CseLabSummary["brokenPcs"] = [];
    for (const s of pick(rand, setups, brokenPcs)) {
      const pc = childOf(s.id, "computer")!;
      const cause = (["ram", "storage", "monitor"] as const)[Math.floor(rand() * 3)];
      const part = cause === "monitor" ? childOf(pc.id, "monitor")! : childOf(childOf(pc.id, "motherboard")!.id, cause)!;
      part.status = "BROKEN";
      broken.push({ workstation: s.name, cause: categories[part.categoryId]?.name ?? cause });
    }
    const chairs = setups.map((s) => childOf(s.id, "chair")!);
    const brokenChairs = pick(rand, chairs, 11 + Math.floor(rand() * 5));
    for (const c of brokenChairs) c.status = "BROKEN";

    summary.push({
      name: lab.name,
      custodian: spec.email,
      required: spec.required,
      present,
      brokenPcs: broken.sort((a, b) => a.workstation.localeCompare(b.workstation)),
      brokenChairs: brokenChairs.length,
      outlets: outlets.length,
    });
  }
  return { items, summary };
}

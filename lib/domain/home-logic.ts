/**
 * Home's one next step — the single most useful thing this person can do now, as a
 * sentence and a button. Decisions others are waiting on come first (in the order they
 * hold work up), then the person's own unfinished work, then what is falling due.
 * Pure: lib/server/home/home.ts gathers the facts.
 */

export type WaitingKind = "transfer" | "lab-commit" | "purchase" | "booking" | "category-change" | "needs" | "procure" | "arrivals" | "loads" | "external";

export interface WaitingFact {
  kind: WaitingKind;
  count: number;
  path: string;
}
export interface UnfinishedFact {
  label: string;
  detail: string;
  path: string;
}
export interface DueFact {
  itemName: string;
  what: string;
  days: number;
  path: string;
}
export interface NextStep {
  title: string;
  body: string | null;
  path: string;
  action: string;
}

/** Who waits longest on what: a lab's whole batch of changes and moves hold people up
 *  most; arrivals sitting in the store, then needs to build into a request, come after. */
export const WAITING_ORDER: WaitingKind[] = ["lab-commit", "transfer", "booking", "purchase", "procure", "loads", "arrivals", "category-change", "external", "needs"];

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** The short label for each kind, on Home's "Waiting for you" list. */
export const WAITING_LABEL: Record<WaitingKind, string> = {
  "lab-commit": "Lab changes to approve",
  transfer: "Transfers to decide",
  booking: "Booking requests",
  purchase: "Purchase requests to approve",
  loads: "Arrivals to load into the store",
  arrivals: "Arrivals to record",
  "category-change": "Category changes to approve",
  external: "Outside requests",
  needs: "Needs to build into a purchase request",
  procure: "Approved requests to start buying",
};

function waitingStep(w: WaitingFact): NextStep {
  const n = w.count;
  switch (w.kind) {
    case "lab-commit":
      return { title: `${plural(n, "A lab's changes are", "labs' changes are")} waiting for your approval`, body: "Approving applies them to the register; sending them back returns them with your reason.", path: w.path, action: "Review the changes" };
    case "transfer":
      return { title: `${plural(n, "A transfer is", "transfers are")} waiting for your decision`, body: null, path: w.path, action: n === 1 ? "Decide it" : "Decide them" };
    case "booking":
      return { title: `${plural(n, "A booking request is", "booking requests are")} waiting for you`, body: "Someone asked to use a room or machine you run.", path: w.path, action: n === 1 ? "Decide it" : "Decide them" };
    case "purchase":
      return { title: `${plural(n, "A purchase request is", "purchase requests are")} waiting for your approval`, body: null, path: w.path, action: "Review" };
    case "loads":
      return { title: `${plural(n, "An arrival is", "arrivals are")} ready to load into the store`, body: "Property Administration recorded what came in; loading puts it in the register.", path: w.path, action: "Load it" };
    case "arrivals":
      return { title: `${plural(n, "A purchase has", "purchases have")} arrived at the main store`, body: "Record what actually came, so the store keeper can load it.", path: w.path, action: "Record it" };
    case "category-change":
      return { title: `${plural(n, "A category change is", "category changes are")} waiting for your approval`, body: "It changes details items already hold.", path: w.path, action: "Review" };
    case "external":
      return { title: `${plural(n, "An outside request needs", "outside requests need")} you`, body: null, path: w.path, action: "Open" };
    case "needs":
      return { title: `${plural(n, "A need from your labs is", "needs from your labs are")} waiting to be bought`, body: "Choose the ones to build into a purchase request.", path: w.path, action: "Build a request" };
    case "procure":
      return { title: `${plural(n, "An approved request is", "approved requests are")} waiting to be bought`, body: "Start a procurement for them, alone or together.", path: w.path, action: "Start buying" };
  }
}

export function nextStep(facts: { waiting: WaitingFact[]; unfinished: UnfinishedFact[]; dueSoon: DueFact[] }): NextStep | null {
  for (const kind of WAITING_ORDER) {
    const w = facts.waiting.find((x) => x.kind === kind && x.count > 0);
    if (w) return waitingStep(w);
  }
  const u = facts.unfinished[0];
  if (u) return { title: u.label, body: u.detail, path: u.path, action: "Open it" };
  const d = [...facts.dueSoon].sort((a, b) => a.days - b.days)[0];
  if (d && d.days <= 7) {
    const when = d.days < 0 ? `was due ${-d.days} day${d.days === -1 ? "" : "s"} ago` : d.days === 0 ? "is due today" : `is due in ${d.days} day${d.days === 1 ? "" : "s"}`;
    return { title: `${d.what} for ${d.itemName} ${when}`, body: null, path: d.path, action: "Open it" };
  }
  return null;
}

/** Days from `today` to an ISO date ("2027-03-01"), by calendar day. */
export function daysUntil(date: string, today: Date): number {
  const [y, m, d] = date.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const base = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - base) / 86_400_000);
}

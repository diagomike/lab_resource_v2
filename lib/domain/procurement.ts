/**
 * Procurement as a process (2026-10-02). Approval ends at the procurement office, which
 * then STARTS the purchase: one procurement (one EGP purchase) may cover several
 * approved requests, or none (a standalone EGP purchase that never went through LRMS).
 * What is bought starts from the requests' lines and is edited as the purchase really
 * goes; the stage moves forward freely (one click to the next, or straight to a later
 * one); the requests it covers follow it. Pure: the server (lib/server/resources/
 * procurements.ts) persists, the screen shows the same words.
 */
import type { PurchaseStage } from "@/lib/shared";

export const PROCUREMENT_STAGES = ["PREPARING", "PLACED_ON_EGP", "BUYER_FOUND", "ON_DELIVERY", "ARRIVED", "CLOSED", "CANCELLED"] as const;
export type ProcurementStage = (typeof PROCUREMENT_STAGES)[number];

/** The forward line, in order (CANCELLED sits outside it). */
export const PROCUREMENT_LINE: ProcurementStage[] = ["PREPARING", "PLACED_ON_EGP", "BUYER_FOUND", "ON_DELIVERY", "ARRIVED", "CLOSED"];

export const PROCUREMENT_LABEL: Record<ProcurementStage, string> = {
  PREPARING: "Preparing",
  PLACED_ON_EGP: "Placed on EGP",
  BUYER_FOUND: "Supplier found",
  ON_DELIVERY: "On delivery",
  ARRIVED: "Arrived at the main store",
  CLOSED: "In the store",
  CANCELLED: "Cancelled",
};

export const PROCUREMENT_HELP: Record<ProcurementStage, string> = {
  PREPARING: "Choosing what exactly will be bought, from the requests it covers.",
  PLACED_ON_EGP: "The purchase is on the government e-procurement portal.",
  BUYER_FOUND: "A supplier has been awarded it.",
  ON_DELIVERY: "Bought and on its way.",
  ARRIVED: "At the main store. Property Administration checks the counts; the store keeper loads it.",
  CLOSED: "Everything that came is loaded into the store.",
  CANCELLED: "Stopped. The requests it covered are back with procurement.",
};

/** Stages a person moves it to: forward only, any later stage, never CLOSED by hand
 *  (loading closes it) and nothing once it has ended. */
export function movableTo(from: ProcurementStage): ProcurementStage[] {
  if (from === "CLOSED" || from === "CANCELLED" || from === "ARRIVED") return [];
  const at = PROCUREMENT_LINE.indexOf(from);
  return PROCUREMENT_LINE.slice(at + 1).filter((s) => s !== "CLOSED");
}

export function canMove(from: ProcurementStage, to: ProcurementStage): boolean {
  return movableTo(from).includes(to);
}

/** What is bought can be edited until it arrives. */
export function linesEditable(stage: ProcurementStage): boolean {
  return stage !== "ARRIVED" && stage !== "CLOSED" && stage !== "CANCELLED";
}

/** Requests are added while it is still being prepared. */
export function requestsEditable(stage: ProcurementStage): boolean {
  return stage === "PREPARING";
}

export function isLive(stage: ProcurementStage): boolean {
  return stage !== "CLOSED" && stage !== "CANCELLED";
}

/** Where a covered request stands, following its procurement. */
export function requestStageFor(stage: ProcurementStage): PurchaseStage {
  switch (stage) {
    case "PREPARING":
    case "CANCELLED":
      return "WITH_PROCUREMENT";
    case "PLACED_ON_EGP":
      return "ORDER_PLACED";
    case "BUYER_FOUND":
      return "BUYER_FOUND";
    case "ON_DELIVERY":
      return "ON_DELIVERY";
    case "ARRIVED":
      return "IN_STORE";
    case "CLOSED":
      return "CLOSED";
  }
}

export interface LineForDiff {
  id?: string;
  name: string;
  qty: number;
  unit?: string | null;
  unitCost?: number | null;
}

const qtyText = (l: LineForDiff) => `${l.qty}${l.unit ? ` ${l.unit}` : ""}`;

/** What changed in what is bought, in words: "Chair: 412 → 380", "+ Projector: 2",
 *  "− Whiteboard (was 4)". Lines match by id; a new line has none. */
export function describeLineChanges(before: LineForDiff[], after: LineForDiff[]): string[] {
  const out: string[] = [];
  const old = new Map(before.filter((l) => l.id).map((l) => [l.id!, l]));
  const kept = new Set<string>();
  for (const l of after) {
    const was = l.id ? old.get(l.id) : undefined;
    if (!was) {
      out.push(`+ ${l.name}: ${qtyText(l)}`);
      continue;
    }
    kept.add(was.id!);
    const parts: string[] = [];
    if (was.name !== l.name) parts.push(`renamed from "${was.name}"`);
    if (was.qty !== l.qty) parts.push(`${was.qty} → ${l.qty}${l.unit ? ` ${l.unit}` : ""}`);
    if ((was.unitCost ?? null) !== (l.unitCost ?? null)) parts.push(`unit cost ${was.unitCost ?? "–"} → ${l.unitCost ?? "–"}`);
    if (parts.length) out.push(`${l.name}: ${parts.join(", ")}`);
  }
  for (const l of before) if (l.id && !kept.has(l.id)) out.push(`− ${l.name} (was ${qtyText(l)})`);
  return out;
}

/** Arrival counts against what was bought: "Chair: 380 bought, 372 came". */
export function describeArrival(lines: Array<{ name: string; qty: number; arrived: number; unit?: string | null }>): string[] {
  return lines.filter((l) => l.arrived !== l.qty).map((l) => `${l.name}: ${l.qty} bought, ${l.arrived} came${l.unit ? ` (${l.unit})` : ""}`);
}

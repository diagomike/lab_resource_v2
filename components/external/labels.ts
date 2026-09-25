import type { ExternalAssignmentStatus, ExternalRequestStatus } from "@/lib/shared";

/** A department's answer to a forwarded request. */
export const ASSIGNMENT_STATUS_LABEL: Record<ExternalAssignmentStatus, string> = {
  PENDING: "Waiting for the head",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
};

export const EXTERNAL_STATUS_LABEL: Record<ExternalRequestStatus, string> = {
  SUBMITTED: "Received",
  UNDER_REVIEW: "Under review",
  QUOTED: "Quoted — awaiting payment",
  PAYMENT_SUBMITTED: "Payment being verified",
  PAID: "Paid",
  SCHEDULED: "Confirmed",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export function externalStatusTone(status: ExternalRequestStatus): "good" | "warn" | "bad" | "neutral" | "accent" {
  if (status === "SCHEDULED" || status === "PAID") return "good";
  if (status === "QUOTED" || status === "PAYMENT_SUBMITTED") return "accent";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW") return "warn";
  if (status === "DECLINED") return "bad";
  return "neutral";
}

/** Integer santim → "ETB 12,500.00". */
export function formatEtb(santim: number): string {
  return `ETB ${(santim / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "12,500.50" typed by a person → integer santim, or null if it isn't a number. */
export function parseEtb(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

import type { ExternalAssignmentStatus, ExternalRequestKind, ExternalRequestStatus, ExternalTaskStatus } from "@/lib/shared";

/** A college's or department's part, in the words of whoever is looking at the line. */
export function assignmentStatusLabel(level: "COLLEGE" | "DEPARTMENT", status: ExternalAssignmentStatus): string {
  switch (status) {
    case "PENDING":
      return level === "COLLEGE" ? "Waiting for the dean" : "Waiting for the head";
    case "FORWARDED":
      return level === "COLLEGE" ? "Sent to departments" : "Custodians asked";
    case "SUBMITTED":
      return level === "COLLEGE" ? "Answered: AVP to review" : "Answered: dean to review";
    case "APPROVED":
      return "Approved";
    case "RETURNED":
      return "Sent back";
    case "DECLINED":
      return "Declined";
    case "ACCEPTED":
      return "Accepted";
  }
}

export function assignmentTone(status: ExternalAssignmentStatus): "good" | "warn" | "bad" | "accent" | "neutral" {
  if (status === "APPROVED" || status === "ACCEPTED") return "good";
  if (status === "DECLINED") return "bad";
  if (status === "SUBMITTED") return "accent";
  return "warn";
}

export const TASK_STATUS_LABEL: Record<ExternalTaskStatus, string> = { PENDING: "Asked", DONE: "Held", DECLINED: "Can't" };

export const KIND_LABEL: Record<ExternalRequestKind, string> = { FACILITY: "Rooms or labs", SAMPLE_ANALYSIS: "Sample analysis" };

export const EXTERNAL_STATUS_LABEL: Record<ExternalRequestStatus, string> = {
  SUBMITTED: "Received",
  UNDER_REVIEW: "Under review",
  QUOTED: "Quoted: awaiting payment",
  PAYMENT_SUBMITTED: "Payment being checked",
  PAID: "Paid: awaiting confirmation",
  SCHEDULED: "Confirmed",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export function externalStatusTone(status: ExternalRequestStatus): "good" | "warn" | "bad" | "neutral" | "accent" {
  if (status === "SCHEDULED") return "good";
  if (status === "QUOTED" || status === "PAYMENT_SUBMITTED" || status === "PAID") return "accent";
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

/**
 * What a decision button and its dialog say: where the request goes next, in the
 * person's own name, so nobody has to guess what "Approve" means. Read off the chain
 * the card already carries (the step waiting on the viewer and the one after it).
 */

export interface StepLike {
  status: "PENDING" | "WAITING" | "APPROVED" | "REJECTED" | "SKIPPED";
  selector: string;
  label: string;
  approverName: string | null;
  receipt: boolean;
}

/** Who a step waits on, as words: "Hana Bekele (Dean: CoEEC)", or "Dean: CoEEC (vacant)". */
export function whoFor(step: Pick<StepLike, "label" | "approverName">): string {
  return step.approverName ? `${step.approverName} (${step.label})` : `${step.label} (vacant)`;
}

/** The step that comes after the one waiting now, skipping the skipped ones. */
export function nextAfterCurrent<T extends StepLike>(steps: T[]): T | null {
  const at = steps.findIndex((s) => s.status === "PENDING");
  if (at < 0) return null;
  return steps.slice(at + 1).find((s) => s.status === "WAITING") ?? null;
}

export interface DecisionWords {
  /** The approve button. */
  approve: string;
  /** One sentence for the dialog: what happens once they approve. */
  approveMeans: string;
}

/**
 * A transfer: approving sends it to the next person; the receiving custodian takes it
 * into their care; the last step (a receipt) is what changes the register.
 */
export function transferWords(steps: StepLike[]): DecisionWords {
  const current = steps.find((s) => s.status === "PENDING");
  if (current?.selector === "TARGET_CUSTODIAN")
    return { approve: "Accept into my care", approveMeans: "You confirm it has arrived and you now answer for it. The register changes now." };
  if (current?.receipt) return { approve: "Confirm I received it", approveMeans: "You confirm it has physically arrived. The register changes now." };
  const next = nextAfterCurrent(steps);
  if (!next) return { approve: "Approve", approveMeans: "This is the last step: the register changes now." };
  const name = next.approverName ?? next.label;
  if (next.receipt) return { approve: `Approve, then ${name} confirms receipt`, approveMeans: `It goes ahead, and ${whoFor(next)} confirms it arrived.` };
  if (next.selector === "TARGET_CUSTODIAN") return { approve: `Approve and send to ${name}`, approveMeans: `It goes to ${whoFor(next)}, who takes it into their care.` };
  return { approve: `Approve and send to ${name}`, approveMeans: `It goes to ${whoFor(next)} for the next approval.` };
}

/** A purchase request walking the ladder; the procurement office's step is its last. */
export function purchaseWords(steps: StepLike[]): DecisionWords {
  const next = nextAfterCurrent(steps);
  if (!next) return { approve: "Approve: start the purchase", approveMeans: "Every approval is in. The purchase starts with procurement." };
  const name = next.approverName ?? next.label;
  return { approve: `Approve and send to ${name}`, approveMeans: `It goes to ${whoFor(next)} for the next approval.` };
}

/** Sending a purchase request back: who revises it. */
export function sendBackWords(raiserName: string): { label: string; means: string } {
  return { label: `Return to ${raiserName} to revise`, means: `It goes back to ${raiserName} to edit and send again. The approvals start over once they do.` };
}

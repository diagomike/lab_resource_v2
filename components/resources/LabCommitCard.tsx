"use client";

import { useState } from "react";
import Link from "next/link";
import type { LabCommitRequestDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Button, ConfirmDialog, ErrorNote, Tag } from "@/components/ui";

const STATUS_TONE: Record<string, "warn" | "good" | "bad" | "neutral"> = {
  PENDING: "warn",
  APPLIED: "good",
  REJECTED: "bad",
  CANCELLED: "neutral",
  STALE: "bad",
};
const STATUS_TEXT: Record<string, string> = { PENDING: "Waiting for the head", APPLIED: "Approved", REJECTED: "Sent back", CANCELLED: "Withdrawn", STALE: "Couldn't apply" };
const KIND_LINE: Record<string, string> = { changed: "text-text", added: "text-good", removed: "text-bad" };

/**
 * One lab commit — a Draft to merge into the register, or an Ideal proposal — with the
 * readable list of what it changes, and Approve / Send back for the department head.
 */
export function LabCommitCard({ request, onDecided, showLabLink = true }: { request: LabCommitRequestDto; onDecided: () => void; showLabLink?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"APPROVE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");
  const isIdeal = request.targetKind === "IDEAL";

  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/lab-commits/${request.id}/decide`, { decision, note: note || undefined });
      setConfirming(null);
      setNote("");
      onDecided();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record this decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-3 p-12 flex flex-col gap-8">
      <div className="flex items-start justify-between gap-10">
        <div className="min-w-0">
          <div className="text-11.5 font-medium">
            {request.labName} · {isIdeal ? "Ideal proposal" : "Draft update"}
          </div>
          <div className="text-10.5 text-dim">
            by {request.requesterName} · {new Date(request.createdAt).toLocaleString()}
            {request.decidedByName ? ` · decided by ${request.decidedByName}` : ""}
          </div>
        </div>
        <Tag tone={STATUS_TONE[request.status] ?? "neutral"}>{STATUS_TEXT[request.status] ?? request.status}</Tag>
      </div>

      {request.summary.length > 0 ? (
        <ul className="flex flex-col gap-3 text-10.5">
          {request.summary.slice(0, 40).map((s, i) => (
            <li key={i} className="flex gap-6">
              <span className={`min-w-0 font-medium ${KIND_LINE[s.kind]}`}>
                {s.name}
                {s.where && <span className="font-normal text-faint"> in {s.where}</span>}
              </span>
              <span className="text-dim">{s.lines.join(" · ")}</span>
              {s.note && <span className="text-faint italic">“{s.note}”</span>}
            </li>
          ))}
          {request.summary.length > 40 && <li className="text-faint">…and {request.summary.length - 40} more</li>}
        </ul>
      ) : (
        <div className="text-10.5 text-faint">{isIdeal ? "The ideal matches the lab as it is now." : "No changes listed."}</div>
      )}

      {request.resolution && <div className="text-10.5 text-dim italic">“{request.resolution}”</div>}
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-center gap-8 pt-2">
        {request.canDecide && (
          <>
            <Button variant="primary" onClick={() => setConfirming("APPROVE")} disabled={busy}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => setConfirming("REJECT")} disabled={busy}>
              Send back
            </Button>
          </>
        )}
        {request.status === "PENDING" && !request.canDecide && <span className="text-10.5 text-faint">Waiting on {request.labName}&apos;s department head.</span>}
        {showLabLink && (
          <Link href={`/lab-states?lab=${request.labItemId}&tab=${isIdeal ? "ideal" : "draft"}`} className="ml-auto text-10.5 text-accent hover:underline">
            Open in Lab states →
          </Link>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={confirming === "APPROVE" ? (isIdeal ? "Approve this ideal" : "Approve and apply") : "Send back to the custodian"}
          tone={confirming === "APPROVE" ? "primary" : "danger"}
          confirmLabel={confirming === "APPROVE" ? "Approve" : "Send back"}
          busy={busy}
          error={null}
          message={
            <div className="flex flex-col gap-8">
              <span>
                {confirming === "APPROVE"
                  ? isIdeal
                    ? "This becomes the lab's ideal — what purchasing measures it against. The register itself doesn't change."
                    : "Applies these changes to the live register, credited to the custodian. If anything was changed in the register since the draft was copied, nothing is applied and it goes back to them."
                  : "The draft stays as it is — the custodian sees your reason, revises and resubmits."}
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={confirming === "REJECT" ? "Reason (shown to the custodian)" : "Optional note"}
                className="h-24 px-8 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent"
              />
            </div>
          }
          onConfirm={() => decide(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

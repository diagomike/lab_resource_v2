"use client";

import { useState } from "react";
import Link from "next/link";
import type { LabCommitRequestDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Button, ConfirmDialog, ErrorNote, Tag } from "@/components/ui";
import { useToast } from "@/components/toast";

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
 * One lab's changes, sent for approval — the readable list of what they change, and
 * Approve / Send back for the department head.
 */
export function LabCommitCard({ request, onDecided, showLabLink = true }: { request: LabCommitRequestDto; onDecided: () => void; showLabLink?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"APPROVE" | "REJECT" | null>(null);
  const [note, setNote] = useState("");

  async function decide(decision: "APPROVE" | "REJECT") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/lab-commits/${request.id}/decide`, { decision, note: note || undefined });
      setConfirming(null);
      setNote("");
      if (decision === "APPROVE") toast.success(`${request.labName}: the changes are applied`, { href: `/places/${request.labItemId}`, linkLabel: "Open the lab" });
      else toast.success(`${request.labName}: sent back to ${request.requesterName}`);
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
            <Link href={`/places/${request.labItemId}`} className="text-text hover:text-accent">
              {request.labName}
            </Link>{" "}
            · Changes to the lab
          </div>
          <div className="text-11 text-dim">
            by {request.requesterName} · {new Date(request.createdAt).toLocaleString()}
            {request.decidedByName ? ` · decided by ${request.decidedByName}` : ""}
          </div>
        </div>
        <Tag tone={STATUS_TONE[request.status] ?? "neutral"}>{STATUS_TEXT[request.status] ?? request.status}</Tag>
      </div>

      {request.summary.length > 0 ? (
        <ul className="flex flex-col gap-3 text-11">
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
        <div className="text-11 text-faint">No changes listed.</div>
      )}

      {request.resolution && <div className="text-11 text-dim italic">“{request.resolution}”</div>}
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
        {request.status === "PENDING" && !request.canDecide && <span className="text-11 text-faint">Waiting on {request.labName}&apos;s department head.</span>}
        {showLabLink && (
          <Link href={`/places/${request.labItemId}?tab=draft`} className="ml-auto text-11 text-accent hover:underline">
            Open the lab →
          </Link>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={confirming === "APPROVE" ? "Approve and apply" : "Send back to the custodian"}
          tone={confirming === "APPROVE" ? "primary" : "danger"}
          confirmLabel={confirming === "APPROVE" ? "Approve" : "Send back"}
          busy={busy}
          error={null}
          message={
            <div className="flex flex-col gap-8">
              <span>
                {confirming === "APPROVE"
                  ? "Applies these changes to the live register, credited to the custodian. If anything was changed in the register since they started, nothing is applied and it goes back to them."
                  : "The changes stay as they are. The custodian sees your reason, revises and sends them again."}
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={confirming === "REJECT" ? "Reason (shown to the custodian)" : "Optional note"}
                className="h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
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

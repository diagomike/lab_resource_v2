"use client";

import { useState } from "react";
import Link from "next/link";
import type { CategoryChangeDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorNote, Tag } from "@/components/ui";
import { CategoryIcon } from "./IconPicker";

const STATUS: Record<CategoryChangeDto["status"], { label: string; tone: "warn" | "good" | "bad" | "neutral" }> = {
  PENDING: { label: "Waiting", tone: "warn" },
  APPROVED: { label: "Approved", tone: "good" },
  REJECTED: { label: "Not approved", tone: "bad" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  STALE: { label: "Needs redoing", tone: "bad" },
};

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * A category change waiting for approval (or one of your own): what it changes, whose
 * items it reaches, where it stands — and, for whoever decides it now, Approve / Not
 * approved with an optional note.
 */
export function CategoryChangeCard({ change, onChanged, showCategoryLink = true, highlight = false }: { change: CategoryChangeDto; onChanged: (c: CategoryChangeDto) => void; showCategoryLink?: boolean; highlight?: boolean }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "withdraw" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS[change.status];

  async function act(kind: "approve" | "reject" | "withdraw") {
    setBusy(kind);
    setError(null);
    try {
      const next =
        kind === "withdraw"
          ? await api.post<CategoryChangeDto>(`/resources/category-changes/${change.id}/withdraw`, {})
          : await api.post<CategoryChangeDto>(`/resources/category-changes/${change.id}/decide`, { approve: kind === "approve", note: note.trim() || undefined });
      onChanged(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save your decision");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article id={`category-change-${change.id}`} className={`rounded-3 border bg-panel px-12 py-10 flex flex-col gap-8 ${highlight ? "border-accent bg-soft" : "border-border"}`}>
      <header className="flex flex-wrap items-center gap-8">
        <CategoryIcon iconKey={change.categoryIconKey} className="size-16 text-dim" />
        <div className="flex-1 min-w-[200px]">
          <div className="text-12 font-semibold">
            {showCategoryLink ? (
              <Link href={`/categories?id=${change.categoryId}&change=${change.id}`} className="text-text hover:text-accent">
                {change.categoryName}
              </Link>
            ) : (
              change.categoryName
            )}
          </div>
          <div className="text-10.5 text-dim">
            {change.isMine ? "Your change" : `${change.proposedByName}${change.unitName ? ` · ${change.unitName}` : ""}`} · {when(change.createdAt)}
            {change.status === "PENDING" && <> · waiting for {change.waitingOn}</>}
          </div>
        </div>
        <Tag tone={status.tone}>{status.label}</Tag>
      </header>

      <ul className="text-11.5 flex flex-col gap-3 pl-14 list-disc">
        {change.summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {change.note && <p className="text-11 text-dim italic">“{change.note}”</p>}
      {change.reaches.length > 0 && (
        <p className="text-10.5 text-warn">
          Reaches items of {change.reaches.join(", ")} — so it also passes the admin and Property Administration.
        </p>
      )}
      {change.trail.length > 0 && (
        <ol className="text-10.5 text-dim flex flex-col gap-2">
          {change.trail.map((t, i) => (
            <li key={i}>
              {t.approved ? "Approved" : "Not approved"} by {t.byName}, {when(t.at)}
              {t.note ? ` — “${t.note}”` : ""}
            </li>
          ))}
        </ol>
      )}
      {change.status === "STALE" && change.isMine && <p className="text-10.5 text-bad">The category changed before this was approved, so it was not applied over it. Open the category and make your change again.</p>}

      {error && <ErrorNote>{error}</ErrorNote>}
      {change.canDecide && (
        <div className="flex flex-wrap items-center gap-8 pt-6 border-t border-border">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for them (optional)" aria-label="A note for the proposer" className="h-24 flex-1 min-w-[180px] px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent" />
          <Button variant="primary" disabled={busy !== null} onClick={() => act("approve")}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button disabled={busy !== null} onClick={() => act("reject")}>
            {busy === "reject" ? "Saving…" : "Not approved"}
          </Button>
        </div>
      )}
      {change.isMine && change.status === "PENDING" && (
        <div className="pt-6 border-t border-border">
          <Button disabled={busy !== null} onClick={() => act("withdraw")}>
            {busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </Button>
        </div>
      )}
    </article>
  );
}

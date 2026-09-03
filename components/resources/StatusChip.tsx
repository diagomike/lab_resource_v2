import type { EffectiveStatus } from "@/lib/shared";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/domain/status";

/** STATUS_TONE's vocabulary (good/warn/bad/cross/dim/faint) is wider than
 *  components/ui.tsx's Tag (neutral/good/warn/bad/accent/cross) — LOST/CONSUMED have
 *  no Tag equivalent, which is why this is its own small component rather than a Tag
 *  wrapper. See ~/.claude/plans/wait-i-want-gentle-haven.md §6's tone mapping. */
const TONE_CLASS: Record<string, string> = {
  good: "bg-goodbg text-good border-good",
  warn: "bg-warnbg text-warn border-warn",
  bad: "bg-badbg text-bad border-bad",
  cross: "bg-crossbg text-cross border-cross",
  dim: "bg-panel3 text-dim border-border2",
  faint: "bg-panel3 text-faint border-border2",
};

export function StatusChip({ status, title }: { status: EffectiveStatus; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-block border rounded-2 px-6 py-1 text-9.5 font-mono whitespace-nowrap ${TONE_CLASS[STATUS_TONE[status]]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

import { Screen, Panel } from "@/components/ui";
import { EmptyState } from "@/components/states";

/** Shared shape for a nav item whose server-side surface exists (or is planned) but
 *  has no UI yet — named honestly rather than hidden, per
 *  ~/.claude/plans/wait-i-want-gentle-haven.md's Phase 5 (this shell) landing ahead of
 *  the phases that build each of these screens. */
export default function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <Screen>
      <Panel title={title}>
        <EmptyState title="Not built yet" body={body} />
      </Panel>
    </Screen>
  );
}

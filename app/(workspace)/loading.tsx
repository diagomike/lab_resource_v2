import { PanelLoading } from "@/components/states";
import { Panel, Screen } from "@/components/ui";

/** While a screen's code loads: the shape of a panel, not a spinner. */
export default function Loading() {
  return (
    <Screen>
      <Panel>
        <PanelLoading rows={6} />
      </Panel>
    </Screen>
  );
}

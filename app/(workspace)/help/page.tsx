import { Suspense } from "react";
import HelpPage from "@/components/help/HelpPage";
import { PanelLoading } from "@/components/states";

// Open to everyone signed in: what each person sees inside is decided by lib/help/audience.ts.
// Suspense: HelpPage reads ?c= with useSearchParams.
export default function Page() {
  return (
    <Suspense fallback={<div className="p-14"><PanelLoading /></div>}>
      <HelpPage />
    </Suspense>
  );
}

import RequireRole from "@/components/RequireRole";
import ChangeLogPage from "@/components/resources/ChangeLogPage";

// Role-gated in lib/nav.ts: someone without the role gets the friendly "not part of your
// role" page here, not a raw API error over endless loading skeletons.
export default function Page() {
  return (
    <RequireRole>
      <ChangeLogPage />
    </RequireRole>
  );
}

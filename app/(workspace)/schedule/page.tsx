import RequireRole from "@/components/RequireRole";
import SchedulePage from "@/components/scheduling/SchedulePage";

export default function Page() {
  return (
    <RequireRole>
      <SchedulePage />
    </RequireRole>
  );
}

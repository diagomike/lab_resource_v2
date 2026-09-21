import RequireRole from "@/components/RequireRole";
import ExternalRequestsPage from "@/components/external/ExternalRequestsPage";

export default function Page() {
  return (
    <RequireRole>
      <ExternalRequestsPage />
    </RequireRole>
  );
}

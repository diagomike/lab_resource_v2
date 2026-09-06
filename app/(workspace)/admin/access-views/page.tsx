import { Suspense } from "react";
import RequireRole from "@/components/RequireRole";
import AccessViewsPage from "@/components/admin/AccessViewsPage";

export default function Page() {
  return (
    <RequireRole>
      <Suspense>
        <AccessViewsPage />
      </Suspense>
    </RequireRole>
  );
}

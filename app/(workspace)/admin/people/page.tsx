import { Suspense } from "react";
import RequireRole from "@/components/RequireRole";
import PersonnelPage from "@/components/admin/PersonnelPage";

export default function Page() {
  return (
    <RequireRole>
      <Suspense>
        <PersonnelPage />
      </Suspense>
    </RequireRole>
  );
}

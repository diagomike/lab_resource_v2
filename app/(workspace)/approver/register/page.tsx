import { Suspense } from "react";
import RequireRole from "@/components/RequireRole";
import RegisterPage from "@/components/resources/RegisterPage";

export default function Page() {
  return (
    <RequireRole>
      <Suspense>
        <RegisterPage />
      </Suspense>
    </RequireRole>
  );
}

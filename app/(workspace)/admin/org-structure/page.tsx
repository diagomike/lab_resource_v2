"use client";

import dynamic from "next/dynamic";
import RequireRole from "@/components/RequireRole";

const OrgStudioPage = dynamic(() => import("@/components/org-studio/OrgStudioPage"), {
  ssr: false,
});

export default function Page() {
  return (
    <RequireRole>
      <OrgStudioPage />
    </RequireRole>
  );
}

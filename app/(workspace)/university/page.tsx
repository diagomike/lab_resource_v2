import RequireRole from "@/components/RequireRole";
import UniversityPage from "@/components/resources/UniversityPage";

export default function Page() {
  return (
    <RequireRole>
      <UniversityPage />
    </RequireRole>
  );
}

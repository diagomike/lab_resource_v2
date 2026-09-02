import RequireRole from "@/components/RequireRole";
import AdminDashboardPage from "@/components/admin/AdminDashboardPage";

export default function Page() {
  return (
    <RequireRole>
      <AdminDashboardPage />
    </RequireRole>
  );
}

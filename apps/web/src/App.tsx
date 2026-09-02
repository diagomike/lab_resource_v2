import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/shell/AppShell";
import ProtectedRoute from "./components/ProtectedRoute";
import RequireRole from "./components/RequireRole";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import PersonnelPage from "./pages/admin/PersonnelPage";
import OrgStudioPage from "./pages/admin/OrgStudioPage";
import ProfilePage from "./pages/me/ProfilePage";
import RegisterPage from "./pages/resources/RegisterPage";
import LandingRedirect from "./pages/LandingRedirect";

/**
 * Every authenticated route is wrapped twice — ProtectedRoute for "signed in at all", and
 * RequireRole for "allowed here". Neither is the real gate: the API enforces roles and
 * scope independently, and would refuse a hand-typed URL even if both of these were
 * removed. They exist so the UI never shows someone a door they cannot open.
 *
 * The resource register (see the resource-register plan) is the first lab-management
 * module — one RegisterPage mounted at all four workspaces; what differs per workspace
 * is what ItemScopeService returns, which is the correct place for that difference to
 * live, not four different components.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        {/* Admin workspace */}
        <Route
          path="/admin/dashboard"
          element={
            <RequireRole>
              <AdminDashboardPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/people"
          element={
            <RequireRole>
              <PersonnelPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/org-structure"
          element={
            <RequireRole>
              <OrgStudioPage />
            </RequireRole>
          }
        />
        <Route
          path="/admin/register"
          element={
            <RequireRole>
              <RegisterPage />
            </RequireRole>
          }
        />

        {/* Department / Approver / Custodian — the same register, differently scoped */}
        <Route
          path="/department/register"
          element={
            <RequireRole>
              <RegisterPage />
            </RequireRole>
          }
        />
        <Route
          path="/approver/register"
          element={
            <RequireRole>
              <RegisterPage />
            </RequireRole>
          }
        />
        <Route
          path="/custodian/register"
          element={
            <RequireRole>
              <RegisterPage />
            </RequireRole>
          }
        />

        {/* Me */}
        <Route path="/me/profile" element={<ProfilePage />} />

        {/* Role-aware landing, rather than a fixed home every role has to navigate off. */}
        <Route path="/" element={<LandingRedirect />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

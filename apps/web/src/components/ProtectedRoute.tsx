import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth-context";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  // The shell is known before the user is, but until the session resolves we cannot
  // know WHICH shell to draw (scope, modes, counts). A quiet line beats flashing an
  // empty chrome and then rearranging it.
  if (loading) {
    return (
      <div className="h-screen w-full bg-bg flex items-center justify-center text-11.5 text-faint">
        Checking your session…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

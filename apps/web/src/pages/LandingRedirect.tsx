import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import { landingPathFor } from "../lib/nav";
import { SessionCheck } from "../components/states";

/** Sends each role to their workspace's first screen: an admin to personnel, everyone
 *  else to their workspace's placeholder until it is built. */
export default function LandingRedirect() {
  const { me, loading } = useAuth();
  if (loading) return <SessionCheck />;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={landingPathFor(me.workspace, me.user.roles)} replace />;
}

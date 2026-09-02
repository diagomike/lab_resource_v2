import { createContext, useContext, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth-context";
import { workspaceForPath, screenKeyForPath, META } from "../../lib/nav";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import ContentHeader from "./ContentHeader";
import StatusBar from "./StatusBar";

interface ShellHeader {
  crumb?: string;
  title?: string;
  subtitle?: string;
}

/** Lets a screen override the 36px content header without prop-drilling through routes. */
const HeaderContext = createContext<(h: ShellHeader) => void>(() => {});
export function useShellHeader(header: ShellHeader, deps: unknown[] = []) {
  const set = useContext(HeaderContext);
  useEffect(() => {
    set(header);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Thin re-export so existing screens (AssetsPage, TransfersPage, ProfilePage) that import
 *  useMeContext from here keep working unchanged — the underlying fetch now lives in
 *  AuthProvider, which was already making the identical /auth/me call on mount. */
export function useMeContext() {
  return useAuth().me;
}

export default function AppShell() {
  const location = useLocation();
  const { me } = useAuth();
  const [override, setOverride] = useState<ShellHeader>({});
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Reset any screen-supplied header on navigation so a stale title can't leak across,
  // and close the drawer so a mobile user isn't left staring at the menu they just used.
  useEffect(() => {
    setOverride({});
    setDrawerOpen(false);
  }, [location.pathname]);

  // Escape closes the drawer — it is a modal overlay on mobile.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const workspace = workspaceForPath(location.pathname, me?.availableWorkspaces ?? [], me?.workspace ?? "custodian");
  const key = screenKeyForPath(workspace, location.pathname);
  const meta = META[key] ?? ["", "", ""];

  const counts: Record<string, string> = {};
  // Populated once the approvals-inbox count endpoint exists.

  return (
    <HeaderContext.Provider value={setOverride}>
      <div className="h-screen w-full grid grid-rows-[38px_1fr_24px] bg-bg overflow-hidden">
        <TopBar pendingCount={undefined} onOpenMenu={() => setDrawerOpen(true)} />

        {/* Single column below md — the sidebar is lifted out of flow into a drawer. */}
        <div className="grid grid-cols-1 md:grid-cols-[236px_1fr] min-h-0 overflow-hidden relative">
          <div className="hidden md:block min-h-0">
            <Sidebar scope={me?.scope ?? null} counts={counts} />
          </div>

          {/* Mobile drawer */}
          {drawerOpen && (
            <>
              <div
                className="md:hidden fixed inset-0 bg-black opacity-40 z-40"
                onClick={() => setDrawerOpen(false)}
                aria-hidden="true"
              />
              <div className="md:hidden fixed left-0 top-38 bottom-24 w-[min(280px,85vw)] z-50 shadow-none border-r border-border">
                <Sidebar scope={me?.scope ?? null} counts={counts} onNavigate={() => setDrawerOpen(false)} />
              </div>
            </>
          )}

          <div className="flex flex-col min-w-0 min-h-0 bg-panel overflow-hidden">
            <ContentHeader
              crumb={override.crumb ?? meta[0]}
              title={override.title ?? meta[1]}
              subtitle={override.subtitle ?? meta[2]}
            />
            <div className="flex-1 overflow-auto min-h-0" key={workspace}>
              <Outlet />
            </div>
          </div>
        </div>

        <StatusBar scope={me?.scope ?? null} canSeeCost={me?.canSeeCost ?? false} />
      </div>
    </HeaderContext.Provider>
  );
}

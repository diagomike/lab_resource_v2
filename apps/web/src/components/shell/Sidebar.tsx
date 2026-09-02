import { useLocation, useNavigate } from "react-router-dom";
import { navFor, WORKSPACES, workspaceForPath, screenKeyForPath } from "../../lib/nav";
import { useAuth } from "../../lib/auth-context";
import type { ScopeDto, RoleKind } from "@sc-lab/shared";

/** "L2 · leaf · 1 unit" or, for the university offices, "university-wide · 14 units" */
function scopeMeta(scope: ScopeDto): string {
  const parts = scope.isGlobal ? ["university-wide"] : [`L${scope.level}`];
  if (!scope.isGlobal && scope.isLeaf) parts.push("leaf");
  parts.push(`${scope.reachableNodeCount} unit${scope.reachableNodeCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export default function Sidebar({
  scope,
  counts,
  onNavigate,
}: {
  scope: ScopeDto | null;
  counts?: Record<string, string>;
  /** Called after any navigation so the mobile drawer can close itself. */
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { me, logout } = useAuth();
  const roles = (me?.user.roles ?? []) as RoleKind[];
  const available = me?.availableWorkspaces ?? [];
  const workspace = workspaceForPath(location.pathname, available, me?.workspace ?? "custodian");
  const activeKey = screenKeyForPath(workspace, location.pathname);
  const isAdmin = roles.includes("SYS_ADMIN");
  const workspaces = WORKSPACES.filter((w) => available.includes(w.key));

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <div className="bg-panel2 md:border-r border-border flex flex-col min-h-0 h-full overflow-hidden">
      {/* On mobile the workspace switcher has nowhere else to live, so it heads the drawer. */}
      {workspaces.length > 1 && (
        <div className="md:hidden border-b border-border p-8 flex gap-4 flex-none">
          {workspaces.map((w) => {
            const on = workspace === w.key;
            return (
              <button
                key={w.key}
                onClick={() => go(navFor(w.key, roles)[0].items[0].path)}
                style={{
                  background: on ? "var(--accent)" : "var(--panel)",
                  color: on ? "#fff" : "var(--dim)",
                  borderColor: on ? "var(--accent)" : "var(--border2)",
                }}
                className="flex-1 border h-30 rounded-3 text-11.5 font-medium"
              >
                {w.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-12 pt-9 pb-8 border-b border-border flex-none">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold">Your scope</div>
        {scope ? (
          <>
            <div className="flex items-center gap-6 mt-4">
              <div className="w-6 h-6 bg-accent rounded-1 flex-none" />
              <div className="text-12 font-semibold leading-snug">{scope.name}</div>
            </div>
            <div className="text-10.5 text-dim mt-2 font-mono">{scopeMeta(scope)}</div>
          </>
        ) : isAdmin ? (
          // The system admin holds no node on purpose — SYS_ADMIN already grants sight of
          // every node, so giving them one would add a phantom level to the org chart.
          <>
            <div className="flex items-center gap-6 mt-4">
              <div className="w-6 h-6 bg-accent rounded-1 flex-none" />
              <div className="text-12 font-semibold leading-snug">Entire university</div>
            </div>
            <div className="text-10.5 text-dim mt-2 font-mono">system administrator</div>
          </>
        ) : (
          // Custodians, instructors and students occupy no org node. They are not
          // accountable for a unit's register — they keep, use or borrow individual
          // items — and saying so plainly beats an empty panel.
          <div className="text-10.5 text-faint mt-4 leading-normal">
            No unit scope — you work with the individual resources assigned to you.
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-6 pb-10">
        {navFor(workspace, roles).map((group) => (
          <div key={group.label} className="mb-9">
            <div className="text-9.5 uppercase tracking-label text-faint font-semibold px-12 pt-4 pb-3">
              {group.label}
            </div>
            {group.items.map((item) => {
              const on = item.key === activeKey;
              const count = counts?.[item.key] ?? "";
              return (
                <button
                  key={item.key}
                  onClick={() => go(item.path)}
                  style={{
                    borderLeftColor: on ? "var(--accent)" : "transparent",
                    background: on ? "var(--sel)" : "transparent",
                    color: on ? "var(--text)" : "var(--dim)",
                    fontWeight: on ? 600 : 400,
                  }}
                  className="w-full text-left border-0 border-l-2 text-12 pl-10 pr-12 py-6 md:py-4 flex items-center gap-7 leading-relaxed hover:bg-panel3"
                >
                  <span className="w-13 text-center text-10 opacity-75 flex-none">{item.icon}</span>
                  <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
                  {count && (
                    <span
                      style={{ color: on ? "var(--accent)" : "var(--faint)" }}
                      className="text-9.5 font-mono px-4 rounded-2"
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-border py-6 flex-none">
        <button
          onClick={() => void logout().then(() => navigate("/login", { replace: true }))}
          className="w-full text-left border-0 bg-transparent text-dim text-11.5 px-12 py-6 md:py-4 flex items-center gap-7 hover:bg-panel3 hover:text-text"
        >
          <span className="w-13 text-center text-10 opacity-75">⏻</span>Sign out
        </button>
      </div>
    </div>
  );
}

"use client";

import type { ScopeDto } from "@/lib/shared";

export default function StatusBar({ scope, canSeeCost }: { scope: ScopeDto | null; canSeeCost: boolean }) {
  return (
    <div className="bg-top text-topfg flex items-center gap-8 md:gap-12 px-10 text-10.5 flex-none min-w-0 overflow-hidden">
      {scope && (
        <>
          <span className="opacity-85 whitespace-nowrap flex-none max-w-[45vw] md:max-w-none overflow-hidden text-ellipsis">
            {scope.name}
            <span className="hidden sm:inline">
              {scope.isGlobal
                ? " · university-wide"
                : ` · level ${scope.level}${scope.isLeaf ? " · leaf" : ""}`}
            </span>
          </span>
          <span className="opacity-45 whitespace-nowrap flex-none">|</span>
          <span className="opacity-85 whitespace-nowrap flex-none hidden md:inline">
            {scope.reachableNodeCount} unit{scope.reachableNodeCount === 1 ? "" : "s"} in view
          </span>
        </>
      )}
      {!canSeeCost && (
        <>
          <span className="opacity-45 whitespace-nowrap flex-none hidden lg:inline">|</span>
          <span className="opacity-70 whitespace-nowrap flex-none hidden lg:inline">
            cost hidden for your role
          </span>
        </>
      )}

      <div className="flex-1 min-w-8" />

      {/* The standing promise of an asset register is the opposite of the feedback
          system's: nothing here is anonymous. Every change is attributable, and saying so
          on every screen is what makes custodians trust the numbers — and what reminds
          them the register is auditable under the federal property regulations. */}
      <span className="opacity-70 whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
        <span className="hidden lg:inline">
          Every registration, movement and status change is logged and attributable
        </span>
        <span className="lg:hidden">All changes are logged</span>
      </span>
    </div>
  );
}

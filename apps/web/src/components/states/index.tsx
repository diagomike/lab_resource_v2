import type { ReactNode } from "react";

/**
 * The six global states, per the design's `globalStates`. Each is a panel-level
 * component: the shell is already on screen, so none of these ever take over the page.
 */

/** Session check. The chrome is known before the user is, so only the content pane waits —
 *  never a full-page spinner. */
export function SessionCheck() {
  return <div className="px-14 py-12 text-11.5 text-faint">Checking your session…</div>;
}

/** Panel loading. Keeps the header and column labels and greys the rows, so the user
 *  learns what is coming while it comes. */
export function PanelLoading({ rows = 5, label }: { rows?: number; label?: string }) {
  return (
    <div>
      {label && (
        <div className="px-14 py-8 text-11 font-semibold uppercase tracking-widest text-dim border-b border-border">
          {label}
        </div>
      )}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-10 px-14 py-8 border-b border-border">
          <div className="h-10 bg-panel3 rounded-2 flex-1" style={{ opacity: 1 - i * 0.12 }} />
          <div className="h-10 w-64 bg-panel3 rounded-2" style={{ opacity: 1 - i * 0.12 }} />
        </div>
      ))}
    </div>
  );
}

/** Empty. Says what would be here and offers the single action that creates the first
 *  one — never an illustration. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="px-14 py-16 max-w-[560px]">
      <div className="text-13 font-semibold">{title}</div>
      {body && <div className="text-11.5 text-dim leading-loose mt-3">{body}</div>}
      {action && (
        <button
          onClick={action.onClick}
          className="border border-accent bg-accent text-white h-25 px-11 rounded-3 text-11.5 font-medium mt-10"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Permission denied. Names what you tried to reach AND what you actually hold, so a dean
 * who clicked into another faculty understands it is a boundary, not a bug.
 *
 * Two distinct refusals share this component and must not share wording: a SCOPE refusal
 * is about which part of the university you can see, a ROLE refusal is about which parts
 * of the product are yours at all. Telling a teacher their scope is "everything beneath
 * your teacher access" is nonsense.
 */
export function PermissionDenied({
  attempted,
  scope,
  roles,
}: {
  attempted?: string;
  /** Hierarchy node the caller does hold — the scope variant. */
  scope?: string;
  /** Roles the caller holds — the role variant. */
  roles?: string[];
}) {
  const isRoleRefusal = roles != null;

  return (
    <div className="px-14 py-16 max-w-[560px]">
      <div className="flex gap-10">
        <div className="w-3 bg-warn rounded-2 flex-none" />
        <div>
          <div className="text-13 font-semibold">
            {isRoleRefusal ? "That area isn't part of your role" : "That is outside your scope"}
          </div>
          <div className="text-11.5 text-dim leading-loose mt-3">
            {attempted ? (
              <>
                You tried to open <span className="text-text font-mono">{attempted}</span>
                {isRoleRefusal ? ", which is reserved for other roles." : ", which sits outside the part of the university you can see."}
              </>
            ) : isRoleRefusal ? (
              "This area is reserved for other roles."
            ) : (
              "This sits outside the part of the university you can see."
            )}{" "}
            {isRoleRefusal
              ? roles.length > 0 && (
                  <>
                    You are signed in as{" "}
                    <span className="text-text">{roles.map((r) => r.toLowerCase()).join(" and ")}</span>.
                  </>
                )
              : scope && (
                  <>
                    Your scope is <span className="text-text">{scope}</span> and everything beneath it.
                  </>
                )}{" "}
            This is a boundary, not a fault.
          </div>
        </div>
      </div>
    </div>
  );
}

/** Inline error. The API's own message in plain text with a retry, inside the panel that
 *  failed — the rest of the screen keeps working. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="px-14 py-12">
      <div className="flex gap-10">
        <div className="w-3 bg-bad rounded-2 flex-none" />
        <div className="min-w-0">
          <div className="text-12 font-semibold text-bad">Could not load this panel</div>
          <div className="text-11 text-dim leading-loose mt-2">{message}</div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="border border-border2 bg-panel h-23 px-9 rounded-3 text-11 text-dim mt-8"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shared panel-section heading with the hairline rule the design uses everywhere. */
export function SectionRule({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="px-14 pt-9 pb-4 flex items-center gap-10">
      <div className="text-11 font-semibold uppercase tracking-widest text-dim whitespace-nowrap">{label}</div>
      <div className="flex-1 border-t border-border" />
      {children}
    </div>
  );
}

import type { ItemStatus } from "@/lib/shared";

/**
 * Redeclared locally rather than imported from lib/shared's value exports — a freshly
 * re-exported const/object from the shared barrel has failed to resolve under a
 * bundler's cjs-interop before (see components/data-table/config.ts's own note on the
 * same landmine). Client code imports only TYPES from lib/shared; every value it
 * actually needs at runtime is declared here instead.
 */
export const STATUS_LABEL: Record<ItemStatus, string> = {
  WORKING: "Working",
  BROKEN: "Broken",
  UNDER_MAINTENANCE: "Maintenance",
  LOST: "Lost",
  CONSUMED: "Consumed",
};

/**
 * components/ui.tsx's <Tag tone=…> vocabulary, not raw Tailwind classes — the sandbox's
 * STATUS_TONE pointed at ok/info/alt/muted tokens the target palette does not define
 * (tailwind.config.js); this maps onto the tones Tag already knows.
 */
export const STATUS_TAG_TONE: Record<ItemStatus, "good" | "warn" | "bad" | "cross" | "neutral"> = {
  WORKING: "good",
  BROKEN: "bad",
  UNDER_MAINTENANCE: "cross",
  LOST: "warn",
  CONSUMED: "neutral",
};

import "server-only";
import type { RoleKind, ScopeMode } from "@/lib/shared";
import type { AccessViewDto, AccessViewSummaryDto, UpsertAccessViewInput, ViewAudienceDto } from "@/lib/shared";
import type { ItemFilterState } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import { resolveView, viewsForPerson, type AccessView as DomainAccessView, type ViewAudience as DomainViewAudience } from "@/lib/domain/views";
import type { FilterState } from "@/lib/domain/filters";
import type { Person } from "@/lib/domain/types";
import { assertCanBrowseUniversity, rolesOf, type ScopeOverride } from "./scope";

/**
 * Access views — Direction.md's first headline ask: "admin can create views; and
 * then he can give personnel types specific views" so a custodian is filtered to
 * their own custody, a department head to their own subtree, an office to
 * everything or a deliberate slice of it. The Prisma model, Zod contracts, and the
 * pure resolution logic (specificity ranking, audience matching) already existed —
 * lib/domain/views.ts's `viewsForPerson`/`resolveView` — this module is the one
 * place that logic meets the database.
 *
 * ONE INVARIANT, enforced at every call site that reads this module: a view may
 * WIDEN reads (that is the entire point — the university-wide browse seed view is
 * exactly this). A view may NEVER widen writes. `mutate.ts`'s `assertCanMutate`/
 * `assertCanCreateRoot` take no view input at all and stay the write floor
 * regardless of what a person can see; the only thing a view can do to a write is
 * narrow it further via `canEdit: false` — see `resolveEffectiveView`'s own note.
 *
 * Nothing here is auto-applied. With zero `AccessView` rows (today's production
 * state), `resolveEffectiveView` returns `null` for everyone and every caller's
 * existing default-scope behavior is untouched — see this file's own `seed-views.ts`
 * companion script for how an administrator opts a live system into this deliberately.
 */

export interface EffectiveView {
  id: string;
  name: string;
  mode: ScopeMode;
  explicitNodeIds: string[];
  extraFilters: FilterState | null;
  canEdit: boolean;
}

function toItemFilterState(v: unknown): ItemFilterState | null {
  if (!v || typeof v !== "object") return null;
  return v as ItemFilterState;
}

function toDomainAudience(a: { type: string; role: RoleKind | null; personId: string | null }): DomainViewAudience {
  if (a.type === "ROLE") return { type: "ROLE", role: a.role as RoleKind };
  if (a.type === "PERSON") return { type: "PERSON", personId: a.personId as string };
  return { type: "EVERYONE" };
}

type AccessViewRow = Awaited<ReturnType<typeof loadRows>>[number];

function loadRows() {
  return prisma.accessView.findMany({ include: { audiences: { include: { person: { select: { id: true, name: true } } } } }, orderBy: { name: "asc" } });
}

/** `ItemFilterState` (wire) and `FilterState` (domain) are structurally identical by
 *  design — lib/shared/resources/item-filter.ts's own header note — so a stored row
 *  reads directly as either with no adapter step beyond this cast. */
function toDomainFilterState(v: unknown): FilterState | undefined {
  const parsed = toItemFilterState(v);
  return parsed ? (parsed as unknown as FilterState) : undefined;
}

function toDomainView(row: AccessViewRow): DomainAccessView {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    scope: row.scope,
    explicitNodeIds: row.explicitNodeIds,
    extraFilters: toDomainFilterState(row.extraFilters),
    audiences: row.audiences.map(toDomainAudience),
    canEdit: row.canEdit,
    active: row.active,
  };
}

function toDto(row: AccessViewRow): AccessViewDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scope: row.scope,
    explicitNodeIds: row.explicitNodeIds,
    extraFilters: toItemFilterState(row.extraFilters),
    audiences: row.audiences.map((a): ViewAudienceDto => {
      if (a.type === "ROLE") return { type: "ROLE", role: a.role as RoleKind };
      if (a.type === "PERSON") return { type: "PERSON", personId: a.personId as string, personName: a.person?.name ?? "" };
      return { type: "EVERYONE" };
    }),
    canEdit: row.canEdit,
    active: row.active,
  };
}

async function personOf(userId: string): Promise<Person> {
  const [user, roles] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    rolesOf(userId),
  ]);
  return { id: userId, name: user?.name ?? "", homeOrgNodeId: null, roles };
}

/**
 * The single resolution point every read AND write threads through. `chosenViewId`
 * is never trusted blindly — it is only honoured if it names a view this person may
 * actually choose (`viewsForPerson`); otherwise (or when omitted/null) this falls
 * back to their most specific default, matching lib/domain/views.ts's own
 * `resolveView` contract exactly.
 *
 * Returns `null` when the person has NO views assigned at all — the universal
 * "nothing configured yet" case every existing caller's default-scope resolution
 * already handles correctly on its own.
 */
export async function resolveEffectiveView(userId: string, chosenViewId?: string | null): Promise<EffectiveView | null> {
  const [rows, person] = await Promise.all([loadRows(), personOf(userId)]);
  const domainViews = rows.filter((r) => r.active).map(toDomainView);
  const resolved = resolveView(person, domainViews, chosenViewId ?? null);
  if (!resolved) return null;
  return {
    id: resolved.id,
    name: resolved.name,
    mode: resolved.scope,
    explicitNodeIds: resolved.explicitNodeIds ?? [],
    extraFilters: (resolved.extraFilters as unknown as FilterState) ?? null,
    canEdit: resolved.canEdit,
  };
}

export interface ReadOverride {
  scope?: ScopeOverride;
  extraFilters?: FilterState | null;
}

/**
 * Resolves the two read-override mechanisms a route handler may honour into one
 * value: the university-wide browse (`?scope=UNIVERSITY`, 10b of
 * ~/.claude/plans/three-product-changes-dynamic-thompson.md — always gated by
 * `assertCanBrowseUniversity` first, exactly as before this module existed) and an
 * access view (`?view=<id>`, Track 1). At most one is ever active in practice — every
 * `/university` call site sets `scope=UNIVERSITY` and never a view id, and the
 * sidebar's view picker only ever rides along on ordinary (non-university) reads —
 * but if a request somehow carried both, the browse override wins, since it is the
 * one already gated and tested. A client-supplied view id is never trusted blindly:
 * `resolveEffectiveView` re-validates it names a view this person may actually
 * choose before using it for anything. */
export async function resolveReadOverride(userId: string, sp: URLSearchParams): Promise<ReadOverride> {
  if (sp.get("scope") === "UNIVERSITY") {
    await assertCanBrowseUniversity(userId);
    return { scope: { mode: "UNIVERSITY" } };
  }
  const view = await resolveEffectiveView(userId, sp.get("view"));
  if (!view) return {};
  return { scope: { mode: view.mode, explicitNodeIds: view.explicitNodeIds }, extraFilters: view.extraFilters };
}

/** Every view this person may choose between, most specific first — MeContextDto's
 *  `views` field, and the sidebar picker's option list. */
export async function listSummariesForPerson(userId: string): Promise<AccessViewSummaryDto[]> {
  const [rows, person] = await Promise.all([loadRows(), personOf(userId)]);
  const domainViews = rows.filter((r) => r.active).map(toDomainView);
  const available = viewsForPerson(person, domainViews);
  return available.map((v) => ({ id: v.id, name: v.name, scope: v.scope, canEdit: v.canEdit }));
}

// ── Admin CRUD — SYS_ADMIN and PROPERTY_ADMIN administer shared vocabulary, the
//    same pairing categories.ts already uses (open item 4 of
//    ~/.claude/plans/wait-i-want-gentle-haven.md, settled the same way here). ──────

export async function list(): Promise<AccessViewDto[]> {
  const rows = await loadRows();
  return rows.map(toDto);
}

export async function getOne(id: string): Promise<AccessViewDto> {
  const row = await prisma.accessView.findUnique({ where: { id }, include: { audiences: { include: { person: { select: { id: true, name: true } } } } } });
  if (!row) throw new HttpError(404, "View not found");
  return toDto(row);
}

/** Audiences are replaced wholesale on every save — the same convention
 *  `CategoryField` rows already follow on a category edit, and simplest to reason
 *  about for a vocabulary this small (an institution has a handful of views, not
 *  hundreds). */
export async function upsert(input: UpsertAccessViewInput): Promise<AccessViewDto> {
  const data = {
    name: input.name,
    description: input.description ?? null,
    scope: input.scope,
    explicitNodeIds: input.scope === "EXPLICIT_NODES" ? input.explicitNodeIds : [],
    extraFilters: input.extraFilters ?? undefined,
    canEdit: input.canEdit,
    active: input.active,
  };

  const row = await prisma.$transaction(async (tx) => {
    const view = input.id
      ? await tx.accessView.update({ where: { id: input.id }, data })
      : await tx.accessView.create({ data });
    await tx.accessViewAudience.deleteMany({ where: { viewId: view.id } });
    if (input.audiences.length) {
      await tx.accessViewAudience.createMany({
        data: input.audiences.map((a) => ({
          viewId: view.id,
          type: a.type,
          role: a.type === "ROLE" ? a.role : null,
          personId: a.type === "PERSON" ? a.personId : null,
        })),
      });
    }
    return tx.accessView.findUniqueOrThrow({ where: { id: view.id }, include: { audiences: { include: { person: { select: { id: true, name: true } } } } } });
  });

  return toDto(row);
}

export async function remove(id: string): Promise<void> {
  const existing = await prisma.accessView.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, "View not found");
  await prisma.accessView.delete({ where: { id } });
}

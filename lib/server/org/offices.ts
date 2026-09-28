import "server-only";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";
import type { OrgNode as DomainOrgNode } from "@/lib/domain/types";

/**
 * The university-wide offices that approval chains name directly — none of them is an
 * ancestor of anything, so a chain reaches them by NODE_OCCUPANT, never by walking the
 * org chart:
 *  - Procurement Office (PROC): the last step of every purchase request.
 *  - College Managing Director (CMD): purchases (between the deans and the AVP) and every
 *    permanent transfer of ownership.
 *  - Property Administration (PROP): every movement in or out of the Main Store, and a
 *    permanent transfer that crosses colleges.
 *
 * Resolved by the node's stable `code` first (F-006 of the 2026-09-15 campaign: a name
 * lookup broke purchasing university-wide the moment the office was renamed), then by
 * the exact name, for an install that hasn't set the code yet. Resolved live, never
 * cached. Ambiguity always refuses — silently picking one of two offices would route a
 * decision to the wrong person.
 */
export interface OfficeSpec {
  code: string;
  name: string;
  /** What the missing office stops, for the refusal message. */
  neededFor: string;
}

export const PROCUREMENT_OFFICE: OfficeSpec = { code: "PROC", name: "Procurement Office", neededFor: "raising a purchase request" };
export const CMD_OFFICE: OfficeSpec = { code: "CMD", name: "College Managing Director", neededFor: "this approval" };
export const PROPERTY_OFFICE: OfficeSpec = { code: "PROP", name: "Property Administration", neededFor: "moving resources in or out of the Main Store" };

function asDomain(row: { id: string; name: string; kind: DomainOrgNode["kind"]; level: number; userId: string | null; active: boolean }, nodes?: DomainOrgNode[]): DomainOrgNode {
  return nodes?.find((n) => n.id === row.id) ?? { id: row.id, name: row.name, kind: row.kind, level: row.level, parentIds: [], occupantId: row.userId, active: row.active };
}

/** The office, or null when the chart has none. */
export async function findOffice(spec: OfficeSpec, nodes?: DomainOrgNode[]): Promise<DomainOrgNode | null> {
  const byCode = await prisma.orgNode.findFirst({ where: { kind: "OFFICE", active: true, code: spec.code } });
  if (byCode) return asDomain(byCode, nodes);

  const matches = await prisma.orgNode.findMany({ where: { kind: "OFFICE", active: true, name: spec.name } });
  if (matches.length > 1) {
    throw new HttpError(
      400,
      `More than one active "${spec.name}" office exists on the org chart. Ask an administrator to give the real one the code "${spec.code}", or deactivate the extra one.`,
    );
  }
  return matches[0] ? asDomain(matches[0], nodes) : null;
}

/** The office, refusing clearly when the chart has none. */
export async function requireOffice(spec: OfficeSpec, nodes?: DomainOrgNode[]): Promise<DomainOrgNode> {
  const office = await findOffice(spec, nodes);
  if (!office) {
    throw new HttpError(
      400,
      `No ${spec.name} exists on the org chart yet, which ${spec.neededFor} needs. Ask an administrator to create one (an Office-kind node with code "${spec.code}", or named exactly "${spec.name}").`,
    );
  }
  return office;
}

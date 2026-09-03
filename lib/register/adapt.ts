import type { ItemRowDto } from "@/lib/shared";
import type { Item } from "@/lib/domain/types";

/**
 * `ItemRowDto` (the wire shape items.ts's search/tree endpoints return) → the domain
 * `Item` shape `lib/domain/tree.ts`'s `buildTree`/`buildRollup`/`buildSearchList` are
 * written against. That module's own header says it is "imported by both Route
 * Handlers and client components" — this is the client half of that: the SERVER
 * already resolved scope, filtering and effective status (see
 * lib/server/resources/items.ts's own header on why); the CLIENT's only job is
 * shaping the resulting flat row list into a tree/cluster structure, reusing the
 * exact same pure grouping code the server's own design assumes will run here too.
 *
 * `images`/timestamps are not carried by the row DTO (only the detail DTO has them)
 * and are not read by anything in tree.ts's grouping functions, so empty/blank
 * stand-ins are harmless here.
 */
export function toDomainItem(row: ItemRowDto): Item {
  return {
    id: row.id,
    parentId: row.parentId,
    categoryId: row.categoryId,
    name: row.name,
    qty: row.qty,
    status: row.status,
    critical: row.critical,
    props: row.props,
    images: [],
    ownerOrgNodeId: row.ownerOrgNodeId,
    currentOrgNodeId: row.currentOrgNodeId,
    custodianId: row.custodianId,
    version: row.version,
    createdAt: "",
    updatedAt: "",
  };
}

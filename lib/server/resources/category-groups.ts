import "server-only";
import { Prisma } from "@prisma/client";
import type { CategoryGroupDto, CreateCategoryGroupInput, RenameCategoryGroupInput } from "@/lib/shared";
import { prisma } from "../prisma";
import { HttpError } from "../http-error";

/**
 * The managed category-group vocabulary — the "shelves" categories are filed under,
 * shared by every picker in the Category Studio. Ported behaviorally from
 * temp_works/src/app/categories/page.tsx's `GroupManager` (rename-sweeps-membership,
 * delete-only-while-empty), against the real `CategoryGroup` Prisma model rather than
 * a client-side Zustand array of bare strings.
 */

function toDto(row: { id: string; name: string; sortOrder: number }): CategoryGroupDto {
  return { id: row.id, name: row.name, sortOrder: row.sortOrder };
}

export async function list(): Promise<CategoryGroupDto[]> {
  const rows = await prisma.categoryGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map(toDto);
}

/** Case-insensitive uniqueness — "IT", "I.T." and "it" are the same shelf, not three.
 *  Checked explicitly (rather than left to the DB's case-sensitive `@unique`) so a
 *  collision is a clean 400, not a raw constraint error. */
async function assertNameAvailable(name: string, excludeId?: string): Promise<void> {
  const existing = await prisma.categoryGroup.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) throw new HttpError(400, `A group named "${name}" already exists`);
}

/** Ordering stays deterministic without a dedicated reorder UI — each new group is
 *  appended after every existing one, and listings always sort by `sortOrder` then
 *  name, so a group's position never depends on when it happens to be queried. */
export async function create(input: CreateCategoryGroupInput): Promise<CategoryGroupDto> {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, "Group name is required");
  await assertNameAvailable(name);
  const sortOrder = await prisma.categoryGroup.count();
  try {
    const row = await prisma.categoryGroup.create({ data: { name, sortOrder } });
    return toDto(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(400, `A group named "${name}" already exists`);
    }
    throw err;
  }
}

/** Renaming preserves the group's id — every category's `groupId` is untouched, so
 *  membership survives the rename automatically; this is a name column update, not a
 *  re-key. */
export async function rename(id: string, input: RenameCategoryGroupInput): Promise<CategoryGroupDto> {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, "Group name is required");
  const existing = await prisma.categoryGroup.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Group not found");
  await assertNameAvailable(name, id);
  try {
    const row = await prisma.categoryGroup.update({ where: { id }, data: { name } });
    return toDto(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(400, `A group named "${name}" already exists`);
    }
    throw err;
  }
}

/** Blocked while any category is still filed under it, deliberately — an empty group
 *  can be deleted deliberately, matching temp_works' own rule. `ResourceCategory.groupId`
 *  is `onDelete: Restrict`, so this check keeps the failure a clean 409 rather than a
 *  raw constraint error the route would otherwise have to translate. */
export async function remove(id: string): Promise<void> {
  const existing = await prisma.categoryGroup.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Group not found");
  const inUse = await prisma.resourceCategory.count({ where: { groupId: id } });
  if (inUse > 0) {
    throw new HttpError(409, "Cannot delete group", {
      message: `Cannot delete "${existing.name}" — ${inUse} categor${inUse === 1 ? "y" : "ies"} still filed under it`,
      code: "DELETE_BLOCKED",
      itemCount: inUse,
    });
  }
  await prisma.categoryGroup.delete({ where: { id } });
}

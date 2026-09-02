import { Injectable } from "@nestjs/common";
import type { CategoryField, ResourceCategory } from "@prisma/client";
import type { CategoryDto } from "@sc-lab/shared";
import { PrismaService } from "../prisma/prisma.service";

type CategoryRow = ResourceCategory & {
  group: { name: string };
  fields: CategoryField[];
};

/**
 * Category reads. Categories carry no scope of their own — the schema vocabulary is
 * readable by anyone signed in, the same reasoning org.controller.ts's list() uses for
 * the org chart's names. Category ADMINISTRATION (create/update/version conflicts/
 * default-child templates) lands with category administration later.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(includeInactive: boolean): Promise<CategoryDto[]> {
    const rows = await this.prisma.resourceCategory.findMany({
      where: includeInactive ? {} : { active: true },
      include: { group: true, fields: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ group: { sortOrder: "asc" } }, { name: "asc" }],
    });
    return rows.map(toDto);
  }
}

function toDto(r: CategoryRow): CategoryDto {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    iconKey: r.iconKey,
    groupId: r.groupId,
    groupName: r.group.name,
    countingMode: r.countingMode,
    unit: r.unit,
    impairRule: r.impairRule,
    defaultImageKey: r.defaultImageKey,
    version: r.version,
    active: r.active,
    fields: r.fields.map((f) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options,
      unit: f.unit,
      summary: f.summary,
      longText: f.longText,
      required: f.required,
      sortOrder: f.sortOrder,
    })),
  };
}

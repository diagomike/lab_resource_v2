import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { PersonSummaryDto } from "@sc-lab/shared";
import { SessionGuard } from "../auth/session.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Just enough of a people directory to power pickers — a handover recipient, a transfer
 * contact. The full people/roles management screen is deliberately out of this phase.
 */
@Controller("people")
@UseGuards(SessionGuard, RolesGuard)
export class PeopleController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("custodians")
  @Roles("CUSTODIAN", "PROPERTY_ADMIN")
  async custodians(@Query("q") q?: string): Promise<PersonSummaryDto[]> {
    const rows = await this.prisma.user.findMany({
      where: {
        roles: { some: { kind: "CUSTODIAN" } },
        status: "ACTIVE",
        ...(q?.trim() ? { name: { contains: q.trim(), mode: "insensitive" } } : {}),
      },
      include: { homeNode: { select: { name: true } } },
      orderBy: { name: "asc" },
      take: 50,
    });
    return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, homeNodeName: r.homeNode?.name ?? null }));
  }
}

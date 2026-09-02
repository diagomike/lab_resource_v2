import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AssignNodeInput, CreatePersonInput, UpdatePersonRolesInput } from "@sc-lab/shared";
import { SessionGuard } from "../auth/session.guard";
import { CurrentUser, type AuthedUser } from "../common/current-user.decorator";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod.pipe";
import { PeopleService } from "./people.service";

/**
 * The personnel register — who exists in the system, what they hold, and who put them
 * there. Distinct from org/people.controller.ts's `GET /people/custodians`, which is a
 * narrow picker for handover/transfer forms and stays exactly as it was; every route here
 * is new and none of them share a path shape with it (no bare `GET /people/:id`), so the
 * two controllers coexist without collision.
 */
const MANAGERIAL = ["SYS_ADMIN", "MANAGER"] as const;

@Controller("people")
@UseGuards(SessionGuard, RolesGuard)
export class PersonnelController {
  constructor(private readonly people: PeopleService) {}

  @Get()
  @Roles(...MANAGERIAL)
  async list(@CurrentUser() user: AuthedUser) {
    return this.people.list(user.id, user.roles);
  }

  @Post()
  @Roles(...MANAGERIAL)
  async create(@CurrentUser() user: AuthedUser, @Body(new ZodValidationPipe(CreatePersonInput)) body: CreatePersonInput) {
    return this.people.create(user.id, user.roles, body);
  }

  @Post(":id/roles")
  @Roles("SYS_ADMIN")
  async updateRoles(@Param("id") id: string, @Body(new ZodValidationPipe(UpdatePersonRolesInput)) body: UpdatePersonRolesInput) {
    return this.people.updateRoles(id, body);
  }

  @Post(":id/deactivate")
  @Roles("SYS_ADMIN")
  async deactivate(@Param("id") id: string) {
    return this.people.deactivate(id);
  }

  @Post(":id/reactivate")
  @Roles("SYS_ADMIN")
  async reactivate(@Param("id") id: string) {
    return this.people.reactivate(id);
  }

  @Post(":id/resend-invite")
  @Roles(...MANAGERIAL)
  async resendInvite(@CurrentUser() user: AuthedUser, @Param("id") id: string) {
    await this.people.resendInvite(user.id, user.roles, id);
    return { ok: true };
  }

  @Post(":id/assign-node")
  @Roles("SYS_ADMIN")
  async assignNode(
    @CurrentUser() user: AuthedUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AssignNodeInput)) body: AssignNodeInput,
  ) {
    return this.people.assignNode(user.id, id, body.nodeId, body.reason);
  }
}

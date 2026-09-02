import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  ChangeNodeLevelInput,
  CreateOrgEdgeInput,
  CreateOrgNodeInput,
  ReassignParentsInput,
  UpdateOrgNodeInput,
  type OrgNodeDto,
} from "@sc-lab/shared";
import { SessionGuard } from "../auth/session.guard";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod.pipe";
import { OrgService } from "./org.service";

@Controller("org")
@UseGuards(SessionGuard, RolesGuard)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  /** Readable by anyone signed in — the org chart names the units, not their contents. */
  @Get("nodes")
  async list(@Query("scope") scope?: string): Promise<OrgNodeDto[]> {
    return this.org.list(scope !== "all");
  }

  @Post("nodes")
  @Roles("SYS_ADMIN")
  async create(@Body(new ZodValidationPipe(CreateOrgNodeInput)) body: CreateOrgNodeInput) {
    return this.org.create(body);
  }

  @Post("edges")
  @Roles("SYS_ADMIN")
  async addEdge(@Body(new ZodValidationPipe(CreateOrgEdgeInput)) body: CreateOrgEdgeInput) {
    await this.org.addEdge(body.parentId, body.childId);
    return { ok: true };
  }

  @Patch("nodes/:id")
  @Roles("SYS_ADMIN")
  async update(@Param("id") id: string, @Body(new ZodValidationPipe(UpdateOrgNodeInput)) body: UpdateOrgNodeInput) {
    return this.org.update(id, body);
  }

  /** Revokes the current occupant (if any) and marks the node inactive in one step. */
  @Post("nodes/:id/deactivate")
  @Roles("SYS_ADMIN")
  async deactivate(@Param("id") id: string) {
    return this.org.deactivateNode(id);
  }

  @Post("nodes/:id/reactivate")
  @Roles("SYS_ADMIN")
  async reactivate(@Param("id") id: string) {
    return this.org.reactivateNode(id);
  }

  /** Replaces which parent(s) this node reports under — level-adjacency enforced
   *  server-side, same as node creation. */
  @Put("nodes/:id/parents")
  @Roles("SYS_ADMIN")
  async reassignParents(@Param("id") id: string, @Body(new ZodValidationPipe(ReassignParentsInput)) body: ReassignParentsInput) {
    return this.org.reassignParents(id, body.parentIds);
  }

  /** Severs every edge this node holds in either direction — nothing is auto-reconnected,
   *  the admin redraws them afterward via reassignParents/addEdge. */
  @Post("nodes/:id/change-level")
  @Roles("SYS_ADMIN")
  async changeLevel(@Param("id") id: string, @Body(new ZodValidationPipe(ChangeNodeLevelInput)) body: ChangeNodeLevelInput) {
    return this.org.changeLevel(id, body.level);
  }

  /** Real deletion, only when nothing depends on the node — see org.service.ts's
   *  deleteNode for the full blocker list. */
  @Delete("nodes/:id")
  @Roles("SYS_ADMIN")
  async remove(@Param("id") id: string) {
    await this.org.deleteNode(id);
    return { ok: true };
  }
}

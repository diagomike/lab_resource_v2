import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateOrgNodeInput,
  DeactivateNodeResultDto,
  OrgNodeDto,
  UpdateOrgNodeInput,
} from "@sc-lab/shared";
import { PrismaService } from "../prisma/prisma.service";
import { computeClosureRows, wouldCreateCycle } from "./closure-algorithm";

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  async list(activeOnly: boolean): Promise<OrgNodeDto[]> {
    const nodes = await this.prisma.orgNode.findMany({
      where: activeOnly ? { active: true } : {},
      include: { user: true, incomingEdges: true, residents: { select: { id: true } } },
      orderBy: [{ level: "asc" }, { name: "asc" }],
    });

    return nodes.map((n) => ({
      id: n.id,
      name: n.name,
      level: n.level,
      kind: n.kind,
      active: n.active,
      parentIds: n.incomingEdges.map((e) => e.parentId),
      occupant: n.user ? { id: n.user.id, name: n.user.name, email: n.user.email } : null,
      // TODO: fold in owned Location/Asset/StockLine/etc. counts once those modules ship.
      hasOwnedContent: n.residents.length > 0,
    }));
  }

  async create(input: CreateOrgNodeInput): Promise<OrgNodeDto> {
    await this.assertAdjacentParents(input.level, input.parentIds);
    const node = await this.prisma.orgNode.create({
      data: { name: input.name, level: input.level, kind: input.kind },
    });
    for (const parentId of input.parentIds) {
      await this.addEdge(parentId, node.id, { skipRecompute: true });
    }
    await this.recomputeClosure();
    return (await this.list(false)).find((n) => n.id === node.id)!;
  }

  /** Rename and/or re-kind. Active/inactive, reparenting and level all have their own
   *  dedicated, bigger-consequence endpoints below rather than living behind this bare
   *  field PATCH — kind belongs here because, unlike level, it has no structural side
   *  effects to guard against (see UpdateOrgNodeInput's own note). */
  async update(id: string, input: UpdateOrgNodeInput): Promise<OrgNodeDto> {
    const node = await this.prisma.orgNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException("Org node not found");
    await this.prisma.orgNode.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
      },
    });
    return (await this.list(false)).find((n) => n.id === id)!;
  }

  /**
   * Deactivating a node revokes whatever person currently occupies it (disabled, sessions
   * cleared) in the same transaction — the same reasoning people.service.ts's deactivate()
   * already applies from the person side: a DISABLED user can never sign in again to act on
   * a node, so leaving the occupancy in place would silently stall every approval step and
   * scope query routed through it. History (who held it, what it owns) is untouched — only
   * access and the active flag change.
   */
  async deactivateNode(id: string): Promise<DeactivateNodeResultDto> {
    const node = await this.prisma.orgNode.findUnique({ where: { id }, include: { user: { select: { id: true, name: true } } } });
    if (!node) throw new NotFoundException("Org node not found");
    if (!node.active) throw new BadRequestException("This node is already inactive");

    await this.prisma.$transaction([
      ...(node.userId
        ? [
            this.prisma.user.update({ where: { id: node.userId }, data: { status: "DISABLED" as const } }),
            this.prisma.session.deleteMany({ where: { userId: node.userId } }),
            this.prisma.orgNodeAssignment.updateMany({
              where: { nodeId: id, userId: node.userId, endedAt: null },
              data: { endedAt: new Date(), reason: "Node deactivated" },
            }),
          ]
        : []),
      this.prisma.orgNode.update({ where: { id }, data: { active: false, userId: null } }),
    ]);
    return { ok: true, revokedOccupantName: node.user?.name ?? null };
  }

  /** Does not restore the previous occupant — same as people.service.ts's reactivate(),
   *  there is no "undo"; assign a new one afterward if the node needs one. */
  async reactivateNode(id: string): Promise<OrgNodeDto> {
    const node = await this.prisma.orgNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException("Org node not found");
    if (node.active) throw new BadRequestException("This node is already active");
    await this.prisma.orgNode.update({ where: { id }, data: { active: true } });
    return (await this.list(false)).find((n) => n.id === id)!;
  }

  /** Replaces which parent(s) a node reports under. Cycles are structurally impossible
   *  here — assertAdjacentParents forces every edge from level N to N+1, so a node can
   *  never become its own ancestor. */
  async reassignParents(id: string, parentIds: string[]): Promise<OrgNodeDto> {
    const node = await this.prisma.orgNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException("Org node not found");
    await this.assertAdjacentParents(node.level, parentIds);

    await this.prisma.$transaction([
      this.prisma.orgEdge.deleteMany({ where: { childId: id } }),
      this.prisma.orgEdge.createMany({ data: parentIds.map((parentId) => ({ parentId, childId: id })) }),
    ]);
    await this.recomputeClosure();
    return (await this.list(false)).find((n) => n.id === id)!;
  }

  /**
   * Moving a node to a different level invalidates every edge it holds in EITHER
   * direction — an edge only means something between two adjacent levels. Nothing is
   * auto-reconnected: the node (and any former children left with no other parent) sits
   * parentless/childless until reassignParents/addEdge redraws its edges. Owned content
   * (assets, requests, everything) is unaffected — it keys off the node's id, not its
   * level or edges.
   */
  async changeLevel(id: string, newLevel: number): Promise<OrgNodeDto> {
    const node = await this.prisma.orgNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException("Org node not found");
    if (node.level === newLevel) return (await this.list(false)).find((n) => n.id === id)!;

    await this.prisma.$transaction([
      this.prisma.orgEdge.deleteMany({ where: { OR: [{ parentId: id }, { childId: id }] } }),
      this.prisma.orgNode.update({ where: { id }, data: { level: newLevel } }),
    ]);
    await this.recomputeClosure();
    return (await this.list(false)).find((n) => n.id === id)!;
  }

  /**
   * Real deletion — everywhere else a node's lifecycle ends in deactivateNode, not this.
   * Every blocker is collected and returned together (not thrown on the first hit) so the
   * admin sees everything that needs clearing in one pass, mirroring the sister feedback
   * system's deleteNode. Re-checked here rather than trusted from a possibly-stale client
   * OrgNodeDto.
   *
   * TODO: as each lab-management module ships (Location, Asset, StockLine, procurement,
   * transfers, ...), add its own "owns N of X" blocker here the same way `residents` does.
   */
  async deleteNode(id: string): Promise<void> {
    const node = await this.prisma.orgNode.findUnique({ where: { id }, include: { outgoingEdges: true } });
    if (!node) throw new NotFoundException("Org node not found");

    const blockers: string[] = [];
    if (node.userId) blockers.push("has an occupant — deactivate it first");
    if (node.outgoingEdges.length > 0) blockers.push(`has ${node.outgoingEdges.length} child node(s)`);

    const residents = await this.prisma.user.count({ where: { homeNodeId: id } });
    if (residents > 0) blockers.push(`is the home department of ${residents} person(s)`);

    if (blockers.length > 0) {
      throw new BadRequestException(`Cannot delete "${node.name}" — it ${blockers.join("; ")}`);
    }

    await this.prisma.$transaction([
      this.prisma.orgEdge.deleteMany({ where: { OR: [{ parentId: id }, { childId: id }] } }),
      this.prisma.orgNode.delete({ where: { id } }),
    ]);
    await this.recomputeClosure();
  }

  /**
   * Adds a parent→child edge. Multiple parents are still allowed (a department co-owned
   * by two colleges), but only between ADJACENT levels — child.level must be exactly
   * parent.level + 1, same discipline the sister feedback system's HierarchyNode enforces.
   * That single rule is what keeps every node's ancestor chain a walkable straight line
   * instead of an unpredictable graph; Property Administration and Procurement no longer
   * need a cross-level edge to reach every department, since ScopeService already gives
   * them that by role. A cycle is refused too, though adjacency alone already makes one
   * structurally impossible — kept as a second, explicit guard.
   */
  async addEdge(parentId: string, childId: string, opts?: { skipRecompute?: boolean }): Promise<void> {
    const [parent, child] = await Promise.all([
      this.prisma.orgNode.findUnique({ where: { id: parentId } }),
      this.prisma.orgNode.findUnique({ where: { id: childId } }),
    ]);
    if (!parent || !child) throw new NotFoundException("Parent or child node not found");
    if (child.level !== parent.level + 1) {
      throw new BadRequestException(
        `Edges only connect adjacent levels — "${parent.name}" is level ${parent.level}, "${child.name}" is level ${child.level}`,
      );
    }

    const edges = await this.prisma.orgEdge.findMany();
    if (wouldCreateCycle(edges, parentId, childId)) {
      throw new BadRequestException(
        `"${parent.name}" is already below "${child.name}" — that edge would create a loop`,
      );
    }

    await this.prisma.orgEdge.upsert({
      where: { parentId_childId: { parentId, childId } },
      create: { parentId, childId },
      update: {},
    });
    if (!opts?.skipRecompute) await this.recomputeClosure();
  }

  /** Level 0 (the university root) may never have a parent; every level above it needs at
   *  least one, and every parent given must sit exactly one level below. Mirrors the
   *  sister feedback system's HierarchyService.assertAdjacentParents verbatim. */
  private async assertAdjacentParents(level: number, parentIds: string[]): Promise<void> {
    if (level === 0) {
      if (parentIds.length > 0) throw new BadRequestException("A level 0 node cannot have a parent");
      return;
    }
    if (parentIds.length === 0) {
      throw new BadRequestException("A node above level 0 needs at least one parent");
    }
    const parents = await this.prisma.orgNode.findMany({ where: { id: { in: parentIds } } });
    if (parents.length !== parentIds.length) {
      throw new BadRequestException("One or more parent nodes do not exist");
    }
    const wrongLevel = parents.find((p) => p.level !== level - 1);
    if (wrongLevel) {
      throw new BadRequestException(
        `Edges only connect adjacent levels — "${wrongLevel.name}" is level ${wrongLevel.level}, not ${level - 1}`,
      );
    }
  }

  /**
   * Full recompute, not an incremental patch. The node count here is in the dozens, not
   * the millions, and a wholesale rebuild sidesteps every class of drift bug an
   * incremental closure update can introduce.
   */
  async recomputeClosure(): Promise<void> {
    const [nodes, edges] = await Promise.all([
      this.prisma.orgNode.findMany({ select: { id: true } }),
      this.prisma.orgEdge.findMany(),
    ]);
    const rows = computeClosureRows(
      nodes.map((n) => n.id),
      edges,
    );
    await this.prisma.$transaction([
      this.prisma.orgClosure.deleteMany({}),
      this.prisma.orgClosure.createMany({ data: rows }),
    ]);
  }
}

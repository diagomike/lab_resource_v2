import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import type { ItemDetailDto, ItemRowDto } from "@sc-lab/shared";
import { SessionGuard } from "../auth/session.guard";
import { CurrentUser, type AuthedUser } from "../common/current-user.decorator";
import { ItemsService } from "./items.service";

@Controller("resources")
@UseGuards(SessionGuard)
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get("search")
  async search(@CurrentUser() user: AuthedUser, @Query("categoryId") categoryId?: string): Promise<ItemRowDto[]> {
    return this.items.search(user.id, { categoryId });
  }

  @Get("items/:id")
  async getOne(@CurrentUser() user: AuthedUser, @Param("id") id: string): Promise<ItemDetailDto> {
    return this.items.getOne(user.id, id);
  }
}

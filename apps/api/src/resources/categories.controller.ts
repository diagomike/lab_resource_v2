import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { CategoryDto } from "@sc-lab/shared";
import { SessionGuard } from "../auth/session.guard";
import { CategoriesService } from "./categories.service";

@Controller("resources/categories")
@UseGuards(SessionGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Readable by anyone signed in — the category schema names the vocabulary, not
   *  who owns which items. Categories carry no scope of their own. */
  @Get()
  async list(@Query("includeInactive") includeInactive?: string): Promise<CategoryDto[]> {
    return this.categories.list(includeInactive === "true");
  }
}

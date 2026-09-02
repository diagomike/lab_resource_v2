import { Module } from "@nestjs/common";
import { OrgModule } from "../org/org.module";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";
import { ItemScopeService } from "./item-scope.service";
import { ItemsController } from "./items.controller";
import { ItemsService } from "./items.service";

@Module({
  imports: [OrgModule], // for ScopeService, which ItemScopeService consumes and never re-derives
  controllers: [CategoriesController, ItemsController],
  providers: [CategoriesService, ItemsService, ItemScopeService],
})
export class ResourcesModule {}

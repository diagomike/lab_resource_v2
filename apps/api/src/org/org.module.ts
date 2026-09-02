import { Module } from "@nestjs/common";
import { OrgController } from "./org.controller";
import { PeopleController } from "./people.controller";
import { OrgService } from "./org.service";
import { ScopeService } from "./scope.service";

@Module({
  controllers: [OrgController, PeopleController],
  providers: [OrgService, ScopeService],
  exports: [OrgService, ScopeService],
})
export class OrgModule {}

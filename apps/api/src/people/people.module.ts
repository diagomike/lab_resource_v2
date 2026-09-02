import { Module } from "@nestjs/common";
import { OrgModule } from "../org/org.module";
import { MailModule } from "../mail/mail.module";
import { PersonnelController } from "./people.controller";
import { PeopleService } from "./people.service";

@Module({
  imports: [OrgModule, MailModule],
  controllers: [PersonnelController],
  providers: [PeopleService],
})
export class PeopleModule {}

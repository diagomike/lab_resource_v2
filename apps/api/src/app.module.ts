import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { OrgModule } from "./org/org.module";
import { PeopleModule } from "./people/people.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ResourcesModule } from "./resources/resources.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    OrgModule,
    AuthModule,
    PeopleModule,
    ResourcesModule,
  ],
})
export class AppModule {}

-- Per-person switch for notification emails (approval and outcome mail). Default on,
-- so every existing account keeps receiving them until someone turns it off.
ALTER TABLE "User" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;

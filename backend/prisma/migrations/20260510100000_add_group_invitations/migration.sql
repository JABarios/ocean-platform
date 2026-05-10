ALTER TABLE "group_members" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'Accepted';
ALTER TABLE "group_members" ADD COLUMN "invited_by" TEXT;
ALTER TABLE "group_members" ADD COLUMN "invited_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "group_members" ADD COLUMN "responded_at" DATETIME;

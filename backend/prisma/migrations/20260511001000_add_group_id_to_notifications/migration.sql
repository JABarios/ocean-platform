ALTER TABLE "notifications" ADD COLUMN "group_id" TEXT;
CREATE INDEX "notifications_user_id_group_id_idx" ON "notifications"("user_id", "group_id");

ALTER TABLE "users" ADD COLUMN "last_login_at" DATETIME;
UPDATE "users"
SET "last_login_at" = "created_at"
WHERE "last_login_at" IS NULL;

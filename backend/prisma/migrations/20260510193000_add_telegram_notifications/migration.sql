ALTER TABLE "users" ADD COLUMN "telegram_chat_id" TEXT;
ALTER TABLE "users" ADD COLUMN "telegram_username" TEXT;
ALTER TABLE "users" ADD COLUMN "telegram_linked_at" DATETIME;
ALTER TABLE "users" ADD COLUMN "telegram_notifications_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "users_telegram_chat_id_key" ON "users"("telegram_chat_id");

CREATE TABLE "telegram_link_tokens" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires_at" DATETIME NOT NULL,
  "consumed_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "telegram_link_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "telegram_link_tokens_token_key" ON "telegram_link_tokens"("token");
CREATE INDEX "telegram_link_tokens_user_id_idx" ON "telegram_link_tokens"("user_id");

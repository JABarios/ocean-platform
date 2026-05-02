CREATE TABLE "shared_link_blobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "created_by" TEXT,
    "blob_location" TEXT NOT NULL,
    "blob_hash" TEXT,
    "iv_base64" TEXT,
    "size_bytes" INTEGER,
    "original_filename" TEXT,
    "label" TEXT,
    "encryption_mode" TEXT NOT NULL DEFAULT 'AES256-GCM',
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "shared_link_blobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "eeg_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blob_hash" TEXT NOT NULL,
    "blob_location" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "encryption_mode" TEXT NOT NULL DEFAULT 'AES256-GCM',
    "uploaded_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "eeg_records_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "eeg_records_blob_hash_key" ON "eeg_records"("blob_hash");

ALTER TABLE "case_packages" ADD COLUMN "eeg_record_id" TEXT REFERENCES "eeg_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

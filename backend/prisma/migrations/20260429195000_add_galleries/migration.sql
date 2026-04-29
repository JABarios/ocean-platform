CREATE TABLE "galleries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT,
    "license" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'Institutional',
    "tags" TEXT DEFAULT '[]',
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "galleries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "gallery_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gallery_id" TEXT NOT NULL,
    "eeg_record_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT DEFAULT '{}',
    "tags" TEXT DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "gallery_records_gallery_id_fkey" FOREIGN KEY ("gallery_id") REFERENCES "galleries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "gallery_records_eeg_record_id_fkey" FOREIGN KEY ("eeg_record_id") REFERENCES "eeg_records" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "gallery_records_gallery_id_eeg_record_id_key" ON "gallery_records"("gallery_id", "eeg_record_id");

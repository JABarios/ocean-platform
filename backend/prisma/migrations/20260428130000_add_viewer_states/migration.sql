CREATE TABLE "viewer_states" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "package_hash" TEXT NOT NULL,
    "position_sec" INTEGER NOT NULL DEFAULT 0,
    "window_secs" INTEGER NOT NULL DEFAULT 10,
    "hp" REAL NOT NULL DEFAULT 0.5,
    "lp" REAL NOT NULL DEFAULT 45,
    "notch" BOOLEAN NOT NULL DEFAULT true,
    "gain_mult" REAL NOT NULL DEFAULT 1,
    "normalize_non_eeg" BOOLEAN NOT NULL DEFAULT false,
    "montage" TEXT NOT NULL DEFAULT 'promedio',
    "excluded_average_reference_channels" TEXT DEFAULT '[]',
    "included_hidden_channels" TEXT DEFAULT '[]',
    "dsa_channel" TEXT DEFAULT 'off',
    "artifact_reject" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "viewer_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "viewer_states_user_id_package_hash_key" ON "viewer_states"("user_id", "package_hash");

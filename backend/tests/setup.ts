import { PrismaClient } from '@prisma/client'
import os from 'os'

process.env.DATABASE_URL = 'file::memory:'
process.env.JWT_SECRET = 'test-secret-very-long-string-for-testing-only'
process.env.KEY_CUSTODY_SECRET = 'test-key-custody-secret-separated-from-jwt'
process.env.GALLERY_IMPORT_ROOT = os.tmpdir()

const prisma = new PrismaClient()

const DDL = `
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "institution" TEXT,
    "specialty" TEXT,
    "role" TEXT NOT NULL DEFAULT 'Clinician',
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "password_hash" TEXT,
    "public_key" TEXT,
    "preferences" TEXT DEFAULT '{}',
    "last_login_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Closed',
    "rules" TEXT DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE "group_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "group_members_user_id_group_id_key" ON "group_members"("user_id", "group_id");

CREATE TABLE "cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "title" TEXT,
    "clinical_context" TEXT,
    "age_range" TEXT,
    "study_reason" TEXT,
    "modality" TEXT NOT NULL DEFAULT 'EEG',
    "tags" TEXT DEFAULT '[]',
    "status_clinical" TEXT NOT NULL DEFAULT 'Draft',
    "status_teaching" TEXT NOT NULL DEFAULT 'None',
    "visibility" TEXT NOT NULL DEFAULT 'Private',
    "summary_metrics" TEXT,
    "resolution_summary" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "cases_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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

CREATE TABLE "galleries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT,
    "license" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'Institutional',
    "tags" TEXT DEFAULT '[]',
    "metadata" TEXT DEFAULT '{}',
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

CREATE TABLE "case_packages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "case_id" TEXT NOT NULL,
    "eeg_record_id" TEXT,
    "package_format_version" TEXT NOT NULL DEFAULT '1.0',
    "encryption_mode" TEXT NOT NULL DEFAULT 'AES256-GCM',
    "blob_location" TEXT NOT NULL,
    "blob_hash" TEXT,
    "size_bytes" INTEGER,
    "upload_status" TEXT NOT NULL DEFAULT 'Uploading',
    "retention_policy" TEXT NOT NULL DEFAULT 'UntilReviewClose',
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "case_packages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_packages_eeg_record_id_fkey" FOREIGN KEY ("eeg_record_id") REFERENCES "eeg_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "case_packages_case_id_key" ON "case_packages"("case_id");

CREATE TABLE "review_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "case_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "target_user_id" TEXT,
    "target_group_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" DATETIME,
    "completed_at" DATETIME,
    "expires_at" DATETIME,
    CONSTRAINT "review_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "review_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "review_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "review_requests_target_group_id_fkey" FOREIGN KEY ("target_group_id") REFERENCES "groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "case_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "request_id" TEXT,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Comment',
    "optional_anchor" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "comments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "review_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "teaching_proposals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "case_id" TEXT NOT NULL,
    "proposer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Proposed',
    "summary" TEXT,
    "key_findings" TEXT,
    "learning_points" TEXT,
    "difficulty" TEXT DEFAULT 'Intermediate',
    "tags" TEXT DEFAULT '[]',
    "validated_by" TEXT,
    "validated_at" DATETIME,
    "rejection_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "teaching_proposals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teaching_proposals_proposer_id_fkey" FOREIGN KEY ("proposer_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "teaching_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposal_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "rationale" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teaching_recommendations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "teaching_proposals" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teaching_recommendations_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "teaching_recommendations_proposal_id_author_id_key" ON "teaching_recommendations"("proposal_id", "author_id");

CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT NOT NULL,
    "case_id" TEXT,
    "action" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target" TEXT,
    "metadata" TEXT DEFAULT '{}',
    CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "audit_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "eeg_access_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "case_id" TEXT NOT NULL,
    "wrapped_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_recovered_at" DATETIME,
    CONSTRAINT "eeg_access_secrets_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "eeg_access_secrets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "eeg_access_secrets_case_id_key" ON "eeg_access_secrets"("case_id");

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
`

beforeAll(async () => {
  // Limpiar tablas si existen de un test suite anterior
  const drops = [
    'DROP TABLE IF EXISTS "audit_events"',
    'DROP TABLE IF EXISTS "eeg_access_secrets"',
    'DROP TABLE IF EXISTS "teaching_recommendations"',
    'DROP TABLE IF EXISTS "teaching_proposals"',
    'DROP TABLE IF EXISTS "comments"',
    'DROP TABLE IF EXISTS "review_requests"',
    'DROP TABLE IF EXISTS "case_packages"',
    'DROP TABLE IF EXISTS "gallery_records"',
    'DROP TABLE IF EXISTS "galleries"',
    'DROP TABLE IF EXISTS "eeg_records"',
    'DROP TABLE IF EXISTS "cases"',
    'DROP TABLE IF EXISTS "viewer_states"',
    'DROP TABLE IF EXISTS "group_members"',
    'DROP TABLE IF EXISTS "groups"',
    'DROP TABLE IF EXISTS "users"',
  ]
  for (const stmt of drops) {
    await prisma.$executeRawUnsafe(stmt)
  }
  for (const stmt of DDL.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
    await prisma.$executeRawUnsafe(stmt)
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

afterEach(async () => {
  const tables = [
    'audit_events',
    'eeg_access_secrets',
    'viewer_states',
    'teaching_recommendations',
    'teaching_proposals',
    'comments',
    'review_requests',
    'case_packages',
    'gallery_records',
    'galleries',
    'eeg_records',
    'cases',
    'group_members',
    'groups',
    'users',
  ]
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)
  }
})

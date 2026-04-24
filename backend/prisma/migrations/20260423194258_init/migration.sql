-- CreateTable
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Closed',
    "rules" TEXT DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "case_packages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "case_id" TEXT NOT NULL,
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
    CONSTRAINT "case_packages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "teaching_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposal_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "rationale" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "teaching_recommendations_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "teaching_proposals" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "teaching_recommendations_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_user_id_group_id_key" ON "group_members"("user_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_packages_case_id_key" ON "case_packages"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_recommendations_proposal_id_author_id_key" ON "teaching_recommendations"("proposal_id", "author_id");

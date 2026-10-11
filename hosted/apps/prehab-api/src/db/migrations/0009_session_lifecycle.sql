-- The imported snapshots included these fields, but their SQL was absent.
CREATE TYPE "public"."session_status" AS ENUM ('pending', 'generating', 'ready', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."session_source" AS ENUM ('daily', 'template', 'on_demand');
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "status" "session_status" DEFAULT 'ready' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "generation_error" text;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "source" "session_source" DEFAULT 'daily' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "archived_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "replaces_session_id" text REFERENCES "sessions"("id");
--> statement-breakpoint
CREATE INDEX "sessions_user_date_source_idx" ON "sessions" ("user_id", "session_date", "source");
--> statement-breakpoint
ALTER TABLE "program_schedule" ADD COLUMN "title" text;
--> statement-breakpoint
ALTER TABLE "program_schedule" ADD COLUMN "estimated_duration_min" integer;

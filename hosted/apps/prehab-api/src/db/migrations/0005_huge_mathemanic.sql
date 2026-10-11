CREATE TYPE "public"."plan_source" AS ENUM('generated', 'template');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('active', 'completed', 'superseded');--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" "plan_source" NOT NULL,
	"status" "plan_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"plan_template_id" text,
	"superseded_by_plan_id" text,
	"goals_snapshot" jsonb,
	"focus_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program_schedule" ADD COLUMN "plan_id" text;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_superseded_by_plan_id_plans_id_fk" FOREIGN KEY ("superseded_by_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_user_id_idx" ON "plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plans_user_status_idx" ON "plans" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "program_schedule" ADD CONSTRAINT "program_schedule_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill (PRE-143): synthesize one legacy active plan per user that already has
-- schedule rows, spanning their first scheduled day + 6 weeks, then attach their
-- existing program_schedule rows to it so nothing orphans.
INSERT INTO "plans" ("id", "user_id", "source", "status", "start_date", "end_date", "created_at")
SELECT gen_random_uuid()::text, ps."user_id", 'generated', 'active', MIN(ps."date"), (MIN(ps."date") + 42), now()
FROM "program_schedule" ps
WHERE ps."plan_id" IS NULL
GROUP BY ps."user_id";--> statement-breakpoint
UPDATE "program_schedule" ps
SET "plan_id" = p."id"
FROM "plans" p
WHERE p."user_id" = ps."user_id" AND p."status" = 'active' AND ps."plan_id" IS NULL;
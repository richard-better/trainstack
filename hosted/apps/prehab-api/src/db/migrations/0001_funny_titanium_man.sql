CREATE TABLE "intake_summaries" (
	"user_id" text PRIMARY KEY NOT NULL,
	"thread_id" text,
	"summary" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"extracted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "preferred_session_time" time;--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "goals" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "focus_areas" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "equipment" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "daily_session_time_min" integer;--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "sport_time_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "capacity_ratings";--> statement-breakpoint
ALTER TABLE "intake_summaries" ADD CONSTRAINT "intake_summaries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_summaries" ADD CONSTRAINT "intake_summaries_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "threads_user_id_type_idx" ON "threads" USING btree ("user_id","type");
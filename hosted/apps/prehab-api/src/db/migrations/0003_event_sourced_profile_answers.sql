CREATE TABLE "profile_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"value" jsonb,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_answers_user_question_unique" UNIQUE("user_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "profile_answers" ADD CONSTRAINT "profile_answers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_answers_user_id_idx" ON "profile_answers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "sport_profiles" ALTER COLUMN "primary_sport" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "sport_profiles" ADD COLUMN "onboarding_completed_at" timestamp;--> statement-breakpoint
-- Pre-launch: drop all the columns now sourced from `profile_answers`.
ALTER TABLE "sport_profiles" DROP COLUMN "sports";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "training_volume_hrs_per_week";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "date_of_birth";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "gender";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "goals";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "focus_areas";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "equipment";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "daily_session_time_min";--> statement-breakpoint
ALTER TABLE "sport_profiles" DROP COLUMN "sport_time_breakdown";

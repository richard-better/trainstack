CREATE TYPE "public"."plan_generation_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "subtitle" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "themes" jsonb;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "generation_status" "plan_generation_status" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "generation_error" text;

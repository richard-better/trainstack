ALTER TABLE "threads" ADD COLUMN "flagged_for_review_at" timestamp;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "flag_reason" text;
CREATE TABLE "llm_call_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"endpoint" text NOT NULL,
	"operation" text DEFAULT 'generateObject' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer NOT NULL,
	"error_message" text,
	"prompt_version" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_call_logs" ADD CONSTRAINT "llm_call_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_call_logs_user_id_idx" ON "llm_call_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "llm_call_logs_endpoint_idx" ON "llm_call_logs" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "llm_call_logs_created_at_idx" ON "llm_call_logs" USING btree ("created_at");
DROP INDEX `activity_user_source_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `activity_user_source_idx` ON `activity` (`user_id`,`source`,`source_id`) WHERE "activity"."source_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `deleted_activity` ADD `source` text;--> statement-breakpoint
ALTER TABLE `deleted_activity` ADD `source_id` text;--> statement-breakpoint
CREATE INDEX `deleted_activity_user_source_idx` ON `deleted_activity` (`user_id`,`source`,`source_id`) WHERE "deleted_activity"."source_id" IS NOT NULL;

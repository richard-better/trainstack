CREATE TABLE `distinct_activities` (
	`user_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`other_id` text NOT NULL,
	CONSTRAINT `distinct_activities_pk` PRIMARY KEY(`user_id`, `activity_id`, `other_id`),
	CONSTRAINT `fk_distinct_activities_user_id_activity_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`activity_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_distinct_activities_user_id_other_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`other_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `activity` ADD `workout_id` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `is_primary` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `activity` ADD `chosen_as_primary_at` integer;--> statement-breakpoint
ALTER TABLE `activity` ADD `match_version` integer;--> statement-breakpoint
CREATE INDEX `activity_user_primary_occurred_idx` ON `activity` (`user_id`,`is_primary`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `activity_user_workout_idx` ON `activity` (`user_id`,`workout_id`);--> statement-breakpoint
CREATE INDEX `activity_match_version_idx` ON `activity` (`match_version`);--> statement-breakpoint
UPDATE `activity` SET `workout_id` = `id` WHERE `workout_id` IS NULL;
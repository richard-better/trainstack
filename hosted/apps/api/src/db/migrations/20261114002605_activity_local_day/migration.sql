CREATE TABLE `athlete_time_zone` (
	`user_id` text PRIMARY KEY,
	`time_zone` text NOT NULL,
	CONSTRAINT `fk_athlete_time_zone_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `activity` ADD `local_day` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `local_day_source` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `local_day_zone` text;
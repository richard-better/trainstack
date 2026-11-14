CREATE TABLE `calendar_feed` (
	`user_id` text PRIMARY KEY,
	`feed_id` text NOT NULL,
	`with_activities` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_calendar_feed_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_feed_id_idx` ON `calendar_feed` (`feed_id`);
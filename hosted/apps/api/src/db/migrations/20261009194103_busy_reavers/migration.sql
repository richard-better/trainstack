CREATE TABLE `strava_budget` (
	`key` text PRIMARY KEY,
	`window_start` integer NOT NULL,
	`used` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `strava_connection` (
	`user_id` text PRIMARY KEY,
	`athlete_id` integer NOT NULL,
	`athlete_name` text,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_strava_connection_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `strava_link` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`tokens` text,
	CONSTRAINT `fk_strava_link_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strava_connection_athlete_idx` ON `strava_connection` (`athlete_id`);--> statement-breakpoint
CREATE INDEX `strava_link_userId_idx` ON `strava_link` (`user_id`);
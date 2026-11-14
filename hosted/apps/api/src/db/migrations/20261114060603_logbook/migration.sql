CREATE TABLE `custom_exercise` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`equipment` text NOT NULL,
	`primary_muscles` text NOT NULL,
	`secondary_muscles` text NOT NULL,
	`measure` text NOT NULL,
	`bodyweight` integer NOT NULL,
	`edited_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `custom_exercise_pk` PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT `fk_custom_exercise_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `logged_session` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`activity_id` text NOT NULL,
	`sport` text NOT NULL,
	`body` text NOT NULL,
	`edited_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `logged_session_pk` PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT `fk_logged_session_user_id_activity_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`activity_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `logged_session_user_activity_idx` ON `logged_session` (`user_id`,`activity_id`);--> statement-breakpoint
CREATE INDEX `logged_session_user_sport_idx` ON `logged_session` (`user_id`,`sport`);
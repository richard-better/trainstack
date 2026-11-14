CREATE TABLE `planned_workout` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`day` text,
	`position` real,
	`placed_at` integer,
	`kind` text,
	`plan_id` text,
	`content` text,
	`content_at` integer,
	`planned_seconds` real,
	`planned_meters` real,
	`planned_load` real,
	`skipped` integer DEFAULT false NOT NULL,
	`skip_reason` text,
	`skipped_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer,
	`revision` integer NOT NULL,
	CONSTRAINT `planned_workout_pk` PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT `fk_planned_workout_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `planned_workout_user_day_idx` ON `planned_workout` (`user_id`,`day`,`position`,`id`);--> statement-breakpoint
CREATE INDEX `planned_workout_user_revision_idx` ON `planned_workout` (`user_id`,`revision`);--> statement-breakpoint
CREATE INDEX `planned_workout_user_plan_idx` ON `planned_workout` (`user_id`,`plan_id`);
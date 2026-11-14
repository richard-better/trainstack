CREATE TABLE `workout` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text,
	`sort_name` text,
	`sport` text,
	`focus` text,
	`description` text,
	`author` text,
	`tags` text,
	`total_seconds` real,
	`total_meters` real,
	`search_text` text,
	`body` text,
	`origin` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`revision` integer NOT NULL,
	CONSTRAINT `workout_pk` PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT `fk_workout_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workout_list` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`revision` integer NOT NULL,
	CONSTRAINT `workout_list_pk` PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT `fk_workout_list_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workout_list_entry` (
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`workout_id` text NOT NULL,
	`position` real NOT NULL,
	`removed` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `workout_list_entry_pk` PRIMARY KEY(`user_id`, `list_id`, `workout_id`),
	CONSTRAINT `fk_workout_list_entry_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workout_list_entry_user_id_list_id_workout_list_user_id_id_fk` FOREIGN KEY (`user_id`,`list_id`) REFERENCES `workout_list`(`user_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `workout_user_revision_idx` ON `workout` (`user_id`,`revision`);--> statement-breakpoint
CREATE INDEX `workout_user_updated_idx` ON `workout` (`user_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `workout_user_name_idx` ON `workout` (`user_id`,`sort_name`,`id`);--> statement-breakpoint
CREATE INDEX `workout_user_duration_idx` ON `workout` (`user_id`,`total_seconds`,`id`);--> statement-breakpoint
CREATE INDEX `workout_list_user_revision_idx` ON `workout_list` (`user_id`,`revision`);--> statement-breakpoint
CREATE INDEX `workout_list_entry_user_workout_idx` ON `workout_list_entry` (`user_id`,`workout_id`);--> statement-breakpoint
CREATE INDEX `workout_list_entry_user_revision_idx` ON `workout_list_entry` (`user_id`,`revision`);
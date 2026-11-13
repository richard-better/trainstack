CREATE TABLE `activity` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text,
	`sport` text,
	`name` text,
	`started_at` integer,
	`file_format` text,
	`file_size` integer,
	`summarized_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`occurred_at` integer GENERATED ALWAYS AS (coalesce(started_at, created_at)) VIRTUAL NOT NULL,
	CONSTRAINT `activity_pk` PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT `fk_activity_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `activity_event` (
	`user_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`data` text DEFAULT '{}' NOT NULL,
	CONSTRAINT `activity_event_pk` PRIMARY KEY(`user_id`, `activity_id`, `sequence`),
	CONSTRAINT `fk_activity_event_user_id_activity_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`activity_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `activity_statistic` (
	`user_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`name` text NOT NULL,
	`value` real NOT NULL,
	CONSTRAINT `activity_statistic_pk` PRIMARY KEY(`user_id`, `activity_id`, `name`),
	CONSTRAINT `fk_activity_statistic_user_id_activity_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`activity_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `activity_sync` (
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`cursor` text,
	`synced_at` integer,
	`error` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `activity_sync_pk` PRIMARY KEY(`user_id`, `source`),
	CONSTRAINT `fk_activity_sync_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `deleted_activity` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`deleted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `deleted_activity_pk` PRIMARY KEY(`user_id`, `id`),
	CONSTRAINT `fk_deleted_activity_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `activity_user_occurred_idx` ON `activity` (`user_id`,`occurred_at`,`id`);--> statement-breakpoint
CREATE INDEX `activity_user_source_idx` ON `activity` (`user_id`,`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `activity_statistic_user_name_idx` ON `activity_statistic` (`user_id`,`name`);
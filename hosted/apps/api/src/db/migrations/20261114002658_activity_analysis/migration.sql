CREATE TABLE `activity_analysis` (
	`user_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`due` integer DEFAULT true NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`analyzed_at` integer,
	`error` text,
	`profile` text,
	`missing_thresholds` text DEFAULT '[]' NOT NULL,
	CONSTRAINT `activity_analysis_pk` PRIMARY KEY(`user_id`, `activity_id`),
	CONSTRAINT `fk_activity_analysis_user_id_activity_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`activity_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `activity_analysis_due_idx` ON `activity_analysis` (`due`);--> statement-breakpoint
CREATE INDEX `activity_analysis_version_idx` ON `activity_analysis` (`version`);
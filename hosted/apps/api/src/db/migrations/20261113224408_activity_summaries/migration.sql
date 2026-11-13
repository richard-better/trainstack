ALTER TABLE `activity` ADD `file_sport` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `summary_version` integer;--> statement-breakpoint
ALTER TABLE `activity` ADD `summary_error` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `summary_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `activity_summary_version_idx` ON `activity` (`summary_version`);--> statement-breakpoint
CREATE INDEX `activity_summary_error_idx` ON `activity` (`summary_error`);
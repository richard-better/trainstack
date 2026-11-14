CREATE TABLE `account_file_sweep` (
	`user_id` text PRIMARY KEY,
	`promise` text NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_file_sweep_deleted_idx` ON `account_file_sweep` (`deleted_at`);
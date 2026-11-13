CREATE TABLE `athlete_setting` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`day` text NOT NULL,
	`value` text NOT NULL,
	`removed` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `athlete_setting_pk` PRIMARY KEY(`user_id`, `kind`, `scope`, `name`, `day`),
	CONSTRAINT `fk_athlete_setting_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `athlete_setting_user_revision_idx` ON `athlete_setting` (`user_id`,`revision`);
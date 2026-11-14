CREATE TABLE `planned_pairing_choice` (
	`user_id` text NOT NULL,
	`planned_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`paired` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `planned_pairing_choice_pk` PRIMARY KEY(`user_id`, `planned_id`, `activity_id`),
	CONSTRAINT `fk_planned_pairing_choice_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_planned_pairing_choice_user_id_activity_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`activity_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `planned_pairing_choice_user_activity_idx` ON `planned_pairing_choice` (`user_id`,`activity_id`);
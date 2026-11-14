CREATE TABLE `threshold_answer` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`threshold` text NOT NULL,
	`fingerprint` text NOT NULL,
	`value` integer NOT NULL,
	`answer` text NOT NULL,
	`answered_at` integer NOT NULL,
	CONSTRAINT `threshold_answer_pk` PRIMARY KEY(`user_id`, `scope`, `threshold`, `fingerprint`),
	CONSTRAINT `fk_threshold_answer_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `threshold_detection` (
	`user_id` text PRIMARY KEY,
	`analysed_through` integer NOT NULL,
	`analysed_count` integer NOT NULL,
	`settings_revision` integer NOT NULL,
	`detected_at` integer NOT NULL,
	CONSTRAINT `fk_threshold_detection_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `threshold_suggestion` (
	`user_id` text NOT NULL,
	`scope` text NOT NULL,
	`threshold` text NOT NULL,
	`id` text NOT NULL UNIQUE,
	`value` integer NOT NULL,
	`method` text NOT NULL,
	`confidence` text NOT NULL,
	`activity_id` text NOT NULL,
	`effort_day` text NOT NULL,
	`evidence` text NOT NULL,
	`signals` text NOT NULL,
	`fingerprint` text NOT NULL,
	`detected_at` integer NOT NULL,
	CONSTRAINT `threshold_suggestion_pk` PRIMARY KEY(`user_id`, `scope`, `threshold`),
	CONSTRAINT `fk_threshold_suggestion_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_threshold_suggestion_user_id_activity_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`activity_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE
);

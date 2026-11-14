CREATE TABLE `planned_interval_compliance` (
	`user_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`planned_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`result` text,
	CONSTRAINT `planned_interval_compliance_pk` PRIMARY KEY(`user_id`, `activity_id`, `planned_id`),
	CONSTRAINT `fk_planned_interval_compliance_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_planned_interval_compliance_user_id_activity_id_activity_user_id_id_fk` FOREIGN KEY (`user_id`,`activity_id`) REFERENCES `activity`(`user_id`,`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `activity_analysis` ADD `planned_signature` text;--> statement-breakpoint
UPDATE `activity_analysis` SET `due` = 1, `generation` = `generation` + 1
WHERE EXISTS (
	SELECT 1 FROM `activity` a JOIN `planned_workout` p ON p.`user_id` = a.`user_id` AND p.`day` = a.`local_day`
	WHERE a.`user_id` = `activity_analysis`.`user_id` AND a.`id` = `activity_analysis`.`activity_id`
		AND p.`kind` = 'workout' AND p.`deleted_at` IS NULL
);

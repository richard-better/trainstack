CREATE TABLE `health_day` (
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`day` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `health_day_pk` PRIMARY KEY(`user_id`, `source`, `day`),
	CONSTRAINT `fk_health_day_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

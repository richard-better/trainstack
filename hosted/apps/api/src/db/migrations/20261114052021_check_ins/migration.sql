CREATE TABLE `check_in` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`value` text NOT NULL,
	`removed` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `check_in_pk` PRIMARY KEY(`user_id`, `day`),
	CONSTRAINT `fk_check_in_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

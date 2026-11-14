CREATE TABLE `apple_app_grant` (
	`user_id` text PRIMARY KEY,
	`refresh_token` text NOT NULL,
	`granted_at` integer NOT NULL,
	CONSTRAINT `fk_apple_app_grant_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

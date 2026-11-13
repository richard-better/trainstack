ALTER TABLE `activity` ADD `indoor` integer;--> statement-breakpoint
ALTER TABLE `activity` ADD `file_indoor` integer;--> statement-breakpoint
UPDATE `activity` SET `sport` = substr(`sport`, 8), `indoor` = 1 WHERE `sport` LIKE 'indoor\_%' ESCAPE '\';
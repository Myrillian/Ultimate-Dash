ALTER TABLE `groups` ADD `user_id` integer REFERENCES users(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `groups_user_idx` ON `groups` (`user_id`,`sort_order`);--> statement-breakpoint
-- Vorhandenes Dashboard gehört künftig dem ältesten Admin (falls schon einer existiert;
-- sonst übernimmt es der erste Admin beim ersten Aufruf).
UPDATE `groups` SET `user_id` = (SELECT `id` FROM `users` WHERE `role` = 'admin' ORDER BY `id` LIMIT 1) WHERE `user_id` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`key`, `value`)
SELECT 'title:' || (SELECT `id` FROM `users` WHERE `role` = 'admin' ORDER BY `id` LIMIT 1), `value` FROM `settings`
WHERE `key` = 'title' AND EXISTS (SELECT 1 FROM `users` WHERE `role` = 'admin');

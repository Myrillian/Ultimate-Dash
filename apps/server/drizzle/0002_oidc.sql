ALTER TABLE `users` ADD `oidc_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_subject_unique` ON `users` (`oidc_subject`);
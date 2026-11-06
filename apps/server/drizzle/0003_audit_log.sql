CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`user_id` integer,
	`username` text,
	`action` text NOT NULL,
	`target` text,
	`details` text,
	`ok` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`created_at`);
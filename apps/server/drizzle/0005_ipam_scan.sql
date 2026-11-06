CREATE TABLE `ipam_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`name` text,
	`acknowledged` integer DEFAULT false NOT NULL,
	`alive` integer DEFAULT true NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text,
	`last_checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ipam_hosts_address_unique` ON `ipam_hosts` (`address`);--> statement-breakpoint
ALTER TABLE `ipam_networks` ADD `scan` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `ipam_networks` ADD `last_scan_at` text;
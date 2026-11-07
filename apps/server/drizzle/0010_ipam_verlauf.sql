CREATE TABLE `ipam_network_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`network_id` integer NOT NULL,
	`day` text NOT NULL,
	`total` integer NOT NULL,
	`used` integer NOT NULL,
	`online` integer,
	FOREIGN KEY (`network_id`) REFERENCES `ipam_networks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ipam_network_history_day` ON `ipam_network_history` (`network_id`,`day`);
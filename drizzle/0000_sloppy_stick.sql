CREATE TABLE `ingests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_path` text NOT NULL,
	`file_hash` text NOT NULL,
	`file_mtime` integer,
	`ingested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`scan_time` integer NOT NULL,
	`realm` text NOT NULL,
	`db_items` integer NOT NULL,
	`db_inserted` integer NOT NULL,
	`history_items` integer NOT NULL,
	`history_inserted` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`quality` integer NOT NULL,
	`icon` text NOT NULL,
	`class_id` integer,
	`subclass_id` integer,
	`category` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `item_meta_name_idx` ON `item_meta` (`name`);--> statement-breakpoint
CREATE INDEX `item_meta_category_idx` ON `item_meta` (`category`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`realm` text NOT NULL,
	`auctionator_item_id` integer,
	`meta_id` integer,
	`random_suffix` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`meta_id`) REFERENCES `item_meta`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_name_realm_uniq` ON `items` (`name`,`realm`);--> statement-breakpoint
CREATE INDEX `items_name_idx` ON `items` (`name`);--> statement-breakpoint
CREATE INDEX `items_meta_idx` ON `items` (`meta_id`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`price_per_unit` integer NOT NULL,
	`stack_size` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`ingest_id` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingest_id`) REFERENCES `ingests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scans_item_observed_source_uniq` ON `scans` (`item_id`,`observed_at`,`source`);--> statement-breakpoint
CREATE INDEX `scans_item_idx` ON `scans` (`item_id`);--> statement-breakpoint
CREATE INDEX `scans_observed_idx` ON `scans` (`observed_at`);
CREATE TABLE `backfill_state` (
	`meta_id` integer PRIMARY KEY NOT NULL,
	`realm` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`scans_inserted` integer DEFAULT 0 NOT NULL,
	`error_message` text
);

CREATE TABLE `event_log` (
	`user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`correlation_id` text,
	`part_id` integer,
	`source_id` text,
	`result_id` text,
	`delegation_id` text,
	`status` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `seq`)
);
--> statement-breakpoint
CREATE INDEX `event_log_created_at_idx` ON `event_log` (`created_at`);
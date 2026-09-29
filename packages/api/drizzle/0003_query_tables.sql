CREATE TABLE `query_request` (
	`correlation_id` text NOT NULL,
	`part_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`parent_part_id` integer,
	`origin` text NOT NULL,
	`query_type` text NOT NULL,
	`type_values` text NOT NULL,
	`values_ciphertext` blob,
	`values_iv` blob,
	`values_tag` blob,
	`plate_only` integer NOT NULL,
	`selected_source_ids` text NOT NULL,
	`dropped_source_ids` text NOT NULL,
	`skipped_reason` text,
	`config_hash` text NOT NULL,
	`idempotency_key` text,
	`submitted_at` integer NOT NULL,
	PRIMARY KEY(`correlation_id`, `part_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `query_request_idempotency_idx` ON `query_request` (`user_id`,`idempotency_key`) WHERE part_id = 0;--> statement-breakpoint
CREATE INDEX `query_request_user_submitted_idx` ON `query_request` (`user_id`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `request_key` (
	`correlation_id` text NOT NULL,
	`scope` text NOT NULL,
	`wrapped_dek` blob NOT NULL,
	`iv` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`key_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`correlation_id`, `scope`),
	CONSTRAINT "request_key_scope_check" CHECK("request_key"."scope" IN ('values', 'payload'))
);
--> statement-breakpoint
CREATE TABLE `source_result` (
	`result_id` text PRIMARY KEY NOT NULL,
	`correlation_id` text NOT NULL,
	`part_id` integer NOT NULL,
	`source_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`credential_user_id` text,
	`delegation_id` text,
	`adapter_kind` text NOT NULL,
	`payload_ciphertext` blob,
	`payload_iv` blob,
	`payload_tag` blob,
	`error_code` text,
	`created_at` integer NOT NULL,
	`received_at` integer,
	`timed_out_at` integer,
	FOREIGN KEY (`correlation_id`,`part_id`) REFERENCES `query_request`(`correlation_id`,`part_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_result_status_check" CHECK("source_result"."status" IN ('pending', 'returned', 'failed', 'timedOut', 'credentialsMissing', 'credentialsRejected', 'interrupted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_result_part_source_idx` ON `source_result` (`correlation_id`,`part_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `source_result_user_created_idx` ON `source_result` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `source_result_credential_created_idx` ON `source_result` (`credential_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `source_result_status_idx` ON `source_result` (`status`);
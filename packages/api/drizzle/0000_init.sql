CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`at` integer NOT NULL,
	`correlation_id` text,
	`part_id` integer,
	`actor_user_id` text NOT NULL,
	`actor_email` text,
	`actor_role` text NOT NULL,
	`credential_user_id` text,
	`identity_source` text NOT NULL,
	`host_subject` text,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_event_at_idx` ON `audit_event` (`at`);--> statement-breakpoint
CREATE INDEX `audit_event_actor_at_idx` ON `audit_event` (`actor_user_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_event_credential_at_idx` ON `audit_event` (`credential_user_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_event_correlation_idx` ON `audit_event` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `audit_event_type_at_idx` ON `audit_event` (`type`,`at`);--> statement-breakpoint
CREATE TABLE `key_canary` (
	`key_name` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`iv` blob NOT NULL,
	`auth_tag` blob NOT NULL,
	`key_version` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	`locked_until` integer
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`step_up_at` integer,
	`host_token_exp` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled_at` integer,
	`identity_source` text DEFAULT 'local' NOT NULL,
	`host_issuer` text,
	`host_subject` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_host_identity_uq` ON `user` (`host_issuer`,`host_subject`);--> statement-breakpoint
CREATE TABLE `user_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme_mode` text,
	`persona_override` text,
	`layout` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);

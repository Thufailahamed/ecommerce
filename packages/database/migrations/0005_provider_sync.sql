CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	`list_id` text,
	`list_name` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`verified_at` text,
	`last_checked_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_store_provider_uq` ON `provider_connections` (`store_id`,`provider`);--> statement-breakpoint
CREATE TABLE `provider_sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`provider` text NOT NULL,
	`channel` text NOT NULL,
	`action` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`provider_ref` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_sync_jobs_uq` ON `provider_sync_jobs` (`contact_id`,`provider`,`channel`);--> statement-breakpoint
CREATE INDEX `provider_sync_jobs_due_idx` ON `provider_sync_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `provider_sync_jobs_store_idx` ON `provider_sync_jobs` (`store_id`,`status`);--> statement-breakpoint
ALTER TABLE `consent_events` ADD `version_id` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `first_name` text;
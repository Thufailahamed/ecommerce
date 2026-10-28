CREATE TABLE `consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`channel` text NOT NULL,
	`event` text NOT NULL,
	`source` text NOT NULL,
	`consent_text` text,
	`consent_text_hash` text,
	`privacy_url` text,
	`token_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consent_events_token_uq` ON `consent_events` (`token_hash`);--> statement-breakpoint
CREATE INDEX `consent_events_contact_idx` ON `consent_events` (`contact_id`,`channel`,`created_at`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`email` text,
	`phone` text,
	`email_status` text DEFAULT 'none' NOT NULL,
	`sms_status` text DEFAULT 'none' NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_store_email_uq` ON `contacts` (`store_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_store_phone_uq` ON `contacts` (`store_id`,`phone`);--> statement-breakpoint
CREATE INDEX `contacts_store_created_idx` ON `contacts` (`store_id`,`created_at`);--> statement-breakpoint
DROP INDEX `suppression_uq`;--> statement-breakpoint
ALTER TABLE `suppression_records` ADD `channel` text DEFAULT 'email' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_channel_uq` ON `suppression_records` (`store_id`,`channel`,`email_hash`);
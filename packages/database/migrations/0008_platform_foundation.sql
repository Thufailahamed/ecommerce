CREATE TABLE `domain_event_deliveries` (
	`event_id` text NOT NULL,
	`subscriber` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`event_id`, `subscriber`),
	FOREIGN KEY (`event_id`) REFERENCES `domain_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text,
	`type` text NOT NULL,
	`schema_version` integer NOT NULL,
	`source` text NOT NULL,
	`correlation_id` text,
	`idempotency_key` text NOT NULL,
	`privacy` text NOT NULL,
	`payload` text NOT NULL,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`delivered_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_events_idem_uq` ON `domain_events` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `domain_events_store_idx` ON `domain_events` (`store_id`,`recorded_at`);--> statement-breakpoint
CREATE INDEX `domain_events_status_idx` ON `domain_events` (`status`,`recorded_at`);--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `actor_type` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `correlation_id` text;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `summary` text;--> statement-breakpoint
CREATE INDEX `audit_org_idx` ON `audit_logs` (`organization_id`,`created_at`);--> statement-breakpoint
UPDATE `audit_logs` SET `actor_type` = 'platform' WHERE `actor_id` IS NULL AND `action` IN ('customers/redact', 'customers/data_request');--> statement-breakpoint
UPDATE `audit_logs` SET `actor_type` = 'system' WHERE `actor_id` IS NULL AND `actor_type` = 'user';--> statement-breakpoint
UPDATE `audit_logs` SET `organization_id` = (SELECT `organization_id` FROM `stores` WHERE `stores`.`id` = `audit_logs`.`store_id`) WHERE `organization_id` IS NULL AND `store_id` IS NOT NULL;

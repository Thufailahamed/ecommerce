CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_tokens_user_idx` ON `auth_tokens` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `experiment_stats` (
	`store_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`version_id` text NOT NULL,
	`group` text NOT NULL,
	`day` text NOT NULL,
	`sessions` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_stats_uq` ON `experiment_stats` (`store_id`,`campaign_id`,`version_id`,`group`,`day`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_uq` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_org_idx` ON `invitations` (`organization_id`);--> statement-breakpoint
CREATE TABLE `subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`product_external_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confirm_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`confirmed_at` text,
	`notified_at` text,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_unique` ON `subscribers` (`store_id`,`product_external_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscribers_confirm_uq` ON `subscribers` (`confirm_hash`);--> statement-breakpoint
CREATE INDEX `subscribers_product_idx` ON `subscribers` (`store_id`,`product_external_id`,`status`);--> statement-breakpoint
ALTER TABLE `conversions` ADD `exp_campaign_id` text;--> statement-breakpoint
ALTER TABLE `conversions` ADD `exp_group` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `max_discount_percent` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `customer_ref` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `mfa_secret_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `mfa_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_hashes` text DEFAULT '[]' NOT NULL;
CREATE TABLE `ai_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`requested_by` text,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_gen_store_idx` ON `ai_generations` (`store_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `analytics_aggregates` (
	`store_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`version_id` text NOT NULL,
	`day` text NOT NULL,
	`eligible` integer DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`dismissals` integer DEFAULT 0 NOT NULL,
	`subscriptions` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aggregates_uq` ON `analytics_aggregates` (`store_id`,`campaign_id`,`version_id`,`day`);--> statement-breakpoint
CREATE TABLE `attribution_records` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`conversion_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`version_id` text NOT NULL,
	`rule` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversion_id`) REFERENCES `conversions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attribution_conv_uq` ON `attribution_records` (`conversion_id`,`rule`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text,
	`organization_id` text,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_store_idx` ON `audit_logs` (`store_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `campaign_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`store_id` text NOT NULL,
	`version` integer NOT NULL,
	`config` text NOT NULL,
	`published_by` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_versions_uq` ON `campaign_versions` (`campaign_id`,`version`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_config` text NOT NULL,
	`published_version_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaigns_store_status_idx` ON `campaigns` (`store_id`,`status`);--> statement-breakpoint
CREATE TABLE `consent_records` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`subject_ref` text NOT NULL,
	`purpose` text NOT NULL,
	`granted` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`order_id` text NOT NULL,
	`total` real NOT NULL,
	`currency` text NOT NULL,
	`session_id` text,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversions_order_uq` ON `conversions` (`store_id`,`order_id`);--> statement-breakpoint
CREATE TABLE `event_dedup` (
	`store_id` text NOT NULL,
	`event_id` text NOT NULL,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_dedup_uq` ON `event_dedup` (`store_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `event_dedup_seen_idx` ON `event_dedup` (`seen_at`);--> statement-breakpoint
CREATE TABLE `integration_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`encrypted_refresh_token` text,
	`expires_at` text,
	`scopes` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_credentials_store_uq` ON `integration_credentials` (`store_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_org_user_uq` ON `memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`product_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text,
	`price` real,
	`availability` text DEFAULT 'unknown' NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variants_store_external_uq` ON `product_variants` (`store_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`handle` text,
	`url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`image_url` text,
	`collection_ids` text DEFAULT '[]' NOT NULL,
	`synced_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_store_external_uq` ON `products` (`store_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `products_store_status_idx` ON `products` (`store_id`,`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`platform` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`external_id` text,
	`site_key` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`delivery_enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_site_key_uq` ON `stores` (`site_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `stores_platform_external_uq` ON `stores` (`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `stores_org_idx` ON `stores` (`organization_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`provider_ref` text,
	`current_period_end` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_org_uq` ON `subscriptions` (`organization_id`);--> statement-breakpoint
CREATE TABLE `suppression_records` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`email_hash` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_uq` ON `suppression_records` (`store_id`,`email_hash`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`organization_id` text NOT NULL,
	`metric` text NOT NULL,
	`period` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_uq` ON `usage_records` (`organization_id`,`metric`,`period`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text,
	`name` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text,
	`platform` text NOT NULL,
	`delivery_id` text NOT NULL,
	`topic` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`received_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_uq` ON `webhook_events` (`platform`,`delivery_id`);
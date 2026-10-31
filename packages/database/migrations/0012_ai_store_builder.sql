CREATE TABLE `site_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`source` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`alt` text,
	`prompt` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_assets_site_idx` ON `site_assets` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`version_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_messages_site_idx` ON `site_messages` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`lines` text NOT NULL,
	`currency` text NOT NULL,
	`subtotal` real NOT NULL,
	`shipping` real NOT NULL,
	`total` real NOT NULL,
	`note` text,
	`payment_ref` text,
	`access_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_orders_number_uq` ON `site_orders` (`site_id`,`number`);--> statement-breakpoint
CREATE INDEX `site_orders_site_idx` ON `site_orders` (`site_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`kind` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_submissions_site_idx` ON `site_submissions` (`site_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `site_submissions_email_idx` ON `site_submissions` (`site_id`,`kind`,`email`);--> statement-breakpoint
CREATE TABLE `site_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`document` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_versions_uq` ON `site_versions` (`site_id`,`number`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`published_version_id` text,
	`published_at` text,
	`prompt` text,
	`brief` text,
	`busy_until` text,
	`stripe_secret_enc` text,
	`notify_email` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_slug_uq` ON `sites` (`slug`);--> statement-breakpoint
CREATE INDEX `sites_org_idx` ON `sites` (`organization_id`,`status`);
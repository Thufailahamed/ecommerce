CREATE TABLE `campaign_group_members` (
	`group_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`store_id` text NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`group_id`, `campaign_id`),
	FOREIGN KEY (`group_id`) REFERENCES `campaign_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_group_members_campaign_idx` ON `campaign_group_members` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `campaign_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_groups_name_uq` ON `campaign_groups` (`store_id`,`name`);--> statement-breakpoint
CREATE TABLE `campaign_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`source_campaign_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaign_templates_store_idx` ON `campaign_templates` (`store_id`);
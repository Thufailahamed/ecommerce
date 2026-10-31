CREATE TABLE `woocommerce_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`method` text NOT NULL,
	`key_permissions` text,
	`encrypted_webhook_secret` text NOT NULL,
	`webhook_ids` text DEFAULT '[]' NOT NULL,
	`webhook_state` text DEFAULT 'pending' NOT NULL,
	`webhook_error` text,
	`verified_at` text,
	`last_webhook_at` text,
	`connected_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `woocommerce_connections_store_uq` ON `woocommerce_connections` (`store_id`);--> statement-breakpoint
ALTER TABLE `shopify_installations` ADD `web_pixel_id` text;--> statement-breakpoint
ALTER TABLE `shopify_installations` ADD `app_metafields_set_at` text;--> statement-breakpoint
ALTER TABLE `shopify_installations` ADD `setup_error` text;
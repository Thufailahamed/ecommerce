CREATE TABLE `shopify_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`shop` text NOT NULL,
	`store_id` text,
	`status` text NOT NULL,
	`scopes` text NOT NULL,
	`encrypted_pending_token` text,
	`claim_token_hash` text,
	`claim_expires_at` text,
	`installed_at` text NOT NULL,
	`uninstalled_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopify_installations_shop_uq` ON `shopify_installations` (`shop`);--> statement-breakpoint
CREATE UNIQUE INDEX `shopify_installations_claim_uq` ON `shopify_installations` (`claim_token_hash`);--> statement-breakpoint
CREATE INDEX `shopify_installations_store_idx` ON `shopify_installations` (`store_id`);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `provider` text;--> statement-breakpoint
-- Backfill: every paid subscription before this migration came through Stripe (Shopify Billing did not exist).
UPDATE `subscriptions` SET `provider` = 'stripe' WHERE `provider_ref` IS NOT NULL OR `customer_ref` IS NOT NULL;
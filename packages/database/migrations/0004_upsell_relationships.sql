CREATE TABLE `product_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`product_id` text NOT NULL,
	`related_product_id` text NOT NULL,
	`kind` text NOT NULL,
	`weight` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_relationships_uq` ON `product_relationships` (`store_id`,`product_id`,`related_product_id`,`kind`);--> statement-breakpoint
CREATE INDEX `product_relationships_lookup_idx` ON `product_relationships` (`store_id`,`product_id`,`kind`);--> statement-breakpoint
ALTER TABLE `analytics_aggregates` ADD `add_to_carts` integer DEFAULT 0 NOT NULL;
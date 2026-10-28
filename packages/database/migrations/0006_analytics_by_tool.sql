CREATE TABLE `metric_counters` (
	`store_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`version_id` text NOT NULL,
	`day` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metric_counters_uq` ON `metric_counters` (`store_id`,`campaign_id`,`version_id`,`day`,`metric`);--> statement-breakpoint
CREATE INDEX `metric_counters_store_day_idx` ON `metric_counters` (`store_id`,`day`);
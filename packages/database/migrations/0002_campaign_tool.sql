ALTER TABLE `campaigns` ADD `tool` text DEFAULT 'toast' NOT NULL;--> statement-breakpoint
CREATE INDEX `campaigns_store_tool_idx` ON `campaigns` (`store_id`,`tool`,`status`);--> statement-breakpoint
-- Backfill: back-in-stock forms were the only email-tool campaigns before tools existed.
UPDATE `campaigns` SET `tool` = 'email' WHERE json_extract(`draft_config`, '$.format') = 'restock';

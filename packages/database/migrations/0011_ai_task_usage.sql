ALTER TABLE `ai_generations` ADD `task` text DEFAULT 'campaign.generate' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_generations` ADD `organization_id` text;--> statement-breakpoint
ALTER TABLE `ai_generations` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `ai_generations` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `ai_generations` ADD `estimated_cost_usd` real;--> statement-breakpoint
UPDATE `ai_generations` SET `organization_id` = (SELECT `organization_id` FROM `stores` WHERE `stores`.`id` = `ai_generations`.`store_id`) WHERE `organization_id` IS NULL;
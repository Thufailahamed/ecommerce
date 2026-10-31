CREATE TABLE `action_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`action` text NOT NULL,
	`input` text NOT NULL,
	`origin` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`rationale` text,
	`evidence` text,
	`requested_by` text,
	`workflow_run_id` text,
	`plan_id` text,
	`decided_by` text,
	`decided_at` text,
	`result` text,
	`error` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `action_requests_store_status_idx` ON `action_requests` (`store_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `action_requests_plan_idx` ON `action_requests` (`plan_id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`version_id` text NOT NULL,
	`trigger_key` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`run_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_runs_trigger_uq` ON `workflow_runs` (`version_id`,`trigger_key`);--> statement-breakpoint
CREATE INDEX `workflow_runs_due_idx` ON `workflow_runs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_workflow_idx` ON `workflow_runs` (`workflow_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`store_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_versions_uq` ON `workflow_versions` (`workflow_id`,`version`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`store_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`draft_definition` text NOT NULL,
	`active_version_id` text,
	`activated_by` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workflows_store_status_idx` ON `workflows` (`store_id`,`status`);
CREATE TABLE `organization_features` (
	`organization_id` text NOT NULL,
	`feature` text NOT NULL,
	`enabled_by` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`organization_id`, `feature`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);

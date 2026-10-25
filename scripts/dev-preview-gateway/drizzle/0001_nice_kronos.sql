CREATE TABLE `preview_ai_providers` (
	`provider` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`base_url` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preview_ai_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_enabled` integer DEFAULT false NOT NULL,
	`default_provider` text DEFAULT 'deepseek' NOT NULL,
	`daily_limit` integer DEFAULT 100 NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL
);

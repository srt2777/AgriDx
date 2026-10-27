ALTER TABLE `preview_ai_providers` ADD `last_test_at` integer;--> statement-breakpoint
ALTER TABLE `preview_ai_providers` ADD `last_test_ok` integer;--> statement-breakpoint
ALTER TABLE `preview_ai_providers` ADD `last_test_latency_ms` integer;--> statement-breakpoint
ALTER TABLE `preview_ai_providers` ADD `last_error_kind` text;
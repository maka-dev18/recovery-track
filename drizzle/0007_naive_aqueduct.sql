CREATE TABLE `app_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text,
	`entity_type` text,
	`entity_id` text,
	`dedupe_key` text NOT NULL,
	`status` text DEFAULT 'unread' NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_notification_dedupe_key_idx` ON `app_notification` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `app_notification_user_idx` ON `app_notification` (`user_id`);--> statement-breakpoint
CREATE INDEX `app_notification_status_idx` ON `app_notification` (`status`);--> statement-breakpoint
CREATE INDEX `app_notification_created_idx` ON `app_notification` (`created_at`);--> statement-breakpoint
CREATE INDEX `app_notification_entity_idx` ON `app_notification` (`entity_type`,`entity_id`);
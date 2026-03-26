CREATE TABLE `admin_outreach_log` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`admin_user_id` text NOT NULL,
	`associate_id` text,
	`target_user_id` text,
	`channel` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'logged' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`admin_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`associate_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_outreach_patient_idx` ON `admin_outreach_log` (`patient_id`);--> statement-breakpoint
CREATE INDEX `admin_outreach_channel_idx` ON `admin_outreach_log` (`channel`);--> statement-breakpoint
CREATE INDEX `admin_outreach_created_idx` ON `admin_outreach_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `patient_badge` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`badge_key` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`awarded_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patient_badge_patient_idx` ON `patient_badge` (`patient_id`);--> statement-breakpoint
CREATE INDEX `patient_badge_key_idx` ON `patient_badge` (`badge_key`);--> statement-breakpoint
CREATE INDEX `patient_badge_awarded_idx` ON `patient_badge` (`awarded_at`);--> statement-breakpoint
CREATE TABLE `patient_coping_log` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`tool_key` text NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patient_coping_log_patient_idx` ON `patient_coping_log` (`patient_id`);--> statement-breakpoint
CREATE INDEX `patient_coping_log_tool_idx` ON `patient_coping_log` (`tool_key`);--> statement-breakpoint
CREATE INDEX `patient_coping_log_created_idx` ON `patient_coping_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `therapy_session_signal` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sender_user_id` text,
	`signal_type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `therapy_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `therapy_session_signal_session_idx` ON `therapy_session_signal` (`session_id`);--> statement-breakpoint
CREATE INDEX `therapy_session_signal_sender_idx` ON `therapy_session_signal` (`sender_user_id`);--> statement-breakpoint
CREATE INDEX `therapy_session_signal_created_idx` ON `therapy_session_signal` (`created_at`);--> statement-breakpoint
CREATE TABLE `user_presence` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role_snapshot` text,
	`last_path` text,
	`last_active_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_presence_last_active_idx` ON `user_presence` (`last_active_at`);--> statement-breakpoint
ALTER TABLE `conversation_thread` ADD `therapist_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `conversation_thread` ADD `associate_id` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `conversation_thread_therapist_idx` ON `conversation_thread` (`therapist_id`);--> statement-breakpoint
CREATE INDEX `conversation_thread_associate_idx` ON `conversation_thread` (`associate_id`);--> statement-breakpoint
ALTER TABLE `therapy_session` ADD `requires_confirmation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `therapy_session` ADD `duration_minutes` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `therapy_session` ADD `automation_source` text;--> statement-breakpoint
ALTER TABLE `therapy_session` ADD `automation_reason` text;--> statement-breakpoint
ALTER TABLE `therapy_session` ADD `meeting_url` text;--> statement-breakpoint
ALTER TABLE `therapy_session` ADD `meeting_code` text;--> statement-breakpoint
ALTER TABLE `therapy_session` ADD `confirmed_by_user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `therapy_session` ADD `confirmed_at` integer;--> statement-breakpoint
CREATE INDEX `therapy_session_confirmation_idx` ON `therapy_session` (`requires_confirmation`);
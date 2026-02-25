CREATE TABLE `ai_session` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_session_patient_idx` ON `ai_session` (`patient_id`);--> statement-breakpoint
CREATE INDEX `ai_session_mode_idx` ON `ai_session` (`mode`);--> statement-breakpoint
CREATE INDEX `ai_session_status_idx` ON `ai_session` (`status`);--> statement-breakpoint
CREATE INDEX `ai_session_started_idx` ON `ai_session` (`started_at`);--> statement-breakpoint

CREATE TABLE `ai_message` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`modality` text DEFAULT 'text' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `ai_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_message_session_idx` ON `ai_message` (`session_id`);--> statement-breakpoint
CREATE INDEX `ai_message_role_idx` ON `ai_message` (`role`);--> statement-breakpoint
CREATE INDEX `ai_message_created_idx` ON `ai_message` (`created_at`);--> statement-breakpoint

CREATE TABLE `ai_risk_signal` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`session_id` text NOT NULL,
	`severity` integer NOT NULL,
	`labels_json` text NOT NULL,
	`explanation` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `ai_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_risk_signal_patient_idx` ON `ai_risk_signal` (`patient_id`);--> statement-breakpoint
CREATE INDEX `ai_risk_signal_session_idx` ON `ai_risk_signal` (`session_id`);--> statement-breakpoint
CREATE INDEX `ai_risk_signal_severity_idx` ON `ai_risk_signal` (`severity`);--> statement-breakpoint
CREATE INDEX `ai_risk_signal_created_idx` ON `ai_risk_signal` (`created_at`);--> statement-breakpoint

CREATE TABLE `job_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_queue_status_idx` ON `job_queue` (`status`);--> statement-breakpoint
CREATE INDEX `job_queue_run_after_idx` ON `job_queue` (`run_after`);--> statement-breakpoint
CREATE INDEX `job_queue_type_idx` ON `job_queue` (`type`);--> statement-breakpoint
CREATE INDEX `job_queue_created_idx` ON `job_queue` (`created_at`);--> statement-breakpoint

CREATE TABLE `patient_history_file` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`uploaded_by_user_id` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`s3_key` text NOT NULL,
	`checksum` text,
	`parse_status` text DEFAULT 'pending' NOT NULL,
	`parse_error` text,
	`parsed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patient_history_file_patient_idx` ON `patient_history_file` (`patient_id`);--> statement-breakpoint
CREATE INDEX `patient_history_file_status_idx` ON `patient_history_file` (`parse_status`);--> statement-breakpoint
CREATE INDEX `patient_history_file_created_idx` ON `patient_history_file` (`created_at`);--> statement-breakpoint

CREATE TABLE `patient_history_signal` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`file_id` text NOT NULL,
	`signal_type` text NOT NULL,
	`signal_value_json` text NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`occurred_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `patient_history_file`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patient_history_signal_patient_idx` ON `patient_history_signal` (`patient_id`);--> statement-breakpoint
CREATE INDEX `patient_history_signal_file_idx` ON `patient_history_signal` (`file_id`);--> statement-breakpoint
CREATE INDEX `patient_history_signal_type_idx` ON `patient_history_signal` (`signal_type`);--> statement-breakpoint
CREATE INDEX `patient_history_signal_created_idx` ON `patient_history_signal` (`created_at`);

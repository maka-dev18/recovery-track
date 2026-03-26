CREATE TABLE `conversation_message` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`sender_user_id` text,
	`legacy_ai_message_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`modality` text DEFAULT 'text' NOT NULL,
	`visibility` text DEFAULT 'shared' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_thread`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`legacy_ai_message_id`) REFERENCES `ai_message`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_message_thread_idx` ON `conversation_message` (`thread_id`);--> statement-breakpoint
CREATE INDEX `conversation_message_patient_idx` ON `conversation_message` (`patient_id`);--> statement-breakpoint
CREATE INDEX `conversation_message_sender_idx` ON `conversation_message` (`sender_user_id`);--> statement-breakpoint
CREATE INDEX `conversation_message_role_idx` ON `conversation_message` (`role`);--> statement-breakpoint
CREATE INDEX `conversation_message_occurred_idx` ON `conversation_message` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `conversation_message_legacy_ai_message_idx` ON `conversation_message` (`legacy_ai_message_id`);--> statement-breakpoint
CREATE TABLE `conversation_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`created_by_user_id` text,
	`legacy_ai_session_id` text,
	`channel` text DEFAULT 'ai_companion' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`subject` text,
	`last_message_at` integer,
	`closed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`legacy_ai_session_id`) REFERENCES `ai_session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversation_thread_patient_idx` ON `conversation_thread` (`patient_id`);--> statement-breakpoint
CREATE INDEX `conversation_thread_channel_idx` ON `conversation_thread` (`channel`);--> statement-breakpoint
CREATE INDEX `conversation_thread_status_idx` ON `conversation_thread` (`status`);--> statement-breakpoint
CREATE INDEX `conversation_thread_last_message_idx` ON `conversation_thread` (`last_message_at`);--> statement-breakpoint
CREATE INDEX `conversation_thread_legacy_ai_session_idx` ON `conversation_thread` (`legacy_ai_session_id`);--> statement-breakpoint
CREATE TABLE `patient_recovery_profile` (
	`patient_id` text PRIMARY KEY NOT NULL,
	`recovery_stage` text DEFAULT 'intake' NOT NULL,
	`care_plan_status` text DEFAULT 'active' NOT NULL,
	`baseline_risk_level` text,
	`primary_goals_json` text DEFAULT '[]' NOT NULL,
	`support_preferences_json` text DEFAULT '{}' NOT NULL,
	`last_reviewed_at` integer,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patient_recovery_profile_stage_idx` ON `patient_recovery_profile` (`recovery_stage`);--> statement-breakpoint
CREATE INDEX `patient_recovery_profile_care_plan_idx` ON `patient_recovery_profile` (`care_plan_status`);--> statement-breakpoint
CREATE INDEX `patient_recovery_profile_reviewed_idx` ON `patient_recovery_profile` (`last_reviewed_at`);--> statement-breakpoint
CREATE TABLE `patient_signal` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`thread_id` text,
	`message_id` text,
	`therapy_session_id` text,
	`risk_score_id` text,
	`detected_by_user_id` text,
	`source` text NOT NULL,
	`signal_type` text NOT NULL,
	`status` text DEFAULT 'observed' NOT NULL,
	`severity` integer DEFAULT 0 NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_thread`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `conversation_message`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`therapy_session_id`) REFERENCES `therapy_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`risk_score_id`) REFERENCES `risk_score`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`detected_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `patient_signal_patient_idx` ON `patient_signal` (`patient_id`);--> statement-breakpoint
CREATE INDEX `patient_signal_thread_idx` ON `patient_signal` (`thread_id`);--> statement-breakpoint
CREATE INDEX `patient_signal_message_idx` ON `patient_signal` (`message_id`);--> statement-breakpoint
CREATE INDEX `patient_signal_therapy_session_idx` ON `patient_signal` (`therapy_session_id`);--> statement-breakpoint
CREATE INDEX `patient_signal_risk_score_idx` ON `patient_signal` (`risk_score_id`);--> statement-breakpoint
CREATE INDEX `patient_signal_source_idx` ON `patient_signal` (`source`);--> statement-breakpoint
CREATE INDEX `patient_signal_type_idx` ON `patient_signal` (`signal_type`);--> statement-breakpoint
CREATE INDEX `patient_signal_severity_idx` ON `patient_signal` (`severity`);--> statement-breakpoint
CREATE INDEX `patient_signal_occurred_idx` ON `patient_signal` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `therapy_session` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`therapist_id` text,
	`thread_id` text,
	`created_by_user_id` text,
	`session_type` text DEFAULT 'therapy' NOT NULL,
	`mode` text DEFAULT 'in_person' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`scheduled_start_at` integer,
	`started_at` integer,
	`ended_at` integer,
	`summary` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`therapist_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_thread`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `therapy_session_patient_idx` ON `therapy_session` (`patient_id`);--> statement-breakpoint
CREATE INDEX `therapy_session_therapist_idx` ON `therapy_session` (`therapist_id`);--> statement-breakpoint
CREATE INDEX `therapy_session_thread_idx` ON `therapy_session` (`thread_id`);--> statement-breakpoint
CREATE INDEX `therapy_session_status_idx` ON `therapy_session` (`status`);--> statement-breakpoint
CREATE INDEX `therapy_session_scheduled_idx` ON `therapy_session` (`scheduled_start_at`);--> statement-breakpoint
CREATE INDEX `therapy_session_started_idx` ON `therapy_session` (`started_at`);
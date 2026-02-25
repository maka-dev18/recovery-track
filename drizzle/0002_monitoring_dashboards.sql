CREATE TABLE `associate_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`associate_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` integer NOT NULL,
	`note` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`associate_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `associate_observation_patient_idx` ON `associate_observation` (`patient_id`);--> statement-breakpoint
CREATE INDEX `associate_observation_associate_idx` ON `associate_observation` (`associate_id`);--> statement-breakpoint
CREATE INDEX `associate_observation_created_idx` ON `associate_observation` (`created_at`);--> statement-breakpoint
CREATE TABLE `patient_checkin` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`mood` integer NOT NULL,
	`craving` integer NOT NULL,
	`stress` integer NOT NULL,
	`sleep_hours` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `patient_checkin_patient_idx` ON `patient_checkin` (`patient_id`);--> statement-breakpoint
CREATE INDEX `patient_checkin_created_idx` ON `patient_checkin` (`created_at`);--> statement-breakpoint
CREATE TABLE `risk_score` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`score` integer NOT NULL,
	`tier` text NOT NULL,
	`source` text NOT NULL,
	`factors` text NOT NULL,
	`checkin_id` text,
	`observation_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checkin_id`) REFERENCES `patient_checkin`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`observation_id`) REFERENCES `associate_observation`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `risk_score_patient_idx` ON `risk_score` (`patient_id`);--> statement-breakpoint
CREATE INDEX `risk_score_tier_idx` ON `risk_score` (`tier`);--> statement-breakpoint
CREATE INDEX `risk_score_created_idx` ON `risk_score` (`created_at`);--> statement-breakpoint
CREATE TABLE `risk_alert` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`therapist_id` text,
	`risk_score_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`level` text NOT NULL,
	`reason` text NOT NULL,
	`details` text,
	`triggered_by_user_id` text,
	`acknowledged_by_user_id` text,
	`acknowledged_at` integer,
	`resolved_by_user_id` text,
	`resolved_at` integer,
	`resolution_note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`therapist_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`risk_score_id`) REFERENCES `risk_score`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`triggered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `risk_alert_patient_idx` ON `risk_alert` (`patient_id`);--> statement-breakpoint
CREATE INDEX `risk_alert_therapist_idx` ON `risk_alert` (`therapist_id`);--> statement-breakpoint
CREATE INDEX `risk_alert_status_idx` ON `risk_alert` (`status`);--> statement-breakpoint
CREATE INDEX `risk_alert_level_idx` ON `risk_alert` (`level`);--> statement-breakpoint
CREATE INDEX `risk_alert_created_idx` ON `risk_alert` (`created_at`);

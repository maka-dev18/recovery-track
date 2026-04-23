ALTER TABLE `patient_history_file` ADD `gemini_file_name` text;--> statement-breakpoint
ALTER TABLE `patient_history_file` ADD `gemini_file_uri` text;--> statement-breakpoint
ALTER TABLE `patient_history_file` ADD `extraction_model` text;--> statement-breakpoint
ALTER TABLE `patient_history_file` ADD `extraction_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_history_file` ADD `extracted_at` integer;
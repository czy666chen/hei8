CREATE TABLE `realtime_rooms` (
	`match_id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "realtime_rooms_status_ck" CHECK("realtime_rooms"."status" in ('draft', 'active', 'completed', 'archiving_failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `realtime_rooms_code_uq` ON `realtime_rooms` (`room_code`);--> statement-breakpoint
CREATE INDEX `realtime_rooms_status_updated_idx` ON `realtime_rooms` (`status`,`updated_at`);
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_score_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`actor_user_id` text,
	`actor_device_id` text,
	`player_id` text NOT NULL,
	`score_delta` integer NOT NULL,
	`correction_event_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`actor_device_id`) REFERENCES `devices`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`player_id`) REFERENCES `match_players`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`correction_event_id`) REFERENCES `score_events`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "score_events_sequence_ck" CHECK("__new_score_events"."sequence_no" >= 1),
	CONSTRAINT "score_events_payload_json_ck" CHECK(json_valid("__new_score_events"."payload_json"))
);
--> statement-breakpoint
INSERT INTO `__new_score_events`("id", "match_id", "operation_id", "sequence_no", "actor_user_id", "actor_device_id", "player_id", "score_delta", "correction_event_id", "payload_json", "occurred_at", "created_at") SELECT "id", "match_id", "operation_id", "sequence_no", "actor_user_id", "actor_device_id", "player_id", "score_delta", "correction_event_id", "payload_json", "occurred_at", "created_at" FROM `score_events`;--> statement-breakpoint
DROP TABLE `score_events`;--> statement-breakpoint
ALTER TABLE `__new_score_events` RENAME TO `score_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `score_events_match_sequence_uq` ON `score_events` (`match_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `score_events_match_operation_uq` ON `score_events` (`match_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `score_events_player_idx` ON `score_events` (`player_id`,`sequence_no`);
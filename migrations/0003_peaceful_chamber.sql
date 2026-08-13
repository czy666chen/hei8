PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_match_players` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`seat_no` integer NOT NULL,
	`user_id` text,
	`role` text DEFAULT 'player' NOT NULL,
	`nickname_snapshot` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`left_at` integer,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "match_players_seat_ck" CHECK("__new_match_players"."seat_no" >= 0),
	CONSTRAINT "match_players_role_ck" CHECK("__new_match_players"."role" in ('host', 'player', 'spectator'))
);
--> statement-breakpoint
INSERT INTO `__new_match_players`("id", "match_id", "seat_no", "user_id", "role", "nickname_snapshot", "joined_at", "left_at") SELECT "id", "match_id", "seat_no", "user_id", "role", "nickname_snapshot", "joined_at", "left_at" FROM `match_players`;--> statement-breakpoint
DROP TABLE `match_players`;--> statement-breakpoint
ALTER TABLE `__new_match_players` RENAME TO `match_players`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `match_players_match_seat_uq` ON `match_players` (`match_id`,`seat_no`);--> statement-breakpoint
CREATE INDEX `match_players_user_match_idx` ON `match_players` (`user_id`,`match_id`);
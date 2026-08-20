CREATE TABLE `match_user_states` (
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`match_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "match_user_states_deleted_ck" CHECK("match_user_states"."deleted_at" is null or "match_user_states"."deleted_at" > 0)
);
--> statement-breakpoint
CREATE INDEX `match_user_states_user_deleted_idx` ON `match_user_states` (`user_id`,`deleted_at`);
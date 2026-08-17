ALTER TABLE `match_players` ADD `kicked_at` integer;--> statement-breakpoint
ALTER TABLE `match_players` ADD `kicked_by_user_id` text REFERENCES `users`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `match_players_match_kicked_idx` ON `match_players` (`match_id`,`kicked_at`);

CREATE TABLE `auth_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`request_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "auth_audit_metadata_json_ck" CHECK(json_valid("auth_audit_events"."metadata_json")),
	CONSTRAINT "auth_audit_outcome_ck" CHECK("auth_audit_events"."outcome" in ('success', 'failure'))
);
--> statement-breakpoint
CREATE INDEX `auth_audit_user_created_idx` ON `auth_audit_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `auth_audit_created_idx` ON `auth_audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `card_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`sequence_no` integer NOT NULL,
	`actor_user_id` text,
	`actor_device_id` text,
	`card_instance_snapshot_json` text NOT NULL,
	`score_event_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`actor_device_id`) REFERENCES `devices`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`score_event_id`) REFERENCES `score_events`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "card_events_sequence_ck" CHECK("card_events"."sequence_no" >= 1),
	CONSTRAINT "card_events_snapshot_json_ck" CHECK(json_valid("card_events"."card_instance_snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_events_match_sequence_uq` ON `card_events` (`match_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `card_events_match_operation_uq` ON `card_events` (`match_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `deck_cards` (
	`deck_version_id` text NOT NULL,
	`card_instance_id` text NOT NULL,
	`card_definition_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`card_snapshot_json` text NOT NULL,
	PRIMARY KEY(`deck_version_id`, `card_instance_id`),
	FOREIGN KEY (`deck_version_id`) REFERENCES `deck_versions`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "deck_cards_quantity_ck" CHECK("deck_cards"."quantity" > 0),
	CONSTRAINT "deck_cards_sort_order_ck" CHECK("deck_cards"."sort_order" >= 0),
	CONSTRAINT "deck_cards_snapshot_json_ck" CHECK(json_valid("deck_cards"."card_snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_cards_version_sort_uq` ON `deck_cards` (`deck_version_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `deck_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`checksum` text NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "deck_versions_snapshot_json_ck" CHECK(json_valid("deck_versions"."snapshot_json")),
	CONSTRAINT "deck_versions_version_ck" CHECK("deck_versions"."version_no" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_versions_deck_version_uq` ON `deck_versions` (`deck_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`current_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "decks_visibility_ck" CHECK("decks"."visibility" in ('private', 'shared')),
	CONSTRAINT "decks_current_version_ck" CHECK("decks"."current_version" >= 0)
);
--> statement-breakpoint
CREATE INDEX `decks_owner_deleted_idx` ON `decks` (`owner_user_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_key` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_user_device_key_uq` ON `devices` (`user_id`,`device_key`);--> statement-breakpoint
CREATE INDEX `devices_user_revoked_idx` ON `devices` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `match_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`reason` text,
	`before_version` integer,
	`after_version` integer,
	`before_digest` text,
	`after_digest` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "match_audit_metadata_json_ck" CHECK(json_valid("match_audit_events"."metadata_json"))
);
--> statement-breakpoint
CREATE INDEX `match_audit_match_created_idx` ON `match_audit_events` (`match_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `match_audit_created_idx` ON `match_audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `match_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`match_player_id` text NOT NULL,
	`claimant_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by_user_id` text,
	`review_reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`reviewed_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`match_player_id`) REFERENCES `match_players`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`claimant_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "match_claims_status_ck" CHECK("match_claims"."status" in ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `match_claims_claimant_status_created_idx` ON `match_claims` (`claimant_user_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `match_claims_player_status_idx` ON `match_claims` (`match_player_id`,`status`);--> statement-breakpoint
CREATE TABLE `match_players` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`seat_no` integer NOT NULL,
	`user_id` text,
	`nickname_snapshot` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`left_at` integer,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "match_players_seat_ck" CHECK("match_players"."seat_no" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_players_match_seat_uq` ON `match_players` (`match_id`,`seat_no`);--> statement-breakpoint
CREATE INDEX `match_players_user_match_idx` ON `match_players` (`user_id`,`match_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`privacy` text DEFAULT 'private' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`write_lease_device_id` text,
	`write_lease_expires_at` integer,
	`snapshot_json` text,
	`snapshot_checksum` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`write_lease_device_id`) REFERENCES `devices`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "matches_status_ck" CHECK("matches"."status" in ('draft', 'active', 'completed', 'cancelled')),
	CONSTRAINT "matches_privacy_ck" CHECK("matches"."privacy" in ('private', 'participants')),
	CONSTRAINT "matches_version_ck" CHECK("matches"."version" >= 0),
	CONSTRAINT "matches_snapshot_json_ck" CHECK("matches"."snapshot_json" is null or json_valid("matches"."snapshot_json"))
);
--> statement-breakpoint
CREATE INDEX `matches_owner_ended_idx` ON `matches` (`owner_user_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `matches_lease_idx` ON `matches` (`write_lease_device_id`,`write_lease_expires_at`);--> statement-breakpoint
CREATE TABLE `player_contacts` (
	`owner_user_id` text NOT NULL,
	`contact_user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text NOT NULL,
	`last_played_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`owner_user_id`, `contact_user_id`),
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`contact_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "player_contacts_not_self_ck" CHECK("player_contacts"."owner_user_id" <> "player_contacts"."contact_user_id"),
	CONSTRAINT "player_contacts_status_ck" CHECK("player_contacts"."status" in ('active', 'removed', 'blocked')),
	CONSTRAINT "player_contacts_source_ck" CHECK("player_contacts"."source" in ('invite', 'match', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `player_contacts_owner_last_played_idx` ON `player_contacts` (`owner_user_id`,`last_played_at`);--> statement-breakpoint
CREATE TABLE `player_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_user_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`used_by_user_id` text,
	`used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`creator_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`used_by_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_invites_token_digest_uq` ON `player_invites` (`token_digest`);--> statement-breakpoint
CREATE INDEX `player_invites_creator_created_idx` ON `player_invites` (`creator_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`public_code` text NOT NULL,
	`nickname` text NOT NULL,
	`avatar_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "profiles_public_code_ck" CHECK(length("profiles"."public_code") between 8 and 32),
	CONSTRAINT "profiles_nickname_ck" CHECK(length("profiles"."nickname") between 1 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_public_code_uq` ON `profiles` (`public_code`);--> statement-breakpoint
CREATE TABLE `score_events` (
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
	CONSTRAINT "score_events_sequence_ck" CHECK("score_events"."sequence_no" >= 1),
	CONSTRAINT "score_events_payload_json_ck" CHECK(json_valid("score_events"."payload_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_events_match_sequence_uq` ON `score_events` (`match_id`,`sequence_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `score_events_match_operation_uq` ON `score_events` (`match_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `score_events_player_idx` ON `score_events` (`player_id`,`sequence_no`);--> statement-breakpoint
CREATE TABLE `score_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`rules_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "score_presets_rules_json_ck" CHECK(json_valid("score_presets"."rules_json")),
	CONSTRAINT "score_presets_version_ck" CHECK("score_presets"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `score_presets_owner_deleted_idx` ON `score_presets` (`owner_user_id`,`deleted_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "sessions_id_uuid_length_ck" CHECK(length("sessions"."id") = 36)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_digest_uq` ON `sessions` (`token_digest`);--> statement-breakpoint
CREATE INDEX `sessions_user_revoked_last_used_idx` ON `sessions` (`user_id`,`revoked_at`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `sync_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`result` text NOT NULL,
	`response_json` text DEFAULT '{}' NOT NULL,
	`received_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "sync_receipts_result_ck" CHECK("sync_receipts"."result" in ('accepted', 'duplicate', 'rejected', 'conflict')),
	CONSTRAINT "sync_receipts_response_json_ck" CHECK(json_valid("sync_receipts"."response_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_receipts_user_operation_uq` ON `sync_receipts` (`user_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `sync_receipts_received_idx` ON `sync_receipts` (`received_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_username` text NOT NULL,
	`display_username` text NOT NULL,
	`password_digest` text NOT NULL,
	`password_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "users_id_uuid_length_ck" CHECK(length("users"."id") = 36),
	CONSTRAINT "users_username_format_ck" CHECK(length("users"."normalized_username") between 4 and 24
          and "users"."normalized_username" = lower("users"."normalized_username")
          and "users"."normalized_username" not glob '*[^a-z0-9_]*'),
	CONSTRAINT "users_password_version_ck" CHECK("users"."password_version" >= 1),
	CONSTRAINT "users_status_ck" CHECK("users"."status" in ('active', 'disabled', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_username_uq` ON `users` (`normalized_username`);
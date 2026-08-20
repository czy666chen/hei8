PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`normalized_username` text NOT NULL,
	`display_username` text NOT NULL,
	`password_digest` text NOT NULL,
	`password_version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "users_id_uuid_length_ck" CHECK(length("__new_users"."id") = 36),
	CONSTRAINT "users_username_format_ck" CHECK(length("__new_users"."normalized_username") between 2 and 24
          and "__new_users"."normalized_username" = lower("__new_users"."normalized_username")
          and "__new_users"."normalized_username" not glob '*[^a-z0-9_]*'),
	CONSTRAINT "users_password_version_ck" CHECK("__new_users"."password_version" >= 1),
	CONSTRAINT "users_status_ck" CHECK("__new_users"."status" in ('active', 'disabled', 'deleted'))
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "normalized_username", "display_username", "password_digest", "password_version", "status", "created_at", "updated_at", "deleted_at") SELECT "id", "normalized_username", "display_username", "password_digest", "password_version", "status", "created_at", "updated_at", "deleted_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_username_uq` ON `users` (`normalized_username`);--> statement-breakpoint
CREATE TRIGGER `users_registration_username_insert_ck`
BEFORE INSERT ON `users`
FOR EACH ROW
WHEN length(NEW.normalized_username) < 2
  OR length(NEW.normalized_username) > 8
  OR NEW.normalized_username <> lower(NEW.normalized_username)
  OR NEW.normalized_username glob '*[^a-z0-9_]*'
BEGIN
  SELECT RAISE(ABORT, 'users registration username must be 2-8 letters, digits, or underscore');
END;
--> statement-breakpoint
CREATE TRIGGER `users_registration_username_update_ck`
BEFORE UPDATE OF normalized_username ON `users`
FOR EACH ROW
WHEN length(NEW.normalized_username) < 2
  OR length(NEW.normalized_username) > 8
  OR NEW.normalized_username <> lower(NEW.normalized_username)
  OR NEW.normalized_username glob '*[^a-z0-9_]*'
BEGIN
  SELECT RAISE(ABORT, 'users registration username must be 2-8 letters, digits, or underscore');
END;

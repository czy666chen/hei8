import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

process.env.WRANGLER_WRITE_LOGS ??= "false";
process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
process.env.XDG_CONFIG_HOME ??= ".wrangler/xdg";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  define: {
    __D1_MIGRATIONS__: JSON.stringify(migrations),
  },
  plugins: [
    cloudflareTest({
      main: "./worker/auth/test-entry.ts",
      miniflare: {
        compatibilityDate: "2026-08-11",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        durableObjects: {
          MATCH_ROOM: { className: "MatchRoom", useSQLite: true },
        },
        bindings: {
          APP_ENV: "test",
          REGISTRATION_INVITE_CODE: "replace-with-test-invite-code",
          PASSWORD_HMAC_KEY: "replace-with-test-password-hmac-key",
          SESSION_HMAC_KEY: "replace-with-test-session-hmac-key",
        },
      },
    }),
  ],
  test: {
    include: ["worker/**/*.integration.test.ts"],
  },
});

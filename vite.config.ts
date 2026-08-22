import vinext from "vinext";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      watch: {
        // Atomic editor saves create `*.tmpdir/*.tmp` and `name~XXXX.TMP` files
        // that Windows file watchers report as EBUSY and crash the dev server;
        // scratch work files must not be watched either.
        ignored: [
          "**/*.tmpdir/**",
          "**/work/**",
          "**/*.tmp",
          "**/*.TMP",
          "**/*~*",
        ],
        ...(isCodexSeatbeltSandbox ? { useFsEvents: false, usePolling: true } : {}),
      },
    },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
      {
        name: "remove-build-secrets",
        apply: "build",
        async closeBundle() {
          await rm(resolve(process.cwd(), "dist", "server", ".dev.vars"), { force: true });
        },
      },
    ],
  };
});

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: "./src/index.ts",
        miniflare: {
          compatibilityDate: "2025-12-01",
          kvNamespaces: ["MONITOR_KV"],
          bindings: {
            VAPID_PUBLIC_KEY: "test-public-key",
            VAPID_PRIVATE_KEY: "test-private-key",
            TELEGRAM_BOT_TOKEN: "test-bot-token",
          },
        },
      },
    },
  },
});

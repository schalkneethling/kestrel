import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.test.toml" },
      miniflare: {
        bindings: {
          API_BEARER_SECRET: "test-bearer-secret",
          TEST_MIGRATIONS: await readD1Migrations(
            new URL("../../migrations", import.meta.url).pathname,
          ),
          VAPID_PUBLIC_KEY: "test-vapid-public-key",
        },
      },
    })),
  ],
  resolve: {
    alias: {
      "@varlock/cloudflare-integration/init": new URL("./test/varlock-init.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});

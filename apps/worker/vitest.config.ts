import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.test.toml",
      },
    }),
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

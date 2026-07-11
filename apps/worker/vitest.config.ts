import { fileURLToPath } from "node:url";

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
      "@varlock/cloudflare-integration/init": fileURLToPath(
        new URL("./test/varlock-init.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});

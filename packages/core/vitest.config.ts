import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
  },
});

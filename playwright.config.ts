import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(
  (globalThis as typeof globalThis & { process?: { env?: { CI?: string } } }).process?.env?.CI,
);

export default defineConfig({
  testDir: "./apps/dashboard/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm --filter @kestrel/dashboard dev --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !isCI,
  },
});

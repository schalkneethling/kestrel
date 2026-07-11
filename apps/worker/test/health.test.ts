/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vite-plus/test";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

interface HealthResponse {
  ok: boolean;
  database: {
    ok: boolean;
    checkedAt: string | null;
  };
  supportedAtsTypes: string[];
}

describe("Worker health endpoint", () => {
  it("reports a successful D1 write and read", async () => {
    const response = await SELF.fetch("https://kestrel.test/api/health", {
      headers: { authorization: "Bearer test-bearer-secret" },
    });
    const body = (await response.json()) as HealthResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(body).toEqual({
      ok: true,
      database: {
        ok: true,
        checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
      supportedAtsTypes: ["greenhouse", "lever", "ashby"],
    });
  });
});

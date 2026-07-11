import { describe, expect, it, vi } from "vite-plus/test";
import { handleRequest } from "../src/index";
import type { WorkerEnv } from "../src/index";

function envWithAssets(fetch: Fetcher["fetch"]): WorkerEnv {
  return {
    ASSETS: { fetch, connect: vi.fn() },
    DB: {} as D1Database,
  };
}

describe("Worker request dispatch", () => {
  it("serves non-API routes through the static asset binding", async () => {
    const fetch = vi.fn(async () => new Response("dashboard", { status: 200 }));
    const request = new Request("https://kestrel.test/jobs/active");

    const response = await handleRequest(request, envWithAssets(fetch));

    expect(await response.text()).toBe("dashboard");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(request);
  });

  it.each(["/api", "/api/health"])("keeps %s behind API authorization", async (pathname) => {
    const fetch = vi.fn(async () => new Response("dashboard"));

    const response = await handleRequest(
      new Request(`https://kestrel.test${pathname}`),
      envWithAssets(fetch),
    );

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not treat API-looking path segments as API routes", async () => {
    const fetch = vi.fn(async () => new Response("dashboard"));

    const response = await handleRequest(
      new Request("https://kestrel.test/apiary"),
      envWithAssets(fetch),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

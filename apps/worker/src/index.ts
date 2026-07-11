import "@varlock/cloudflare-integration/init";
import { createAdapterRegistry } from "@kestrel/core";
import { classifyWithCore, createCronHandler, matchesPersistedJob } from "./cycle";
import { D1Repository } from "./db/repository";
import { handleApi } from "./api";
import type { Env } from "./api";

export type WorkerEnv = Env & {
  ASSETS: Fetcher;
};

export function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return handleApi(request, env);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const http = async ({ url, headers }: { url: string; headers: Record<string, string> }) => {
      const response = await fetch(url, { headers });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        json: () => response.json(),
      };
    };
    await createCronHandler({
      persistence: new D1Repository(env.DB),
      adapters: createAdapterRegistry(http),
      classifySnapshot: classifyWithCore,
      matchesCriteria: matchesPersistedJob,
    })();
  },
};

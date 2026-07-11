import "@varlock/cloudflare-integration/init";
import { createAdapterRegistry } from "@kestrel/core";
import { classifyWithCore, createCronHandler, matchesPersistedJob } from "./cycle";
import { D1Repository } from "./db/repository";
import { handleApi } from "./api";
import type { Env } from "./api";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleApi(request, env);
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

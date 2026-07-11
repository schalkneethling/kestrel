import "@varlock/cloudflare-integration/init";
import { createAdapterRegistry, SUPPORTED_ATS_TYPES } from "@kestrel/core";
import { classifyWithCore, createCronHandler, matchesPersistedJob } from "./cycle";
import { D1Repository } from "./db/repository";

interface Env {
  API_BEARER_SECRET?: string;
  DB: D1Database;
}

interface HealthCheckRow {
  id: string;
  checked_at: string;
}

function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

async function checkDatabase(db: D1Database): Promise<{ ok: boolean; checkedAt: string | null }> {
  const id = crypto.randomUUID();
  const checkedAt = new Date().toISOString();

  await db
    .prepare("INSERT INTO worker_health_checks (id, checked_at) VALUES (?, ?)")
    .bind(id, checkedAt)
    .run();

  const row = await db
    .prepare("SELECT id, checked_at FROM worker_health_checks WHERE id = ?")
    .bind(id)
    .first<HealthCheckRow>();

  return {
    ok: row?.id === id,
    checkedAt: row?.checked_at ?? null,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      const database = await checkDatabase(env.DB);

      return json({
        ok: database.ok,
        database,
        supportedAtsTypes: SUPPORTED_ATS_TYPES,
      });
    }

    return json({ error: "Not found" }, { status: 404 });
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

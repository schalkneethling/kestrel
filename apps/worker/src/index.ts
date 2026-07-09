import "@varlock/cloudflare-integration/init";
import { SUPPORTED_ATS_TYPES } from "@kestrel/core";

interface Env {
  API_BEARER_SECRET?: string;
  DB: D1Database;
}

interface HealthCheckRow {
  id: string;
  checked_at: string;
}

const HEALTH_CHECK_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS worker_health_checks (id TEXT PRIMARY KEY, checked_at TEXT NOT NULL)";

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

  await db.exec(HEALTH_CHECK_TABLE_SQL);
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

  async scheduled(): Promise<void> {
    // E3.6 will wire the poll cycle here after the engine exists.
  },
};

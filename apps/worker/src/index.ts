import "@varlock/cloudflare-integration/init";
import { SUPPORTED_ATS_TYPES } from "@kestrel/core";

interface Env {
  API_BEARER_SECRET?: string;
}

function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        supportedAtsTypes: SUPPORTED_ATS_TYPES,
      });
    }

    return json({ error: "Not found" }, { status: 404 });
  },

  async scheduled(): Promise<void> {
    // E3.6 will wire the poll cycle here after the engine exists.
  },
};

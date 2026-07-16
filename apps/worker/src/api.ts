import { createAdapterRegistry, SUPPORTED_ATS_TYPES } from "@kestrel/core";
import type { Company, Criteria, PushSubscription } from "@kestrel/core";
import {
  classifyWithCore,
  matchPersistedJob,
  matchesPersistedJob,
  runPollCycle,
  runRetentionSweep,
} from "./cycle";
import { D1Repository } from "./db/repository";

export type Env = {
  API_BEARER_SECRET?: string;
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
};

const MANUAL_COOLDOWN_SECONDS = 60;
const ATS_REQUEST_TIMEOUT_MILLISECONDS = 15_000;
const HEALTH_PROBE_ID = "probe:health";

const json = (data: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
};

const error = (status: number, message: string, details?: Record<string, unknown>) =>
  json({ error: message, ...details }, { status });

const cooldownError = (message: string, retryAfterSeconds: number) =>
  json(
    { error: message, retryAfterSeconds },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );

async function authorized(request: Request, secret: string | undefined) {
  if (!secret) return false;
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return false;
  const bytes = (value: string) => new TextEncoder().encode(value);
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes(secret)),
    crypto.subtle.digest("SHA-256", bytes(token)),
  ]);
  const left = new Uint8Array(expected);
  const right = new Uint8Array(actual);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "Content-Type must be application/json");
  }
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "Request body must be a JSON object");
  }
}

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const text = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.trim() === "")
    throw new ApiError(400, `${name} is required`);
  return value.trim();
};
const nullableText = (value: unknown, name: string) => (value == null ? null : text(value, name));
const stringList = (value: unknown, name: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ApiError(400, `${name} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
};

function companyFrom(value: Record<string, unknown>, id?: string): Company {
  const atsType = text(value.atsType, "atsType");
  const status = text(value.status, "status");
  if (![...SUPPORTED_ATS_TYPES, "unsupported"].includes(atsType as never))
    throw new ApiError(400, "Invalid atsType");
  if (!["active", "paused", "unsupported"].includes(status))
    throw new ApiError(400, "Invalid status");
  return {
    id:
      id ??
      (typeof value.id === "string" && value.id.trim() ? value.id.trim() : crypto.randomUUID()),
    name: text(value.name, "name"),
    atsType: atsType as Company["atsType"],
    boardToken: nullableText(value.boardToken, "boardToken"),
    careersUrl: text(value.careersUrl, "careersUrl"),
    status: status as Company["status"],
    unsupportedPlatform: nullableText(value.unsupportedPlatform, "unsupportedPlatform"),
    notes: nullableText(value.notes, "notes"),
  };
}

function criteriaFrom(value: Record<string, unknown>, id?: string): Criteria {
  if (typeof value.enabled !== "boolean") throw new ApiError(400, "enabled must be a boolean");
  return {
    id:
      id ??
      (typeof value.id === "string" && value.id.trim() ? value.id.trim() : crypto.randomUUID()),
    name: text(value.name, "name"),
    enabled: value.enabled,
    titleIncludes: stringList(value.titleIncludes, "titleIncludes"),
    titleExcludes: stringList(value.titleExcludes, "titleExcludes"),
    locationHardExcludes: stringList(value.locationHardExcludes, "locationHardExcludes"),
    regions: stringList(value.regions, "regions"),
  };
}

function adapters() {
  return createAdapterRegistry(async ({ url, headers }) => {
    const signal: AbortSignal = AbortSignal.timeout(ATS_REQUEST_TIMEOUT_MILLISECONDS);
    const response = await fetch(url, { headers, signal });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      json: () => response.json(),
    };
  });
}

async function acquireMaintenanceLease(db: D1Database, key: string, now: Date) {
  const checkedAt = now.toISOString();
  const cutoff = new Date(now.getTime() - MANUAL_COOLDOWN_SECONDS * 1_000).toISOString();
  const acquired = await db
    .prepare(
      `INSERT INTO worker_health_checks (id, checked_at) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at
       WHERE worker_health_checks.checked_at <= ?
       RETURNING checked_at`,
    )
    .bind(key, checkedAt, cutoff)
    .first<{ checked_at: string }>();
  if (acquired) return { acquired: true as const, retryAfterSeconds: 0 };

  const lease = await db
    .prepare("SELECT checked_at FROM worker_health_checks WHERE id = ?")
    .bind(key)
    .first<{ checked_at: string }>();
  const elapsed = lease ? now.getTime() - Date.parse(lease.checked_at) : 0;
  return {
    acquired: false as const,
    retryAfterSeconds: Math.max(1, Math.ceil(MANUAL_COOLDOWN_SECONDS - elapsed / 1_000)),
  };
}

const routeId = (pathname: string, collection: string) => {
  const match = pathname.match(new RegExp(`^/api/${collection}/([^/]+)$`));
  return match ? decodeURIComponent(match[1]) : null;
};

export async function handleApi(request: Request, env: Env): Promise<Response> {
  if (!(await authorized(request, env.API_BEARER_SECRET))) {
    return error(401, "Unauthorized", undefined);
  }
  const url = new URL(request.url);
  const repository = new D1Repository(env.DB);
  const method = request.method.toUpperCase();

  try {
    if (url.pathname === "/api/health" && method === "GET") {
      const checkedAt = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO worker_health_checks (id, checked_at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at",
      )
        .bind(HEALTH_PROBE_ID, checkedAt)
        .run();
      const row = await env.DB.prepare("SELECT id FROM worker_health_checks WHERE id = ?")
        .bind(HEALTH_PROBE_ID)
        .first<{ id: string }>();
      return json({
        ok: row?.id === HEALTH_PROBE_ID,
        database: { ok: row?.id === HEALTH_PROBE_ID, checkedAt },
        supportedAtsTypes: SUPPORTED_ATS_TYPES,
      });
    }

    if (url.pathname === "/api/companies") {
      if (method === "GET") return json({ companies: await repository.listCompanies() });
      if (method === "POST") {
        const company = companyFrom(await body(request));
        await repository.saveCompany(company);
        return json({ company }, { status: 201 });
      }
    }
    const companyId = routeId(url.pathname, "companies");
    if (companyId) {
      if (method === "PUT" || method === "PATCH") {
        const input = await body(request);
        const existing = await repository.findCompany(companyId);
        if (!existing) return error(404, "Company not found");
        const company = companyFrom(
          method === "PATCH" ? { ...existing, ...input } : input,
          companyId,
        );
        await repository.saveCompany(company);
        return json({ company });
      }
      if (method === "DELETE") {
        const result = await repository.deleteCompany(companyId);
        if (result === "deleted") return new Response(null, { status: 204 });
        if (result === "conflict") {
          return error(409, "Company has durable role history and cannot be deleted");
        }
        return error(404, "Company not found");
      }
    }

    if (url.pathname === "/api/jobs" && method === "GET") {
      const jobs = await repository.listJobs(url.searchParams.get("companyId") ?? undefined);
      const criteria = await repository.listCriteria();
      const userStateByStableKey = await repository.listRoleUserStates(
        jobs.map(({ stableKey }) => stableKey),
      );
      const enriched = jobs.map((job) => {
        const { matchedCriteriaIds } = matchPersistedJob(criteria, job);
        return {
          ...job,
          appliedAt: userStateByStableKey[job.stableKey]?.appliedAt ?? null,
          notInterestedAt: userStateByStableKey[job.stableKey]?.notInterestedAt ?? null,
          matchedCriteriaIds,
        };
      });
      const status = url.searchParams.get("status");
      const filtered =
        status === "active"
          ? enriched.filter((job) => job.removedAt === null)
          : status === "removed"
            ? enriched.filter((job) => job.removedAt !== null)
            : status === "applied"
              ? enriched.filter((job) => job.appliedAt !== null)
              : status === "unapplied"
                ? enriched.filter((job) => job.appliedAt === null)
                : enriched;
      const interest = url.searchParams.get("interest") ?? "current";
      if (!["current", "dismissed", "all"].includes(interest)) {
        throw new ApiError(400, "Invalid interest filter");
      }
      const interested =
        interest === "current"
          ? filtered.filter((job) => job.notInterestedAt === null)
          : interest === "dismissed"
            ? filtered.filter((job) => job.notInterestedAt !== null)
            : filtered;
      const scoped =
        url.searchParams.get("scope") === "all"
          ? interested
          : interested.filter((job) => job.matchedCriteriaIds.length > 0);
      return json({ jobs: scoped });
    }
    const applied = url.pathname.match(/^\/api\/jobs\/([^/]+)\/applied$/);
    if (applied && (method === "PUT" || method === "PATCH")) {
      const stableKey = decodeURIComponent(applied[1]);
      const role = await repository.findRole(stableKey);
      if (!role) return error(404, "Job role not found");
      const value = await body(request);
      if (typeof value.applied !== "boolean") throw new ApiError(400, "applied must be a boolean");
      const appliedAt = value.applied ? new Date().toISOString() : null;
      await repository.setRoleAppliedAt(stableKey, appliedAt);
      return json({
        stableKey,
        appliedAt,
        notInterestedAt: value.applied ? null : role.notInterestedAt,
      });
    }
    const notInterested = url.pathname.match(/^\/api\/jobs\/([^/]+)\/not-interested$/);
    if (notInterested && (method === "PUT" || method === "PATCH")) {
      const stableKey = decodeURIComponent(notInterested[1]);
      const role = await repository.findRole(stableKey);
      if (!role) return error(404, "Job role not found");
      const value = await body(request);
      if (typeof value.notInterested !== "boolean") {
        throw new ApiError(400, "notInterested must be a boolean");
      }
      const notInterestedAt = value.notInterested ? new Date().toISOString() : null;
      await repository.setRoleNotInterestedAt(stableKey, notInterestedAt);
      return json({
        stableKey,
        appliedAt: value.notInterested ? null : role.appliedAt,
        notInterestedAt,
      });
    }

    if (url.pathname === "/api/criteria") {
      if (method === "GET") return json({ criteria: await repository.listCriteria() });
      if (method === "POST") {
        const criteria = criteriaFrom(await body(request));
        await repository.saveCriteria(criteria);
        return json({ criteria }, { status: 201 });
      }
    }
    const criteriaId = routeId(url.pathname, "criteria");
    if (criteriaId) {
      if (method === "PUT") {
        const criteria = criteriaFrom(await body(request), criteriaId);
        await repository.saveCriteria(criteria);
        return json({ criteria });
      }
      if (method === "DELETE") {
        return (await repository.deleteCriteria(criteriaId))
          ? new Response(null, { status: 204 })
          : error(404, "Criteria not found");
      }
    }

    if (url.pathname === "/api/push/public-key" && method === "GET") {
      if (!env.VAPID_PUBLIC_KEY) return error(503, "VAPID public key is not configured");
      return json({ publicKey: env.VAPID_PUBLIC_KEY });
    }
    if (url.pathname === "/api/push/subscriptions" && method === "POST") {
      const value = await body(request);
      const keys = value.keys;
      if (!keys || typeof keys !== "object" || Array.isArray(keys))
        throw new ApiError(400, "keys is required");
      const keyValues = keys as Record<string, unknown>;
      const endpoint = text(value.endpoint, "endpoint");
      const existing = (await repository.listPushSubscriptions()).find(
        (item) => item.endpoint === endpoint,
      );
      const subscription: PushSubscription = {
        id: existing?.id ?? crypto.randomUUID(),
        endpoint,
        p256dh: text(keyValues.p256dh, "keys.p256dh"),
        auth: text(keyValues.auth, "keys.auth"),
        expirationTime: (() => {
          if (value.expirationTime === null) return null;
          if (typeof value.expirationTime === "number" && Number.isFinite(value.expirationTime)) {
            return value.expirationTime;
          }
          throw new ApiError(400, "expirationTime must be a number or null");
        })(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        lastSuccessAt: existing?.lastSuccessAt ?? null,
        failureCount: 0,
        status: "active",
      };
      await repository.savePushSubscription(subscription);
      return json({ subscription }, { status: existing ? 200 : 201 });
    }
    if (url.pathname === "/api/push/subscriptions" && method === "DELETE") {
      const value = await body(request);
      let id = typeof value.id === "string" ? value.id : undefined;
      if (!id && typeof value.endpoint === "string") {
        id = (await repository.listPushSubscriptions()).find(
          (item) => item.endpoint === value.endpoint,
        )?.id;
      }
      if (!id) return error(404, "Push subscription not found");
      await repository.deletePushSubscription(id);
      return new Response(null, { status: 204 });
    }
    const subscriptionId = routeId(url.pathname, "push/subscriptions");
    if (subscriptionId && method === "DELETE") {
      await repository.deletePushSubscription(subscriptionId);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/poll" && method === "POST") {
      const lease = await acquireMaintenanceLease(env.DB, "cooldown:poll", new Date());
      if (!lease.acquired)
        return cooldownError("Manual poll is cooling down", lease.retryAfterSeconds);
      const result = await runPollCycle(
        {
          persistence: repository,
          adapters: adapters(),
          classifySnapshot: classifyWithCore,
          matchesCriteria: matchesPersistedJob,
        },
        "manual",
      );
      return json(result);
    }
    if (url.pathname === "/api/purge" && method === "POST") {
      const lease = await acquireMaintenanceLease(env.DB, "cooldown:purge", new Date());
      if (!lease.acquired)
        return cooldownError("Manual purge is cooling down", lease.retryAfterSeconds);
      const purged = await runRetentionSweep(repository);
      return json({ purged });
    }

    if (url.pathname.startsWith("/api/"))
      return method === "OPTIONS" ? new Response(null, { status: 204 }) : error(404, "Not found");
    return error(404, "Not found");
  } catch (cause) {
    if (cause instanceof ApiError) return error(cause.status, cause.message);
    console.error(
      JSON.stringify({
        event: "api_error",
        method,
        path: url.pathname,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    );
    return error(500, "Internal server error");
  }
}

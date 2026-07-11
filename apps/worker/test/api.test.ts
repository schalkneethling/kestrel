/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { companyFixture, criteriaFixture, jobFixture, roleFixture } from "./fixtures/persistence";

const origin = "https://kestrel.test";
const authorization = { authorization: "Bearer test-bearer-secret" };

function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", authorization.authorization);
  if (init.body) headers.set("content-type", "application/json");
  return SELF.fetch(`${origin}${path}`, { ...init, headers });
}

const json = (value: unknown) => JSON.stringify(value);

async function seedCompany() {
  await env.DB.prepare(
    `INSERT INTO companies
      (id, name, ats_type, board_token, careers_url, status, unsupported_platform, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      companyFixture.id,
      companyFixture.name,
      companyFixture.atsType,
      companyFixture.boardToken,
      companyFixture.careersUrl,
      companyFixture.status,
      companyFixture.unsupportedPlatform,
      companyFixture.notes,
      "2026-07-11T08:00:00.000Z",
      "2026-07-11T08:00:00.000Z",
    )
    .run();
}

async function seedJob() {
  await seedCompany();
  await env.DB.prepare(
    `INSERT INTO role_ledger
      (stable_key, company_id, title, first_seen_at, last_seen_at, last_source_key, repost_count, applied_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      roleFixture.stableKey,
      roleFixture.companyId,
      roleFixture.title,
      roleFixture.firstSeenAt,
      roleFixture.lastSeenAt,
      roleFixture.lastSourceKey,
      roleFixture.repostCount,
      roleFixture.appliedAt,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO jobs
      (id, company_id, source_key, stable_key, ats_job_id, title, location_raw, remote_scope,
       regions_json, department, employment_type, absolute_url, description_snippet,
       first_seen_at, last_seen_at, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      jobFixture.id,
      jobFixture.companyId,
      jobFixture.sourceKey,
      jobFixture.stableKey,
      jobFixture.atsJobId,
      jobFixture.title,
      jobFixture.locationRaw,
      jobFixture.remoteScope,
      JSON.stringify(jobFixture.regions),
      jobFixture.department,
      jobFixture.employmentType,
      jobFixture.absoluteUrl,
      jobFixture.descriptionSnippet,
      jobFixture.firstSeenAt,
      jobFixture.lastSeenAt,
      jobFixture.removedAt,
    )
    .run();
}

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.exec(
    "DELETE FROM notifications; DELETE FROM jobs; DELETE FROM role_ledger; DELETE FROM criteria; DELETE FROM push_subscriptions; DELETE FROM poll_runs; DELETE FROM companies; DELETE FROM worker_health_checks;",
  );
});

describe("API bearer guard", () => {
  it.each([
    ["missing", undefined],
    ["malformed", "Basic test-bearer-secret"],
    ["incorrect", "Bearer wrong-secret"],
  ])("rejects %s authorization for protected routes", async (_label, value) => {
    const headers = value ? { authorization: value } : undefined;
    const response = await SELF.fetch(`${origin}/api/companies`, { headers });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});

describe("company API", () => {
  it("creates, lists, updates, and deletes a company", async () => {
    const create = await api("/api/companies", {
      method: "POST",
      body: json(companyFixture),
    });
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toEqual({ company: companyFixture });

    const list = await api("/api/companies");
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({ companies: [companyFixture] });

    const update = await api(`/api/companies/${companyFixture.id}`, {
      method: "PATCH",
      body: json({ status: "paused", notes: "Hiring paused" }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toEqual({
      company: { ...companyFixture, status: "paused", notes: "Hiring paused" },
    });

    expect((await api(`/api/companies/${companyFixture.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    await expect(api("/api/companies").then((response) => response.json())).resolves.toEqual({
      companies: [],
    });
  });

  it("returns a conflict when durable role history prevents deletion", async () => {
    await seedJob();

    const response = await api(`/api/companies/${companyFixture.id}`, { method: "DELETE" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Company has durable role history and cannot be deleted",
    });
  });
});

describe("jobs API", () => {
  it("filters jobs and persists applied state on the durable role", async () => {
    await seedJob();

    const list = await api(`/api/jobs?companyId=${companyFixture.id}&status=active`);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({
      jobs: [expect.objectContaining({ ...jobFixture, appliedAt: null })],
    });

    const applied = await api(`/api/jobs/${encodeURIComponent(roleFixture.stableKey)}/applied`, {
      method: "PATCH",
      body: json({ applied: true }),
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toEqual(
      expect.objectContaining({ stableKey: roleFixture.stableKey, appliedAt: expect.any(String) }),
    );

    const row = await env.DB.prepare("SELECT applied_at FROM role_ledger WHERE stable_key = ?")
      .bind(roleFixture.stableKey)
      .first<{ applied_at: string | null }>();
    expect(row?.applied_at).toEqual(expect.any(String));
  });
});

describe("criteria API", () => {
  it("creates, lists, replaces, and deletes criteria", async () => {
    const create = await api("/api/criteria", { method: "POST", body: json(criteriaFixture) });
    expect(create.status).toBe(201);
    await expect(create.json()).resolves.toEqual({ criteria: criteriaFixture });
    await expect(api("/api/criteria").then((response) => response.json())).resolves.toEqual({
      criteria: [criteriaFixture],
    });

    const replacement = { ...criteriaFixture, enabled: false, regions: ["za"] };
    const replace = await api(`/api/criteria/${criteriaFixture.id}`, {
      method: "PUT",
      body: json(replacement),
    });
    expect(replace.status).toBe(200);
    await expect(replace.json()).resolves.toEqual({ criteria: replacement });

    expect((await api(`/api/criteria/${criteriaFixture.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    await expect(api("/api/criteria").then((response) => response.json())).resolves.toEqual({
      criteria: [],
    });
  });
});

describe("push API", () => {
  it("returns the public key and registers then removes a subscription", async () => {
    const key = await api("/api/push/public-key");
    expect(key.status).toBe(200);
    await expect(key.json()).resolves.toEqual({ publicKey: "test-vapid-public-key" });

    const subscription = {
      endpoint: "https://push.example/subscription-new",
      expirationTime: null,
      keys: { p256dh: "p256dh", auth: "auth" },
    };
    const create = await api("/api/push/subscriptions", {
      method: "POST",
      body: json(subscription),
    });
    expect(create.status).toBe(201);
    expect(await env.DB.prepare("SELECT endpoint FROM push_subscriptions").first()).toEqual({
      endpoint: subscription.endpoint,
    });

    const remove = await api("/api/push/subscriptions", {
      method: "DELETE",
      body: json({ endpoint: subscription.endpoint }),
    });
    expect(remove.status).toBe(204);
    expect(await env.DB.prepare("SELECT endpoint FROM push_subscriptions").first()).toBeNull();
  });

  it.each(["", "123", true, {}, undefined])(
    "rejects invalid expirationTime %s before coercion",
    async (expirationTime) => {
      const response = await api("/api/push/subscriptions", {
        method: "POST",
        body: json({
          endpoint: "https://push.example/invalid-expiration",
          expirationTime,
          keys: { p256dh: "p256dh", auth: "auth" },
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "expirationTime must be a number or null",
      });
    },
  );
});

describe("manual maintenance API", () => {
  it.each(["poll", "purge"])(
    "rate-limits repeated %s requests with retry metadata",
    async (route) => {
      const responses = await Promise.all([
        api(`/api/${route}`, { method: "POST" }),
        api(`/api/${route}`, { method: "POST" }),
      ]);
      expect(responses.map(({ status }) => status).sort((left, right) => left - right)).toEqual([
        200, 429,
      ]);

      const repeated = responses.find(({ status }) => status === 429);
      expect(repeated).toBeDefined();
      if (!repeated) throw new Error("Expected one cooldown response");
      expect(repeated.status).toBe(429);
      expect(await repeated.json()).toEqual({
        error: `Manual ${route} is cooling down`,
        retryAfterSeconds: expect.any(Number),
      });
      expect(Number(repeated.headers.get("retry-after"))).toBeGreaterThan(0);
    },
  );
});

describe("API errors", () => {
  it("returns validation errors for malformed JSON and invalid resources", async () => {
    const malformed = await api("/api/companies", { method: "POST", body: "{" });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: expect.any(String) });

    const invalid = await api("/api/criteria", {
      method: "POST",
      body: json({ ...criteriaFixture, titleIncludes: "engineer" }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: expect.any(String) });
  });

  it("returns not found for unknown resources and routes", async () => {
    for (const [path, init, error] of [
      [
        "/api/companies/missing",
        { method: "PATCH", body: json({ status: "paused" }) },
        "Company not found",
      ],
      [
        "/api/jobs/missing/applied",
        { method: "PATCH", body: json({ applied: true }) },
        "Job role not found",
      ],
      ["/api/criteria/missing", { method: "DELETE" }, "Criteria not found"],
      ["/api/unknown", {}, "Not found"],
    ] as const) {
      const response = await api(path, init);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error });
    }
  });
});

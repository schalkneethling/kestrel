import { expect, test, type Page, type Route } from "@playwright/test";

const company = {
  id: "company-acme",
  name: "Acme",
  atsType: "greenhouse",
  boardToken: "acme",
  careersUrl: "https://example.com/careers",
  status: "active",
  unsupportedPlatform: null,
  notes: null,
};

const unsupportedCompany = {
  id: "company-orbit",
  name: "Orbit",
  atsType: "unsupported",
  boardToken: "",
  careersUrl: "https://example.com/orbit-careers",
  status: "active",
  unsupportedPlatform: "workday",
  notes: "Watch manually",
};

const stableKey =
  "v1|company=company-acme|title=engineer|location=remote%3Aus|department=~|employment=full%20time";

const jobs = [
  {
    id: "job-123",
    companyId: company.id,
    sourceKey: "company-acme:greenhouse:123",
    stableKey,
    atsJobId: "123",
    title: "Frontend Engineer",
    locationRaw: "Remote - US",
    remoteScope: "remote",
    regions: ["us"],
    department: "Engineering",
    employmentType: "Full Time",
    absoluteUrl: "https://example.com/jobs/123",
    descriptionSnippet: "Build accessible interfaces.",
    firstSeenAt: "2026-07-11T08:00:00.000Z",
    lastSeenAt: "2026-07-11T08:00:00.000Z",
    removedAt: null,
    appliedAt: null,
  },
  {
    id: "job-456",
    companyId: company.id,
    sourceKey: "company-acme:greenhouse:456",
    stableKey: `${stableKey}-designer`,
    atsJobId: "456",
    title: "Product Designer",
    locationRaw: "London",
    remoteScope: "onsite",
    regions: ["uk"],
    department: "Design",
    employmentType: "Full Time",
    absoluteUrl: "https://example.com/jobs/456",
    descriptionSnippet: null,
    firstSeenAt: "2026-07-10T08:00:00.000Z",
    lastSeenAt: "2026-07-10T08:00:00.000Z",
    removedAt: "2026-07-11T07:00:00.000Z",
    appliedAt: null,
  },
];

const criteria = {
  id: "criteria-default",
  name: "Default",
  enabled: true,
  titleIncludes: ["engineer"],
  titleExcludes: ["manager"],
  locationHardExcludes: ["antarctica"],
  regions: ["us", "za"],
};

type MockState = {
  acceptsToken: boolean;
  companies: Array<Record<string, unknown>>;
  criteria: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  requests: Array<{ method: string; path: string; authorization: string | null; body: unknown }>;
};

async function json(route: Route, status: number, body?: unknown, headers = {}) {
  await route.fulfill({
    status,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? "" : JSON.stringify(body),
  });
}

async function mockApi(page: Page) {
  const state: MockState = {
    acceptsToken: true,
    companies: [company, unsupportedCompany],
    criteria: [criteria],
    jobs: jobs.map((job) => ({ ...job })),
    requests: [],
  };
  const cooldowns = new Set<string>();

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.() ?? null;
    state.requests.push({
      method,
      path: `${url.pathname}${url.search}`,
      authorization: request.headers().authorization ?? null,
      body,
    });

    if (!state.acceptsToken || request.headers().authorization !== "Bearer browser-test-token") {
      return json(route, 401, { error: "Unauthorized" });
    }
    if (url.pathname === "/api/companies" && method === "GET") {
      return json(route, 200, { companies: state.companies });
    }
    if (url.pathname === "/api/companies" && method === "POST") {
      const created = { ...(body as object), id: "company-new" };
      state.companies.push(created);
      return json(route, 201, { company: created });
    }
    if (url.pathname.startsWith("/api/companies/") && method === "PATCH") {
      const id = url.pathname.split("/").at(-1);
      const index = state.companies.findIndex((item) => item.id === id);
      state.companies[index] = { ...state.companies[index], ...(body as object) };
      return json(route, 200, { company: state.companies[index] });
    }
    if (url.pathname === "/api/jobs" && method === "GET") {
      let result = state.jobs;
      const status = url.searchParams.get("status");
      const companyId = url.searchParams.get("companyId");
      const applied = url.searchParams.get("applied");
      if (status === "active") result = result.filter((job) => job.removedAt === null);
      if (status === "removed") result = result.filter((job) => job.removedAt !== null);
      if (companyId) result = result.filter((job) => job.companyId === companyId);
      if (applied === "true") result = result.filter((job) => job.appliedAt !== null);
      return json(route, 200, { jobs: result });
    }
    if (url.pathname.endsWith("/applied") && method === "PATCH") {
      const key = decodeURIComponent(url.pathname.slice("/api/jobs/".length, -"/applied".length));
      const job = state.jobs.find((item) => item.stableKey === key)!;
      job.appliedAt = (body as { applied: boolean }).applied ? "2026-07-11T09:00:00.000Z" : null;
      return json(route, 200, { stableKey: key, appliedAt: job.appliedAt });
    }
    if (url.pathname === "/api/criteria" && method === "GET") {
      return json(route, 200, { criteria: state.criteria });
    }
    if (url.pathname.startsWith("/api/criteria/") && method === "PUT") {
      state.criteria[0] = body as Record<string, unknown>;
      return json(route, 200, { criteria: state.criteria[0] });
    }
    if (url.pathname === "/api/push/public-key") {
      return json(route, 200, { publicKey: "BEl6-test-public-key" });
    }
    if (url.pathname === "/api/push/subscriptions" && method === "POST") {
      return json(route, 201, { subscription: body });
    }
    if (["/api/poll", "/api/purge"].includes(url.pathname) && method === "POST") {
      if (cooldowns.has(url.pathname)) {
        return json(
          route,
          429,
          { error: `Manual ${url.pathname.slice(5)} is cooling down`, retryAfterSeconds: 60 },
          { "retry-after": "60" },
        );
      }
      cooldowns.add(url.pathname);
      return json(route, 200, { ok: true });
    }
    return json(route, 404, { error: "Not found" });
  });

  return state;
}

async function unlock(page: Page) {
  await page.goto("/");
  await page.getByLabel(/api token/i).fill("browser-test-token");
  await page.getByRole("button", { name: /save|connect/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("Kestrel dashboard acceptance", () => {
  test("retries a previously rejected saved token", async ({ page }) => {
    const state = await mockApi(page);
    state.acceptsToken = false;
    await page.addInitScript(() => localStorage.setItem("kestrel-api-token", "browser-test-token"));
    await page.goto("/");

    await expect(page.getByRole("alert")).toContainText(/saved token could not connect/i);
    state.acceptsToken = true;
    await page.getByRole("button", { name: /connect/i }).click();

    await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible();
  });

  test("stores the API token locally and sends it as a bearer credential", async ({ page }) => {
    const state = await mockApi(page);
    await unlock(page);

    await expect.poll(() => state.requests.length).toBeGreaterThan(0);
    expect(
      state.requests.every(({ authorization }) => authorization === "Bearer browser-test-token"),
    ).toBe(true);
    await expect
      .poll(() => page.evaluate(() => Object.values(localStorage).includes("browser-test-token")))
      .toBe(true);
  });

  test("has a semantic application shell with navigation for every dashboard view", async ({
    page,
  }) => {
    await mockApi(page);
    await unlock(page);

    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: /primary/i })).toMatchAriaSnapshot(`
      - navigation "Primary":
        - link "Companies"
        - link /Jobs/
        - link "Criteria"
        - link "Notifications"
    `);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("lists supported and unsupported companies and adds a supported company", async ({
    page,
  }) => {
    await mockApi(page);
    await unlock(page);
    await page.getByRole("link", { name: "Companies" }).click();

    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
    await expect(page.getByText("Acme", { exact: true })).toBeVisible();
    await expect(page.getByText("greenhouse", { exact: true })).toBeVisible();
    await expect(page.getByText("Orbit", { exact: true })).toBeVisible();
    await expect(page.getByText(/unsupported.*workday|workday.*unsupported/i)).toBeVisible();

    await page.getByRole("button", { name: /add company/i }).click();
    await page.getByLabel(/company name/i).fill("Example Labs");
    await page.getByLabel(/ats platform/i).selectOption("lever");
    await page.getByLabel(/board token/i).fill("example-labs");
    await page.getByLabel(/careers url/i).fill("https://example.com/jobs");
    await page.getByRole("button", { name: /save company/i }).click();
    await expect(page.getByText("Example Labs", { exact: true })).toBeVisible();
  });

  test("filters the jobs feed and persists applied state", async ({ page }) => {
    const state = await mockApi(page);
    await unlock(page);
    await page.getByRole("link", { name: "Jobs" }).click();

    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toHaveAttribute(
      "href",
      "https://example.com/jobs/123",
    );
    await expect(page.getByText("Product Designer", { exact: true })).toBeVisible();
    await page.getByLabel(/status/i).selectOption("active");
    await expect(page.getByText("Product Designer", { exact: true })).toBeHidden();

    const job = page.getByRole("article").filter({ hasText: "Frontend Engineer" });
    await job.getByRole("checkbox", { name: /applied/i }).check();
    await expect.poll(() => state.jobs[0]!.appliedAt).not.toBeNull();
    await page.getByRole("combobox", { name: "Applied" }).selectOption("true");
    await expect(page.getByText("Frontend Engineer", { exact: true })).toBeVisible();
  });

  test("edits and saves matching criteria", async ({ page }) => {
    const state = await mockApi(page);
    await unlock(page);
    await page.getByRole("link", { name: "Criteria" }).click();

    await expect(page.getByRole("heading", { name: "Criteria" })).toBeVisible();
    const includes = page.getByLabel(/title includes/i);
    await expect(includes).toHaveValue(/engineer/i);
    await includes.fill("engineer, developer");
    await page.getByLabel(/regions/i).fill("us, za, uk");
    await page.getByRole("button", { name: /save criteria/i }).click();

    await expect(page.getByRole("status")).toContainText(/saved/i);
    await expect.poll(() => state.criteria[0]!.titleIncludes).toEqual(["engineer", "developer"]);
    await expect.poll(() => state.criteria[0]!.regions).toEqual(["us", "za", "uk"]);
  });

  test("enables browser notifications and registers the push subscription", async ({
    page,
    context,
  }) => {
    const state = await mockApi(page);
    await context.grantPermissions(["notifications"], { origin: "http://127.0.0.1:5173" });
    await page.addInitScript(() => {
      const subscription = {
        endpoint: "https://push.example/browser",
        expirationTime: null,
        toJSON: () => ({
          endpoint: "https://push.example/browser",
          expirationTime: null,
          keys: { p256dh: "browser-p256dh", auth: "browser-auth" },
        }),
      };
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          register: async () => ({ pushManager: { subscribe: async () => subscription } }),
          ready: Promise.resolve({ pushManager: { subscribe: async () => subscription } }),
        },
      });
    });
    await unlock(page);
    await page.getByRole("link", { name: /notifications/i }).click();
    await page.getByRole("button", { name: /enable notifications/i }).click();

    await expect(page.getByRole("status")).toContainText(/enabled/i);
    await expect
      .poll(
        () => state.requests.find((request) => request.path === "/api/push/subscriptions")?.body,
      )
      .toEqual({
        endpoint: "https://push.example/browser",
        expirationTime: null,
        keys: { p256dh: "browser-p256dh", auth: "browser-auth" },
      });
  });

  test("refresh and purge actions surface cooldown feedback", async ({ page }) => {
    await mockApi(page);
    await unlock(page);

    const refresh = page.getByRole("button", { name: /refresh jobs/i });
    await refresh.click();
    await expect(page.getByRole("status")).toContainText(/refresh|poll.*complete/i);
    await refresh.click();
    await expect(page.getByRole("alert")).toContainText(/cooling down|try again.*60/i);

    const purge = page.getByRole("button", { name: /purge removed jobs/i });
    await purge.click();
    await expect(page.getByRole("status")).toContainText(/purge.*complete|removed jobs.*purged/i);
    await purge.click();
    await expect(page.getByRole("alert")).toContainText(/cooling down|try again.*60/i);
  });
});

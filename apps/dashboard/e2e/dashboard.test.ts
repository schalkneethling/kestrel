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
    notInterestedAt: null,
    matchedCriteriaIds: ["criteria-default"],
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
    notInterestedAt: null,
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
  jobsStatus: number;
  criteriaMutationStatus: number;
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
    jobsStatus: 200,
    criteriaMutationStatus: 200,
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
      const input = body as Record<string, unknown>;
      const duplicate = state.companies.some(
        (item) => item.atsType === input.atsType && item.boardToken === input.boardToken,
      );
      if (duplicate) {
        return json(route, 409, {
          error: "A company with this ATS platform and board token already exists",
        });
      }
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
      if (state.jobsStatus !== 200) {
        return json(route, state.jobsStatus, { error: "Internal server error" });
      }
      let result = state.jobs;
      if (url.searchParams.get("scope") !== "all") {
        result = result.filter((job) =>
          state.criteria.some(
            (item) =>
              item.enabled &&
              (item.titleIncludes as string[]).some((term) =>
                String(job.title).toLowerCase().includes(term),
              ),
          ),
        );
      }
      const status = url.searchParams.get("status");
      const companyId = url.searchParams.get("companyId");
      const applied = url.searchParams.get("applied");
      const interest = url.searchParams.get("interest") ?? "current";
      if (status === "active") result = result.filter((job) => job.removedAt === null);
      if (status === "removed") result = result.filter((job) => job.removedAt !== null);
      if (companyId) result = result.filter((job) => job.companyId === companyId);
      if (applied === "true") result = result.filter((job) => job.appliedAt !== null);
      if (interest === "current") {
        result = result.filter((job) => job.notInterestedAt === null);
      }
      if (interest === "dismissed") {
        result = result.filter((job) => job.notInterestedAt !== null);
      }
      return json(route, 200, { jobs: result });
    }
    if (url.pathname.endsWith("/applied") && method === "PATCH") {
      const key = decodeURIComponent(url.pathname.slice("/api/jobs/".length, -"/applied".length));
      const matchingJobs = state.jobs.filter((item) => item.stableKey === key);
      for (const job of matchingJobs) {
        job.appliedAt = (body as { applied: boolean }).applied ? "2026-07-11T09:00:00.000Z" : null;
        if (job.appliedAt) job.notInterestedAt = null;
      }
      return json(route, 200, {
        stableKey: key,
        appliedAt: matchingJobs[0]!.appliedAt,
        notInterestedAt: matchingJobs[0]!.notInterestedAt,
      });
    }
    if (url.pathname.endsWith("/not-interested") && method === "PATCH") {
      const key = decodeURIComponent(
        url.pathname.slice("/api/jobs/".length, -"/not-interested".length),
      );
      const matchingJobs = state.jobs.filter((item) => item.stableKey === key);
      for (const job of matchingJobs) {
        job.notInterestedAt = (body as { notInterested: boolean }).notInterested
          ? "2026-07-11T10:00:00.000Z"
          : null;
        if (job.notInterestedAt) job.appliedAt = null;
      }
      return json(route, 200, {
        stableKey: key,
        appliedAt: matchingJobs[0]!.appliedAt,
        notInterestedAt: matchingJobs[0]!.notInterestedAt,
      });
    }
    if (url.pathname === "/api/criteria" && method === "GET") {
      return json(route, 200, { criteria: state.criteria });
    }
    if (url.pathname === "/api/criteria" && method === "POST") {
      if (state.criteriaMutationStatus !== 200) {
        return json(route, state.criteriaMutationStatus, { error: "Could not save criteria" });
      }
      const created = { ...(body as object), id: `criteria-${state.criteria.length + 1}` };
      state.criteria.push(created);
      return json(route, 201, { criteria: created });
    }
    if (url.pathname.startsWith("/api/criteria/") && method === "PUT") {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      const index = state.criteria.findIndex((item) => item.id === id);
      state.criteria[index] = body as Record<string, unknown>;
      return json(route, 200, { criteria: state.criteria[index] });
    }
    if (url.pathname.startsWith("/api/criteria/") && method === "DELETE") {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      state.criteria = state.criteria.filter((item) => item.id !== id);
      return json(route, 204);
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

  test("keeps the dashboard connected when a job-view refresh fails", async ({ page }) => {
    const state = await mockApi(page);
    await unlock(page);
    state.jobsStatus = 500;
    await page.getByRole("radio", { name: "All jobs" }).check();

    await expect(page.getByRole("alert")).toContainText(/internal server error/i);
    await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
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

  test("keeps the company dialog open and explains duplicate ATS boards", async ({ page }) => {
    await mockApi(page);
    await unlock(page);
    await page.getByRole("link", { name: "Companies" }).click();
    await page.getByRole("button", { name: /add company/i }).click();
    await page.getByLabel(/company name/i).fill("Acme duplicate");
    await page.getByLabel(/ats platform/i).selectOption("greenhouse");
    await page.getByLabel(/board token/i).fill("acme");
    await page.getByLabel(/careers url/i).fill("https://example.com/duplicate");
    await page.getByRole("button", { name: /save company/i }).click();

    await expect(page.getByRole("alert")).toContainText(
      /company with this ATS platform and board token already exists/i,
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel(/company name/i)).toHaveValue("Acme duplicate");
  });

  test("filters the jobs feed and persists applied state", async ({ page }) => {
    const state = await mockApi(page);
    await unlock(page);
    await page.getByRole("link", { name: "Jobs" }).click();

    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toHaveAttribute(
      "href",
      "https://example.com/jobs/123",
    );
    await expect(page.getByText("Product Designer", { exact: true })).toBeHidden();
    await page.getByRole("radio", { name: "All jobs" }).check();
    await expect(page.getByText("Product Designer", { exact: true })).toBeVisible();
    await expect
      .poll(() => state.requests.some((request) => request.path === "/api/jobs?scope=all"))
      .toBe(true);
    await page.getByLabel(/status/i).selectOption("active");
    await expect(page.getByText("Product Designer", { exact: true })).toBeHidden();

    const job = page.getByRole("article").filter({ hasText: "Frontend Engineer" });
    await job.getByRole("checkbox", { name: /applied/i }).click();
    await expect.poll(() => state.jobs[0]!.appliedAt).not.toBeNull();
    await page.getByRole("combobox", { name: "Applied" }).selectOption("true");
    await expect(page.getByText("Frontend Engineer", { exact: true })).toBeVisible();
  });

  test("dismisses, revisits, and restores a role", async ({ page }) => {
    const state = await mockApi(page);
    await unlock(page);

    await page.getByRole("button", { name: "Not interested in Frontend Engineer" }).click();
    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toBeHidden();
    await expect(page.getByRole("combobox", { name: "Interest" })).toBeFocused();
    await expect.poll(() => state.jobs[0]!.notInterestedAt).not.toBeNull();

    await page.reload();
    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toBeHidden();
    await page.getByRole("combobox", { name: "Interest" }).selectOption("dismissed");
    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toBeVisible();
    await expect
      .poll(() =>
        state.requests.some((request) => request.path === "/api/jobs?scope=all&interest=dismissed"),
      )
      .toBe(true);

    await page.getByRole("button", { name: "Restore Frontend Engineer" }).click();
    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toBeHidden();
    await expect.poll(() => state.jobs[0]!.notInterestedAt).toBeNull();
    await page.getByRole("combobox", { name: "Interest" }).selectOption("current");
    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toBeVisible();
  });

  test("keeps applied and not-interested state mutually exclusive", async ({ page }) => {
    const state = await mockApi(page);
    state.jobs[0]!.appliedAt = "2026-07-11T09:00:00.000Z";
    await unlock(page);

    await page.getByRole("button", { name: "Not interested in Frontend Engineer" }).click();
    await expect.poll(() => state.jobs[0]!.notInterestedAt).not.toBeNull();
    expect(state.jobs[0]!.appliedAt).toBeNull();

    await page.getByRole("combobox", { name: "Interest" }).selectOption("dismissed");
    const job = page.getByRole("article").filter({ hasText: "Frontend Engineer" });
    await job.getByRole("checkbox", { name: /applied/i }).click();
    await expect(job).toBeHidden();
    await expect.poll(() => state.jobs[0]!.appliedAt).not.toBeNull();
    expect(state.jobs[0]!.notInterestedAt).toBeNull();
  });

  test("updates every visible posting for the same stable role", async ({ page }) => {
    const state = await mockApi(page);
    state.jobs.push({ ...state.jobs[0]!, id: "job-123-repost", sourceKey: "repost:123" });
    await unlock(page);

    await page.getByRole("button", { name: "Not interested in Frontend Engineer" }).first().click();

    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toHaveCount(0);
    expect(state.jobs.filter((job) => job.stableKey === stableKey)).toHaveLength(2);
    expect(
      state.jobs
        .filter((job) => job.stableKey === stableKey)
        .every((job) => job.notInterestedAt !== null),
    ).toBe(true);
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

  test("creates, disables, and deletes criteria sets", async ({ page }) => {
    const state = await mockApi(page);
    await unlock(page);
    await page.getByRole("link", { name: "Criteria" }).click();

    await page.getByRole("button", { name: /add criteria/i }).click();
    const newRule = page.getByRole("group", { name: /new rule set/i });
    await newRule.getByLabel("Name").fill("Design roles");
    await newRule.getByLabel(/title includes/i).fill("designer");
    const jobsRequestsBeforeCreate = state.requests.filter((request) =>
      request.path.startsWith("/api/jobs"),
    ).length;
    await newRule.getByRole("button", { name: /create criteria/i }).click();
    await expect.poll(() => state.criteria).toHaveLength(2);
    await expect
      .poll(() => state.requests.filter((request) => request.path.startsWith("/api/jobs")).length)
      .toBeGreaterThan(jobsRequestsBeforeCreate);

    const designRule = page.getByRole("group", { name: "Design roles" });
    await designRule.getByRole("checkbox", { name: /enabled/i }).uncheck();
    await designRule.getByRole("button", { name: /save criteria/i }).click();
    await expect.poll(() => state.criteria[1]!.enabled).toBe(false);

    await designRule.getByRole("button", { name: /delete/i }).click();
    await expect.poll(() => state.criteria).toHaveLength(1);
    await expect(page.getByRole("group", { name: "Design roles" })).toBeHidden();
  });

  test("guides an empty installation to create its first criteria set", async ({ page }) => {
    const state = await mockApi(page);
    state.criteria = [];
    await unlock(page);

    await expect(page.getByText(/no criteria are enabled/i)).toBeVisible();
    await page.getByRole("link", { name: /create or enable criteria/i }).click();
    await expect(page.getByRole("heading", { name: "Criteria" })).toBeVisible();
    await page.getByRole("button", { name: /add criteria/i }).click();
    await expect(page.getByRole("group", { name: /new rule set/i })).toBeVisible();
  });

  test("reports a criteria mutation failure and keeps the editor open", async ({ page }) => {
    const state = await mockApi(page);
    state.criteriaMutationStatus = 500;
    await unlock(page);
    await page.getByRole("link", { name: "Criteria" }).click();
    await page.getByRole("button", { name: /add criteria/i }).click();
    const newRule = page.getByRole("group", { name: /new rule set/i });
    await newRule.getByLabel("Name").fill("Design roles");
    await newRule.getByRole("button", { name: /create criteria/i }).click();

    await expect(page.getByRole("alert")).toContainText(/could not save criteria/i);
    await expect(newRule).toBeVisible();
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

  test("reloads jobs after a successful refresh", async ({ page }) => {
    const state = await mockApi(page);
    state.jobs = [];
    await unlock(page);
    await expect(page.getByText(/no roles match/i)).toBeVisible();

    state.jobs.push(...jobs);
    await page.getByRole("button", { name: /refresh jobs/i }).click();

    await expect(page.getByRole("link", { name: "Frontend Engineer" })).toBeVisible();
  });
});

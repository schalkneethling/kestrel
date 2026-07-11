import { describe, expect, it, vi } from "vite-plus/test";
import {
  AdapterHttpError,
  AdapterPayloadError,
  createAdapterRegistry,
  createAshbyAdapter,
  createGreenhouseAdapter,
  createLeverAdapter,
  normalizeJob,
  type Company,
  type HttpClient,
} from "../src/index";

const company = (atsType: Company["atsType"]): Company => ({
  id: "acme",
  name: "Acme",
  atsType,
  boardToken: "acme-board",
  careersUrl: "https://example.test",
  status: "active",
});

const response = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  status,
  headers,
  json: async () => body,
});

describe("ATS adapters", () => {
  it("registers all supported ATS types", () => {
    const http = vi.fn<HttpClient>();
    expect([...createAdapterRegistry(http).keys()]).toEqual(["greenhouse", "lever", "ashby"]);
  });

  it("parses a realistic Greenhouse response and forwards validators", async () => {
    const http = vi.fn<HttpClient>().mockResolvedValue(
      response(
        200,
        {
          jobs: [
            {
              id: 42,
              title: "Staff Engineer",
              absolute_url: "https://boards.greenhouse.io/acme/jobs/42",
              updated_at: "2026-07-10T09:00:00Z",
              location: { name: "Remote - US" },
              departments: [{ name: "Engineering" }],
              content: "<p>Build things</p>",
            },
          ],
        },
        { etag: '"v2"', "last-modified": "Thu, 10 Jul 2026 09:00:00 GMT" },
      ),
    );
    const result = await createGreenhouseAdapter(http).fetchJobs(company("greenhouse"), {
      etag: '"v1"',
      lastModified: "Wed, 9 Jul 2026 09:00:00 GMT",
    });
    expect(http).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://boards-api.greenhouse.io/v1/boards/acme-board/jobs?content=true",
        headers: { "If-None-Match": '"v1"', "If-Modified-Since": "Wed, 9 Jul 2026 09:00:00 GMT" },
      }),
    );
    expect(result).toMatchObject({
      status: "ok",
      etag: '"v2"',
      jobs: [
        {
          atsJobId: "42",
          title: "Staff Engineer",
          department: "Engineering",
          locationRaw: "Remote - US",
        },
      ],
    });
  });

  it("parses Lever and Ashby provider shapes", async () => {
    const leverHttp = vi.fn<HttpClient>().mockResolvedValue(
      response(200, [
        {
          id: "lev-1",
          text: "Frontend Engineer",
          hostedUrl: "https://jobs.lever.co/acme/lev-1",
          categories: {
            location: "Hybrid - London, UK",
            team: "Product Engineering",
            commitment: "Full-time",
          },
          descriptionPlain: "Build UI",
          updatedAt: 123,
        },
      ]),
    );
    const ashbyHttp = vi.fn<HttpClient>().mockResolvedValue(
      response(200, {
        jobs: [
          {
            id: "ash-1",
            title: "Designer",
            jobUrl: "https://jobs.ashbyhq.com/acme/ash-1",
            location: "Remote - EMEA",
            department: "Design",
            employmentType: "FullTime",
            descriptionPlain: "Design products",
            publishedAt: "2026-07-01T00:00:00Z",
          },
        ],
      }),
    );
    expect(await createLeverAdapter(leverHttp).fetchJobs(company("lever"))).toMatchObject({
      status: "ok",
      jobs: [{ atsJobId: "lev-1", employmentType: "Full-time" }],
    });
    expect(await createAshbyAdapter(ashbyHttp).fetchJobs(company("ashby"))).toMatchObject({
      status: "ok",
      jobs: [{ atsJobId: "ash-1", department: "Design" }],
    });
  });

  it("returns not-modified without jobs and throws useful HTTP errors", async () => {
    const unchanged = vi
      .fn<HttpClient>()
      .mockResolvedValue(response(304, null, { etag: '"same"' }));
    expect(
      await createLeverAdapter(unchanged).fetchJobs(company("lever"), { etag: '"same"' }),
    ).toEqual({ status: "not-modified", etag: '"same"', lastModified: undefined });
    const failed = vi.fn<HttpClient>().mockResolvedValue(response(429, { error: "rate limited" }));
    await expect(createAshbyAdapter(failed).fetchJobs(company("ashby"))).rejects.toEqual(
      expect.objectContaining({ name: "AdapterHttpError", status: 429, provider: "ashby" }),
    );
    expect(AdapterHttpError).toBeDefined();
  });

  it("identifies malformed payloads without treating them as an empty board", async () => {
    const malformed = vi.fn<HttpClient>().mockResolvedValue({
      status: 200,
      headers: {},
      json: async () => {
        throw new SyntaxError("invalid JSON");
      },
    });
    await expect(
      createGreenhouseAdapter(malformed).fetchJobs(company("greenhouse")),
    ).rejects.toBeInstanceOf(AdapterPayloadError);
  });

  it.each([
    ["greenhouse", createGreenhouseAdapter, { jobs: [] }, { jobs: [{}] }, { results: [] }],
    ["lever", createLeverAdapter, [], [{}], { postings: [] }],
    ["ashby", createAshbyAdapter, { jobs: [] }, { jobs: [{}] }, { results: [] }],
  ] as const)(
    "%s distinguishes an empty board from malformed top-level and job payloads",
    async (type, factory, emptyPayload, malformedJobPayload, malformedTopLevel) => {
      const empty = vi.fn<HttpClient>().mockResolvedValue(response(200, emptyPayload));
      await expect(factory(empty).fetchJobs(company(type))).resolves.toMatchObject({
        status: "ok",
        jobs: [],
      });

      for (const payload of [malformedTopLevel, malformedJobPayload]) {
        const invalid = vi.fn<HttpClient>().mockResolvedValue(response(200, payload));
        await expect(factory(invalid).fetchJobs(company(type))).rejects.toBeInstanceOf(
          AdapterPayloadError,
        );
      }
    },
  );

  it("reads response validators case-insensitively", async () => {
    const http = vi.fn<HttpClient>().mockResolvedValue(
      response(200, [], {
        ETag: '"lever-v2"',
        "Last-Modified": "Fri, 11 Jul 2026 08:00:00 GMT",
      }),
    );
    await expect(createLeverAdapter(http).fetchJobs(company("lever"))).resolves.toMatchObject({
      etag: '"lever-v2"',
      lastModified: "Fri, 11 Jul 2026 08:00:00 GMT",
    });
  });

  it("rejects using an adapter for a different company ATS type", async () => {
    const http = vi.fn<HttpClient>();
    await expect(createLeverAdapter(http).fetchJobs(company("greenhouse"))).rejects.toThrow(
      "lever adapter cannot fetch a greenhouse company",
    );
    expect(http).not.toHaveBeenCalled();
  });

  it("normalizes provider records into a provider-neutral job", () => {
    const normalized = normalizeJob(company("greenhouse"), {
      atsJobId: "42",
      title: "Staff Engineer",
      locationRaw: "Remote - US",
      department: "Engineering",
      employmentType: "Full Time",
      absoluteUrl: "https://example.test/42",
    });
    expect(normalized).toMatchObject({
      companyId: "acme",
      atsType: "greenhouse",
      sourceKey: "acme:greenhouse:42",
      location: { remoteScope: "remote", regions: ["us"] },
    });
    expect(normalized.stableKey).toContain("v1|company=acme|");
  });
});

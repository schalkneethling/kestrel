import type { Company, RawJob, SupportedAtsType } from "./domain";

export type ConditionalRequest = { etag?: string; lastModified?: string };
export type HttpResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  json(): Promise<unknown>;
};
export type HttpClient = (request: {
  url: string;
  headers: Record<string, string>;
}) => Promise<HttpResponse>;
export type AdapterResult =
  | { status: "ok"; jobs: RawJob[]; etag?: string; lastModified?: string }
  | { status: "not-modified"; etag?: string; lastModified?: string };

export interface AtsAdapter {
  readonly type: SupportedAtsType;
  fetchJobs(company: Company, conditional?: ConditionalRequest): Promise<AdapterResult>;
}

export class AdapterHttpError extends Error {
  override readonly name = "AdapterHttpError";
  readonly provider: SupportedAtsType;
  readonly status: number;

  constructor(provider: SupportedAtsType, status: number) {
    super(`${provider} returned HTTP ${status}`);
    this.provider = provider;
    this.status = status;
  }
}

export class AdapterPayloadError extends Error {
  override readonly name = "AdapterPayloadError";
  readonly provider: SupportedAtsType;
  override readonly cause: unknown;

  constructor(provider: SupportedAtsType, cause: unknown) {
    super(`${provider} returned an invalid response payload`);
    this.provider = provider;
    this.cause = cause;
  }
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const identifier = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const records = (value: unknown) => (Array.isArray(value) ? value.map(record) : []);
const snippet = (value: unknown) =>
  text(value)
    ?.replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

function validators(headers: Record<string, string | undefined>) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { etag: normalized.etag, lastModified: normalized["last-modified"] };
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function conditionalHeaders(value?: ConditionalRequest) {
  const headers: Record<string, string> = {};
  if (value?.etag) headers["If-None-Match"] = value.etag;
  if (value?.lastModified) headers["If-Modified-Since"] = value.lastModified;
  return headers;
}

function adapter(
  type: SupportedAtsType,
  endpoint: (token: string) => string,
  parse: (body: unknown) => RawJob[],
  http: HttpClient,
): AtsAdapter {
  return {
    type,
    async fetchJobs(company, conditional) {
      if (company.atsType !== type)
        throw new TypeError(`${type} adapter cannot fetch a ${company.atsType} company`);
      if (!company.boardToken) throw new TypeError(`${type} requires a board token`);
      const response = await http({
        url: endpoint(encodeURIComponent(company.boardToken)),
        headers: conditionalHeaders(conditional),
      });
      const metadata = validators(response.headers);
      if (response.status === 304) return { status: "not-modified", ...metadata };
      if (response.status < 200 || response.status >= 300)
        throw new AdapterHttpError(type, response.status);
      try {
        return { status: "ok", jobs: parse(await response.json()), ...metadata };
      } catch (error) {
        throw new AdapterPayloadError(type, error);
      }
    },
  };
}

function parseGreenhouse(body: unknown) {
  const envelope = requireRecord(body, "Greenhouse response");
  return requireArray(envelope.jobs, "Greenhouse jobs").map((value): RawJob => {
    const job = requireRecord(value, "Greenhouse job");
    const atsJobId = identifier(job.id),
      title = text(job.title),
      absoluteUrl = text(job.absolute_url);
    if (!atsJobId || !title || !absoluteUrl)
      throw new TypeError("Greenhouse job requires id, title, and absolute_url");
    return {
      atsJobId,
      title,
      absoluteUrl,
      locationRaw: text(record(job.location).name) ?? "",
      department: text(records(job.departments)[0]?.name),
      descriptionSnippet: snippet(job.content),
      updatedAt: text(job.updated_at),
    };
  });
}

function parseLever(body: unknown) {
  return requireArray(body, "Lever response").map((value): RawJob => {
    const job = requireRecord(value, "Lever job");
    const atsJobId = identifier(job.id),
      title = text(job.text),
      absoluteUrl = text(job.hostedUrl),
      categories = record(job.categories);
    if (!atsJobId || !title || !absoluteUrl)
      throw new TypeError("Lever job requires id, text, and hostedUrl");
    const updatedAt =
      typeof job.updatedAt === "number"
        ? new Date(job.updatedAt).toISOString()
        : text(job.updatedAt);
    return {
      atsJobId,
      title,
      absoluteUrl,
      locationRaw: text(categories.location) ?? "",
      department: text(categories.team),
      employmentType: text(categories.commitment),
      descriptionSnippet: snippet(job.descriptionPlain ?? job.description),
      updatedAt,
    };
  });
}

function parseAshby(body: unknown) {
  const envelope = requireRecord(body, "Ashby response");
  return requireArray(envelope.jobs, "Ashby jobs").map((value): RawJob => {
    const job = requireRecord(value, "Ashby job");
    const atsJobId = identifier(job.id),
      title = text(job.title),
      absoluteUrl = text(job.jobUrl ?? job.applyUrl);
    if (!atsJobId || !title || !absoluteUrl)
      throw new TypeError("Ashby job requires id, title, and jobUrl or applyUrl");
    return {
      atsJobId,
      title,
      absoluteUrl,
      locationRaw: text(job.location) ?? "",
      department: text(job.department),
      employmentType: text(job.employmentType),
      descriptionSnippet: snippet(job.descriptionPlain ?? job.descriptionHtml),
      updatedAt: text(job.publishedAt ?? job.updatedAt),
    };
  });
}

export const createGreenhouseAdapter = (http: HttpClient) =>
  adapter(
    "greenhouse",
    (token) => `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
    parseGreenhouse,
    http,
  );
export const createLeverAdapter = (http: HttpClient) =>
  adapter(
    "lever",
    (token) => `https://api.lever.co/v0/postings/${token}?mode=json`,
    parseLever,
    http,
  );
export const createAshbyAdapter = (http: HttpClient) =>
  adapter(
    "ashby",
    (token) => `https://api.ashbyhq.com/posting-api/job-board/${token}`,
    parseAshby,
    http,
  );

export function createAdapterRegistry(http: HttpClient): ReadonlyMap<SupportedAtsType, AtsAdapter> {
  const adapters = [
    createGreenhouseAdapter(http),
    createLeverAdapter(http),
    createAshbyAdapter(http),
  ];
  return new Map(adapters.map((value) => [value.type, value]));
}

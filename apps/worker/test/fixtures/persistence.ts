import type {
  Company,
  Criteria,
  Notification,
  PersistedJob,
  PollRun,
  PushSubscription,
  RoleLedgerEntry,
} from "@kestrel/core";

export const companyFixture: Company = {
  id: "company-acme",
  name: "Acme",
  atsType: "greenhouse",
  boardToken: "acme",
  careersUrl: "https://example.com/careers",
  status: "active",
  unsupportedPlatform: null,
  notes: null,
};

export const roleFixture: RoleLedgerEntry = {
  stableKey:
    "v1|company=company-acme|title=engineer|location=remote%3Aus|department=~|employment=full%20time",
  companyId: companyFixture.id,
  title: "Engineer",
  firstSeenAt: "2026-07-11T08:00:00.000Z",
  lastSeenAt: "2026-07-11T08:00:00.000Z",
  lastSourceKey: "company-acme:greenhouse:123",
  repostCount: 0,
  appliedAt: null,
  notInterestedAt: null,
};

export const jobFixture: PersistedJob = {
  id: "job-123",
  companyId: companyFixture.id,
  sourceKey: roleFixture.lastSourceKey,
  stableKey: roleFixture.stableKey,
  atsJobId: "123",
  title: "Engineer",
  locationRaw: "Remote - US",
  remoteScope: "remote",
  regions: ["us"],
  department: null,
  employmentType: "Full Time",
  absoluteUrl: "https://example.com/jobs/123",
  descriptionSnippet: null,
  firstSeenAt: roleFixture.firstSeenAt,
  lastSeenAt: roleFixture.lastSeenAt,
  removedAt: null,
};

export const criteriaFixture: Criteria = {
  id: "criteria-default",
  name: "Default",
  enabled: true,
  titleIncludes: ["engineer"],
  titleExcludes: ["manager"],
  locationHardExcludes: ["antarctica"],
  regions: ["us", "za"],
};

export const subscriptionFixture: PushSubscription = {
  id: "subscription-1",
  endpoint: "https://push.example/subscription-1",
  p256dh: "p256dh",
  auth: "auth",
  expirationTime: null,
  createdAt: "2026-07-11T08:00:00.000Z",
  lastSuccessAt: null,
  failureCount: 0,
  status: "active",
};

export const notificationFixture: Notification = {
  id: "notification-1",
  jobId: jobFixture.id,
  stableKey: roleFixture.stableKey,
  eventType: "new",
  dedupeKey: "new:job-123",
  status: "pending",
  sentAt: null,
  error: null,
  createdAt: "2026-07-11T08:01:00.000Z",
};

export const pollRunFixture: PollRun = {
  id: "poll-1",
  trigger: "scheduled",
  startedAt: "2026-07-11T08:00:00.000Z",
  completedAt: null,
  status: "running",
  companiesAttempted: 0,
  companiesSucceeded: 0,
  jobsSeen: 0,
  jobsNew: 0,
  jobsReposted: 0,
  jobsRemoved: 0,
  error: null,
};

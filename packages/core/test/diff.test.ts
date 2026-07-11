import { describe, expect, it } from "vite-plus/test";

import type { NormalizedJob } from "../src/domain";
import { diffSnapshot } from "../src/diff";
import type { PersistedJob, RoleLedgerEntry } from "../src/persistence";

const observedAt = "2026-07-11T08:00:00.000Z";

function normalized(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    companyId: "acme",
    atsType: "greenhouse",
    atsJobId: "ats-1",
    sourceKey: "greenhouse:acme:ats-1",
    stableKey: "acme:software-engineer",
    title: "Software Engineer",
    locationRaw: "Remote",
    location: { remoteScope: "remote", regions: ["global"], rawLabel: "Remote" },
    absoluteUrl: "https://example.test/jobs/ats-1",
    ...overrides,
  };
}

function persisted(overrides: Partial<PersistedJob> = {}): PersistedJob {
  const job = normalized();
  return {
    id: "job-1",
    companyId: job.companyId,
    sourceKey: job.sourceKey,
    stableKey: job.stableKey,
    atsJobId: job.atsJobId,
    title: job.title,
    locationRaw: job.locationRaw,
    remoteScope: job.location.remoteScope,
    regions: job.location.regions,
    department: null,
    employmentType: null,
    absoluteUrl: job.absoluteUrl,
    descriptionSnippet: null,
    firstSeenAt: "2026-07-01T08:00:00.000Z",
    lastSeenAt: "2026-07-10T08:00:00.000Z",
    removedAt: null,
    ...overrides,
  };
}

function role(overrides: Partial<RoleLedgerEntry> = {}): RoleLedgerEntry {
  return {
    stableKey: "acme:software-engineer",
    companyId: "acme",
    title: "Software Engineer",
    firstSeenAt: "2026-07-01T08:00:00.000Z",
    lastSeenAt: "2026-07-10T08:00:00.000Z",
    lastSourceKey: "greenhouse:acme:ats-old",
    repostCount: 0,
    appliedAt: null,
    ...overrides,
  };
}

describe("diffSnapshot", () => {
  it("classifies a role absent from both jobs and ledger as new", () => {
    const result = diffSnapshot({
      current: [normalized()],
      persisted: [],
      ledger: [],
      successfulCompanyIds: ["acme"],
      observedAt,
    });

    expect(result.new).toHaveLength(1);
    expect(result.new[0]?.role).toMatchObject({
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      repostCount: 0,
      appliedAt: null,
    });
    expect(result.reposted).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("classifies the same active source as unchanged and refreshes ledger memory", () => {
    const result = diffSnapshot({
      current: [normalized()],
      persisted: [persisted()],
      ledger: [role({ lastSourceKey: normalized().sourceKey, appliedAt: observedAt })],
      successfulCompanyIds: ["acme"],
      observedAt,
    });

    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0]?.role).toMatchObject({
      lastSeenAt: observedAt,
      repostCount: 0,
      appliedAt: observedAt,
    });
    expect(result.new).toEqual([]);
    expect(result.reposted).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("classifies a new source for a known stable role as reposted", () => {
    const current = normalized({ atsJobId: "ats-2", sourceKey: "greenhouse:acme:ats-2" });
    const result = diffSnapshot({
      current: [current],
      persisted: [persisted({ removedAt: "2026-07-05T08:00:00.000Z" })],
      ledger: [role()],
      successfulCompanyIds: ["acme"],
      observedAt,
    });

    expect(result.reposted).toHaveLength(1);
    expect(result.reposted[0]?.role).toMatchObject({
      lastSourceKey: current.sourceKey,
      repostCount: 1,
    });
  });

  it("recognizes a repost after the removed job has been purged", () => {
    const current = normalized({ atsJobId: "ats-2", sourceKey: "greenhouse:acme:ats-2" });
    const result = diffSnapshot({
      current: [current],
      persisted: [],
      ledger: [role({ appliedAt: "2026-07-03T08:00:00.000Z" })],
      successfulCompanyIds: ["acme"],
      observedAt,
    });

    expect(result.reposted).toHaveLength(1);
    expect(result.reposted[0]?.role).toMatchObject({
      repostCount: 1,
      appliedAt: "2026-07-03T08:00:00.000Z",
    });
  });

  it("treats a previously removed source returning as a repost", () => {
    const result = diffSnapshot({
      current: [normalized()],
      persisted: [persisted({ removedAt: "2026-07-05T08:00:00.000Z" })],
      ledger: [role({ lastSourceKey: normalized().sourceKey })],
      successfulCompanyIds: ["acme"],
      observedAt,
    });

    expect(result.reposted).toHaveLength(1);
    expect(result.reposted[0]?.role.repostCount).toBe(1);
  });

  it("removes active jobs missing from a successful company snapshot", () => {
    const result = diffSnapshot({
      current: [],
      persisted: [persisted()],
      ledger: [role()],
      successfulCompanyIds: ["acme"],
      observedAt,
    });

    expect(result.removed).toEqual([{ job: persisted(), removedAt: observedAt }]);
  });

  it("never removes jobs for a failed company", () => {
    const result = diffSnapshot({
      current: [],
      persisted: [persisted()],
      ledger: [role()],
      successfulCompanyIds: [],
      observedAt,
    });

    expect(result.removed).toEqual([]);
  });

  it("isolates removal detection per company in a partial poll", () => {
    const beta = persisted({
      id: "job-2",
      companyId: "beta",
      sourceKey: "greenhouse:beta:ats-2",
      stableKey: "beta:designer",
    });
    const result = diffSnapshot({
      current: [],
      persisted: [persisted(), beta],
      ledger: [],
      successfulCompanyIds: ["acme"],
      observedAt,
    });

    expect(result.removed.map(({ job }) => job.id)).toEqual(["job-1"]);
  });

  it("does not report an already removed job as removed again", () => {
    const result = diffSnapshot({
      current: [],
      persisted: [persisted({ removedAt: observedAt })],
      ledger: [],
      successfulCompanyIds: ["acme"],
      observedAt,
    });

    expect(result.removed).toEqual([]);
  });

  it("rejects duplicate current source keys because a snapshot is a set", () => {
    expect(() =>
      diffSnapshot({
        current: [normalized(), normalized()],
        persisted: [],
        ledger: [],
        successfulCompanyIds: ["acme"],
        observedAt,
      }),
    ).toThrow(/duplicate current sourceKey/);
  });
});

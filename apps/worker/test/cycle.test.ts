import type {
  AtsAdapter,
  Criteria,
  Notification,
  PersistedJob,
  PersistencePort,
  PollRun,
  RoleLedgerEntry,
} from "@kestrel/core";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  classifyWithCore,
  runPollCycle,
  runRetentionSweep,
  type SnapshotClassification,
} from "../src/cycle";
import { companyFixture, criteriaFixture, jobFixture, roleFixture } from "./fixtures/persistence";

function persistence(overrides: Partial<PersistencePort> = {}) {
  const pollRuns: PollRun[] = [];
  const jobs: PersistedJob[] = [];
  const notifications: Notification[] = [];
  const port: PersistencePort = {
    listCompanies: async () => [companyFixture],
    saveCompany: async () => undefined,
    listJobs: async () => [jobFixture],
    saveJob: async (job) => void jobs.push(job),
    findRole: async () => null,
    saveRole: async () => undefined,
    listCriteria: async () => [criteriaFixture],
    saveCriteria: async (_criteria: Criteria) => undefined,
    listPushSubscriptions: async () => [],
    savePushSubscription: async () => undefined,
    deletePushSubscription: async () => undefined,
    listNotifications: async () => [],
    saveNotification: async (notification) => void notifications.push(notification),
    findPollRun: async () => null,
    savePollRun: async (run) => void pollRuns.push(run),
    recordObservation: async (_role: RoleLedgerEntry, job) => void jobs.push(job),
    purgeRemovedJobs: async () => 0,
    ...overrides,
  };
  return { port, pollRuns, jobs, notifications };
}

const dates = () => new Date("2026-07-11T12:00:00.000Z");

describe("retention sweep", () => {
  it("purges removed jobs older than three days through the persistence port", async () => {
    const purgeRemovedJobs = vi.fn(async () => 2);
    const { port } = persistence({ purgeRemovedJobs });

    await expect(runRetentionSweep(port, dates())).resolves.toBe(2);
    expect(purgeRemovedJobs).toHaveBeenCalledWith("2026-07-08T12:00:00.000Z");
  });
});

describe("poll cycle", () => {
  it("never classifies removals when an adapter fails transiently", async () => {
    const classifySnapshot = vi.fn<() => SnapshotClassification>();
    const saveJob = vi.fn(async () => undefined);
    const purgeRemovedJobs = vi.fn(async () => 1);
    const { port, pollRuns } = persistence({ saveJob, purgeRemovedJobs });
    const adapter: AtsAdapter = {
      type: "greenhouse",
      fetchJobs: async () => {
        throw new Error("temporary outage");
      },
    };

    const result = await runPollCycle({
      persistence: port,
      adapters: new Map([["greenhouse", adapter]]),
      classifySnapshot,
      matchesCriteria: () => true,
      now: dates,
      createId: () => "poll-1",
    });

    expect(classifySnapshot).not.toHaveBeenCalled();
    expect(saveJob).not.toHaveBeenCalled();
    expect(purgeRemovedJobs).toHaveBeenCalledOnce();
    expect(result).toEqual({ runId: "poll-1", status: "failed", retentionPurged: 1 });
    expect(pollRuns.at(-1)).toMatchObject({
      status: "failed",
      companiesAttempted: 1,
      companiesSucceeded: 0,
      jobsRemoved: 0,
      error: "Acme: temporary outage",
    });
  });

  it("persists a successful snapshot, matched notification, removals, and counters", async () => {
    const removed = { ...jobFixture, id: "old-job", sourceKey: "old", removedAt: null };
    const observed = { ...jobFixture, id: "new-job", sourceKey: "company-acme:greenhouse:456" };
    const { port, pollRuns, jobs, notifications } = persistence();
    const adapter: AtsAdapter = {
      type: "greenhouse",
      fetchJobs: async () => ({
        status: "ok",
        jobs: [
          {
            atsJobId: "456",
            title: "Engineer",
            locationRaw: "Remote - US",
            absoluteUrl: "https://example.com/jobs/456",
          },
        ],
      }),
    };

    const result = await runPollCycle({
      persistence: port,
      adapters: new Map([["greenhouse", adapter]]),
      classifySnapshot: async () => ({
        observations: [{ classification: "new", role: roleFixture, job: observed }],
        removedJobs: [removed],
      }),
      matchesCriteria: () => true,
      now: dates,
      createId: (() => {
        const ids = ["poll-1", "notification-1"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    expect(result.status).toBe("succeeded");
    expect(jobs).toContainEqual(observed);
    expect(jobs).toContainEqual({ ...removed, removedAt: "2026-07-11T12:00:00.000Z" });
    expect(notifications).toContainEqual(
      expect.objectContaining({
        id: "notification-1",
        eventType: "new",
        dedupeKey: `new:${observed.sourceKey}`,
      }),
    );
    expect(pollRuns.at(-1)).toMatchObject({
      status: "succeeded",
      companiesAttempted: 1,
      companiesSucceeded: 1,
      jobsSeen: 1,
      jobsNew: 1,
      jobsRemoved: 1,
    });
  });

  it("does not classify a not-modified response as an empty snapshot", async () => {
    const classifySnapshot = vi.fn<() => SnapshotClassification>();
    const { port, pollRuns } = persistence();
    const adapter: AtsAdapter = {
      type: "greenhouse",
      fetchJobs: async () => ({ status: "not-modified" }),
    };

    await runPollCycle({
      persistence: port,
      adapters: new Map([["greenhouse", adapter]]),
      classifySnapshot,
      matchesCriteria: () => false,
      now: dates,
      createId: () => "poll-1",
    });

    expect(classifySnapshot).not.toHaveBeenCalled();
    expect(pollRuns.at(-1)).toMatchObject({ status: "succeeded", jobsRemoved: 0 });
  });
});

describe("core classifier bridge", () => {
  it("turns a known stable role with a new source into a persisted repost", async () => {
    const result = await classifyWithCore({
      company: companyFixture,
      observedAt: "2026-07-11T12:00:00.000Z",
      jobs: [
        {
          companyId: companyFixture.id,
          atsType: "greenhouse",
          atsJobId: "456",
          sourceKey: `${companyFixture.id}:greenhouse:456`,
          stableKey: roleFixture.stableKey,
          title: "Engineer",
          locationRaw: "Remote - US",
          location: { remoteScope: "remote", regions: ["us"], rawLabel: "Remote - US" },
          absoluteUrl: "https://example.com/jobs/456",
        },
      ],
      existingJobs: [],
      findRole: async () => ({ ...roleFixture, appliedAt: "2026-07-01T00:00:00.000Z" }),
      createId: () => "job-new",
    });

    expect(result.observations).toEqual([
      expect.objectContaining({
        classification: "reposted",
        role: expect.objectContaining({ appliedAt: "2026-07-01T00:00:00.000Z", repostCount: 1 }),
        job: expect.objectContaining({ id: "job-new", removedAt: null }),
      }),
    ]);
  });
});

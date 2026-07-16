/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="@cloudflare/workers-types" />

import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { D1Repository } from "../src/db/repository";
import { seedDatabase } from "../src/db/seed";
import {
  companyFixture,
  criteriaFixture,
  jobFixture,
  notificationFixture,
  pollRunFixture,
  roleFixture,
  subscriptionFixture,
} from "./fixtures/persistence";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

describe("D1Repository", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await env.DB.exec(
      "DELETE FROM notifications; DELETE FROM jobs; DELETE FROM role_ledger; DELETE FROM criteria; DELETE FROM companies;",
    );
  });

  it("round-trips provider-neutral values through explicit row translation", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCompany(companyFixture);
    await repository.saveRole(roleFixture);
    await repository.saveJob(jobFixture);
    await repository.saveCriteria(criteriaFixture);

    expect(await repository.listCompanies()).toEqual([companyFixture]);
    expect(await repository.findRole(roleFixture.stableKey)).toEqual(roleFixture);
    expect(await repository.listJobs(companyFixture.id)).toEqual([jobFixture]);
    expect(await repository.listRoleUserStates([roleFixture.stableKey, "missing"])).toEqual({
      [roleFixture.stableKey]: { appliedAt: null, notInterestedAt: null },
    });
    expect(await repository.listCriteria()).toEqual([criteriaFixture]);
  });

  it("finds and deletes companies while reporting missing records", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCompany(companyFixture);
    expect(await repository.findCompany(companyFixture.id)).toEqual(companyFixture);
    expect(await repository.findCompany("missing")).toBeNull();
    expect(await repository.deleteCompany(companyFixture.id)).toBe("deleted");
    expect(await repository.deleteCompany(companyFixture.id)).toBe("not_found");
  });

  it("reports duplicate ATS board identities without replacing the existing company", async () => {
    const repository = new D1Repository(env.DB);
    expect(await repository.createCompany(companyFixture)).toBe(true);
    expect(
      await repository.createCompany({
        ...companyFixture,
        id: "duplicate-company",
        name: "Duplicate Acme",
      }),
    ).toBe(false);
    expect(await repository.listCompanies()).toEqual([companyFixture]);
  });

  it("reports a conflict when durable role history prevents company deletion", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCompany(companyFixture);
    await repository.saveRole(roleFixture);

    expect(await repository.deleteCompany(companyFixture.id)).toBe("conflict");
    expect(await repository.findCompany(companyFixture.id)).toEqual(companyFixture);
  });

  it("updates mutually exclusive applied and not-interested state by stable key", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCompany(companyFixture);
    await repository.saveRole(roleFixture);
    await repository.saveCriteria(criteriaFixture);

    const appliedAt = "2026-07-11T09:00:00.000Z";
    expect(await repository.setRoleAppliedAt(roleFixture.stableKey, appliedAt)).toBe(true);
    expect(await repository.findRole(roleFixture.stableKey)).toMatchObject({
      appliedAt,
      notInterestedAt: null,
    });
    const notInterestedAt = "2026-07-11T10:00:00.000Z";
    expect(await repository.setRoleNotInterestedAt(roleFixture.stableKey, notInterestedAt)).toBe(
      true,
    );
    expect(await repository.findRole(roleFixture.stableKey)).toMatchObject({
      appliedAt: null,
      notInterestedAt,
    });
    expect(await repository.setRoleAppliedAt(roleFixture.stableKey, appliedAt)).toBe(true);
    expect(await repository.findRole(roleFixture.stableKey)).toMatchObject({
      appliedAt,
      notInterestedAt: null,
    });
    expect(await repository.setRoleAppliedAt(roleFixture.stableKey, null)).toBe(true);
    expect(await repository.setRoleNotInterestedAt(roleFixture.stableKey, null)).toBe(true);
    expect(await repository.setRoleAppliedAt("missing", appliedAt)).toBe(false);
    expect(await repository.setRoleNotInterestedAt("missing", notInterestedAt)).toBe(false);
  });

  it("deletes criteria", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCriteria(criteriaFixture);
    expect(await repository.deleteCriteria(criteriaFixture.id)).toBe(true);
    expect(await repository.deleteCriteria(criteriaFixture.id)).toBe(false);
  });

  it("seeds companies and criteria idempotently", async () => {
    const fixedNow = () => "2026-07-11T10:00:00.000Z";
    await seedDatabase(
      env.DB,
      { companies: [companyFixture], criteria: [criteriaFixture] },
      fixedNow,
    );
    await seedDatabase(
      env.DB,
      { companies: [companyFixture], criteria: [criteriaFixture] },
      fixedNow,
    );
    const repository = new D1Repository(env.DB);
    expect(await repository.listCompanies()).toHaveLength(1);
    expect(await repository.listCriteria()).toHaveLength(1);
    expect(
      await env.DB.prepare("SELECT created_at, updated_at FROM companies WHERE id = ?")
        .bind(companyFixture.id)
        .first(),
    ).toEqual({
      created_at: fixedNow(),
      updated_at: fixedNow(),
    });
  });

  it("enforces durable-ledger constraints and source identity uniqueness", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCompany(companyFixture);
    await expect(repository.saveRole({ ...roleFixture, repostCount: -1 })).rejects.toThrow();
    await repository.saveRole(roleFixture);
    await repository.saveJob(jobFixture);
    await expect(repository.saveJob({ ...jobFixture, id: "job-duplicate" })).rejects.toThrow();
    await expect(
      env.DB.prepare("DELETE FROM companies WHERE id = ?").bind(companyFixture.id).run(),
    ).rejects.toThrow();
  });

  it("contains every planned table and its important indexes", async () => {
    expect(env.TEST_MIGRATIONS.map(({ name }) => name)).toEqual([
      "0000_complete_steve_rogers.sql",
      "0001_sticky_pretty_boy.sql",
    ]);
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{
      name: string;
    }>();
    expect(tables.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "companies",
        "jobs",
        "role_ledger",
        "criteria",
        "push_subscriptions",
        "notifications",
        "poll_runs",
      ]),
    );
    const indexes = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index'",
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "jobs_source_key_unique",
        "jobs_company_removed_idx",
        "role_ledger_company_idx",
        "role_ledger_not_interested_idx",
        "notifications_dedupe_key_unique",
        "poll_runs_started_idx",
      ]),
    );
  });

  it("tracks push subscription uniqueness and dead state", async () => {
    const repository = new D1Repository(env.DB);
    await repository.savePushSubscription(subscriptionFixture);
    await repository.savePushSubscription({
      ...subscriptionFixture,
      status: "dead",
      failureCount: 3,
    });
    expect(await repository.listPushSubscriptions()).toEqual([
      { ...subscriptionFixture, status: "dead", failureCount: 3 },
    ]);
    await expect(
      repository.savePushSubscription({ ...subscriptionFixture, id: "subscription-2" }),
    ).rejects.toThrow();
    await repository.deletePushSubscription(subscriptionFixture.id);
    expect(await repository.listPushSubscriptions()).toEqual([]);
  });

  it("purges only removed jobs older than the cutoff through the repository", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCompany(companyFixture);
    const notInterestedAt = "2026-07-11T10:00:00.000Z";
    await repository.saveRole({ ...roleFixture, notInterestedAt });
    const eligible = { ...jobFixture, removedAt: "2026-07-08T00:00:00.000Z" };
    const recent = {
      ...jobFixture,
      id: "job-recent",
      sourceKey: "company-acme:greenhouse:recent",
      removedAt: "2026-07-10T00:00:00.000Z",
    };
    const current = {
      ...jobFixture,
      id: "job-current",
      sourceKey: "company-acme:greenhouse:current",
    };
    await repository.saveJob(eligible);
    await repository.saveJob(recent);
    await repository.saveJob(current);
    await repository.saveNotification(notificationFixture);

    expect(await repository.purgeRemovedJobs("2026-07-09T00:00:00.000Z")).toBe(1);
    expect((await repository.listJobs()).map(({ id }) => id).sort()).toEqual([
      "job-current",
      "job-recent",
    ]);
    expect(await repository.findRole(roleFixture.stableKey)).toMatchObject({
      notInterestedAt,
    });
    expect(await repository.listNotifications()).toEqual([{ ...notificationFixture, jobId: null }]);
  });

  it("deduplicates notifications and retains their durable ledger relation after job purge", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCompany(companyFixture);
    await repository.saveRole({ ...roleFixture, appliedAt: "2026-07-11T09:00:00.000Z" });
    await repository.saveJob(jobFixture);
    await repository.saveNotification(notificationFixture);
    await expect(
      repository.saveNotification({ ...notificationFixture, id: "notification-2" }),
    ).rejects.toThrow();
    await env.DB.prepare("DELETE FROM jobs WHERE id = ?").bind(jobFixture.id).run();
    expect(await repository.findRole(roleFixture.stableKey)).toMatchObject({
      appliedAt: "2026-07-11T09:00:00.000Z",
    });
    expect(await repository.listNotifications()).toEqual([{ ...notificationFixture, jobId: null }]);
  });

  it("persists poll-run lifecycle and counters", async () => {
    const repository = new D1Repository(env.DB);
    await repository.savePollRun(pollRunFixture);
    const completed = {
      ...pollRunFixture,
      status: "succeeded" as const,
      completedAt: "2026-07-11T08:02:00.000Z",
      companiesAttempted: 2,
      companiesSucceeded: 2,
      jobsSeen: 5,
      jobsNew: 1,
    };
    await repository.savePollRun(completed);
    expect(await repository.findPollRun(completed.id)).toEqual(completed);
    const latestManual = {
      ...pollRunFixture,
      id: "poll-manual",
      trigger: "manual" as const,
      startedAt: "2026-07-11T10:00:00.000Z",
    };
    await repository.savePollRun(latestManual);
    expect(await repository.findLatestPollRun()).toEqual(latestManual);
    expect(await repository.findLatestPollRun("manual")).toEqual(latestManual);
    expect(await repository.findLatestPollRun("scheduled")).toEqual(completed);
    await expect(repository.savePollRun({ ...completed, jobsSeen: -1 })).rejects.toThrow();
  });

  it("atomically records ledger and job observations without erasing user state", async () => {
    const repository = new D1Repository(env.DB);
    await repository.saveCompany(companyFixture);
    await repository.saveRole({
      ...roleFixture,
      notInterestedAt: "2026-07-11T09:00:00.000Z",
    });
    await repository.recordObservation(
      { ...roleFixture, lastSeenAt: "2026-07-12T08:00:00.000Z", notInterestedAt: null },
      jobFixture,
    );
    expect(await repository.findRole(roleFixture.stableKey)).toMatchObject({
      lastSeenAt: "2026-07-12T08:00:00.000Z",
      notInterestedAt: "2026-07-11T09:00:00.000Z",
    });

    const invalidRole = { ...roleFixture, stableKey: "rollback-role", repostCount: 1 };
    await expect(
      repository.recordObservation(invalidRole, {
        ...jobFixture,
        id: "rollback-job",
        stableKey: invalidRole.stableKey,
        sourceKey: jobFixture.sourceKey,
      }),
    ).rejects.toThrow();
    expect(await repository.findRole(invalidRole.stableKey)).toBeNull();
  });
});

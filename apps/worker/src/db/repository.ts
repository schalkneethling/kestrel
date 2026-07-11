import type {
  Company,
  Criteria,
  Notification,
  PersistedJob,
  PersistencePort,
  PollRun,
  PushSubscription,
  RoleLedgerEntry,
} from "@kestrel/core";
import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  companies,
  criteria,
  jobs,
  notifications,
  pollRuns,
  pushSubscriptions,
  roleLedger,
} from "./schema";

const parseList = (value: string) => JSON.parse(value) as string[];

const toCompany = (row: typeof companies.$inferSelect): Company => ({
  id: row.id,
  name: row.name,
  atsType: row.atsType as Company["atsType"],
  boardToken: row.boardToken,
  careersUrl: row.careersUrl,
  status: row.status as Company["status"],
  unsupportedPlatform: row.unsupportedPlatform,
  notes: row.notes,
});

const toPollRun = (row: typeof pollRuns.$inferSelect): PollRun => ({
  ...row,
  trigger: row.trigger as PollRun["trigger"],
  status: row.status as PollRun["status"],
});

export class D1Repository implements PersistencePort {
  readonly #db;
  readonly #now;
  constructor(database: D1Database, now: () => string = () => new Date().toISOString()) {
    this.#db = drizzle(database);
    this.#now = now;
  }

  async listCompanies(): Promise<Company[]> {
    return (await this.#db.select().from(companies)).map(toCompany);
  }
  async findCompany(id: string): Promise<Company | null> {
    const row = await this.#db.select().from(companies).where(eq(companies.id, id)).get();
    return row ? toCompany(row) : null;
  }
  async saveCompany(company: Company): Promise<void> {
    const now = this.#now();
    await this.#db
      .insert(companies)
      .values({ ...company, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: companies.id, set: { ...company, updatedAt: now } });
  }
  async deleteCompany(id: string): Promise<"deleted" | "not_found" | "conflict"> {
    try {
      const deleted = await this.#db
        .delete(companies)
        .where(eq(companies.id, id))
        .returning({ id: companies.id });
      return deleted.length > 0 ? "deleted" : "not_found";
    } catch (cause) {
      const referencedRole = await this.#db
        .select({ stableKey: roleLedger.stableKey })
        .from(roleLedger)
        .where(eq(roleLedger.companyId, id))
        .limit(1)
        .get();
      if (referencedRole) return "conflict";
      throw cause;
    }
  }
  async listJobs(companyId?: string): Promise<PersistedJob[]> {
    const query = this.#db.select().from(jobs);
    const rows = companyId ? await query.where(eq(jobs.companyId, companyId)) : await query;
    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      sourceKey: row.sourceKey,
      stableKey: row.stableKey,
      atsJobId: row.atsJobId,
      title: row.title,
      locationRaw: row.locationRaw,
      remoteScope: row.remoteScope as PersistedJob["remoteScope"],
      regions: parseList(row.regionsJson),
      department: row.department,
      employmentType: row.employmentType,
      absoluteUrl: row.absoluteUrl,
      descriptionSnippet: row.descriptionSnippet,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      removedAt: row.removedAt,
    }));
  }
  async listRoleAppliedAt(stableKeys: string[]): Promise<Record<string, string | null>> {
    if (stableKeys.length === 0) return {};
    const rows = await this.#db
      .select({ stableKey: roleLedger.stableKey, appliedAt: roleLedger.appliedAt })
      .from(roleLedger)
      .where(inArray(roleLedger.stableKey, stableKeys));
    return Object.fromEntries(rows.map(({ stableKey, appliedAt }) => [stableKey, appliedAt]));
  }
  async saveJob(job: PersistedJob): Promise<void> {
    const { regions, ...values } = job;
    const row = { ...values, regionsJson: JSON.stringify(regions) };
    await this.#db.insert(jobs).values(row).onConflictDoUpdate({ target: jobs.id, set: row });
  }
  async findRole(stableKey: string): Promise<RoleLedgerEntry | null> {
    return (
      (await this.#db.select().from(roleLedger).where(eq(roleLedger.stableKey, stableKey)).get()) ??
      null
    );
  }
  async saveRole(entry: RoleLedgerEntry): Promise<void> {
    await this.#db
      .insert(roleLedger)
      .values(entry)
      .onConflictDoUpdate({ target: roleLedger.stableKey, set: entry });
  }
  async setRoleAppliedAt(stableKey: string, appliedAt: string | null): Promise<boolean> {
    const updated = await this.#db
      .update(roleLedger)
      .set({ appliedAt })
      .where(eq(roleLedger.stableKey, stableKey))
      .returning({ stableKey: roleLedger.stableKey });
    return updated.length > 0;
  }
  async listCriteria(): Promise<Criteria[]> {
    return (await this.#db.select().from(criteria)).map(
      ({
        titleIncludesJson,
        titleExcludesJson,
        locationHardExcludesJson,
        regionsJson,
        createdAt: _c,
        updatedAt: _u,
        ...row
      }) => ({
        ...row,
        titleIncludes: parseList(titleIncludesJson),
        titleExcludes: parseList(titleExcludesJson),
        locationHardExcludes: parseList(locationHardExcludesJson),
        regions: parseList(regionsJson),
      }),
    );
  }
  async saveCriteria(value: Criteria): Promise<void> {
    const { titleIncludes, titleExcludes, locationHardExcludes, regions, ...rest } = value;
    const now = this.#now();
    const row = {
      ...rest,
      titleIncludesJson: JSON.stringify(titleIncludes),
      titleExcludesJson: JSON.stringify(titleExcludes),
      locationHardExcludesJson: JSON.stringify(locationHardExcludes),
      regionsJson: JSON.stringify(regions),
      createdAt: now,
      updatedAt: now,
    };
    await this.#db
      .insert(criteria)
      .values(row)
      .onConflictDoUpdate({ target: criteria.id, set: { ...row, createdAt: undefined } });
  }

  async deleteCriteria(id: string): Promise<boolean> {
    const deleted = await this.#db
      .delete(criteria)
      .where(eq(criteria.id, id))
      .returning({ id: criteria.id });
    return deleted.length > 0;
  }

  async listPushSubscriptions(): Promise<PushSubscription[]> {
    return (await this.#db.select().from(pushSubscriptions)).map((row) => ({
      ...row,
      status: row.status as PushSubscription["status"],
    }));
  }

  async savePushSubscription(subscription: PushSubscription): Promise<void> {
    await this.#db
      .insert(pushSubscriptions)
      .values(subscription)
      .onConflictDoUpdate({ target: pushSubscriptions.id, set: subscription });
  }

  async deletePushSubscription(id: string): Promise<void> {
    await this.#db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  async listNotifications(): Promise<Notification[]> {
    return (await this.#db.select().from(notifications)).map((row) => ({
      ...row,
      eventType: row.eventType as Notification["eventType"],
      status: row.status as Notification["status"],
    }));
  }

  async saveNotification(notification: Notification): Promise<void> {
    await this.#db.insert(notifications).values(notification).onConflictDoUpdate({
      target: notifications.id,
      set: notification,
    });
  }

  async findPollRun(id: string): Promise<PollRun | null> {
    const row = await this.#db.select().from(pollRuns).where(eq(pollRuns.id, id)).get();
    return row ? toPollRun(row) : null;
  }

  async findLatestPollRun(trigger?: PollRun["trigger"]): Promise<PollRun | null> {
    const query = this.#db.select().from(pollRuns).orderBy(desc(pollRuns.startedAt)).limit(1);
    const row = trigger
      ? await query.where(eq(pollRuns.trigger, trigger)).get()
      : await query.get();
    return row ? toPollRun(row) : null;
  }

  async savePollRun(run: PollRun): Promise<void> {
    await this.#db
      .insert(pollRuns)
      .values(run)
      .onConflictDoUpdate({ target: pollRuns.id, set: run });
  }

  async recordObservation(entry: RoleLedgerEntry, job: PersistedJob): Promise<void> {
    const { regions, ...jobValues } = job;
    const ledgerWrite = this.#db
      .insert(roleLedger)
      .values(entry)
      .onConflictDoUpdate({
        target: roleLedger.stableKey,
        set: {
          title: entry.title,
          lastSeenAt: entry.lastSeenAt,
          lastSourceKey: entry.lastSourceKey,
          repostCount: entry.repostCount,
        },
      });
    const jobRow = { ...jobValues, regionsJson: JSON.stringify(regions) };
    const jobWrite = this.#db
      .insert(jobs)
      .values(jobRow)
      .onConflictDoUpdate({ target: jobs.id, set: jobRow });
    await this.#db.batch([ledgerWrite, jobWrite]);
  }

  async purgeRemovedJobs(cutoff: string): Promise<number> {
    const purged = await this.#db
      .delete(jobs)
      .where(and(isNotNull(jobs.removedAt), lt(jobs.removedAt, cutoff)))
      .returning({ id: jobs.id });
    return purged.length;
  }
}

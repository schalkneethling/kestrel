import type { NormalizedJob } from "./domain";
import type { PersistedJob, RoleLedgerEntry } from "./persistence";

export type ObservedJobDiff = {
  job: NormalizedJob;
  previousJob: PersistedJob | null;
  role: RoleLedgerEntry;
};

export type RemovedJobDiff = {
  job: PersistedJob;
  removedAt: string;
};

export type SnapshotDiff = {
  new: ObservedJobDiff[];
  reposted: ObservedJobDiff[];
  unchanged: ObservedJobDiff[];
  removed: RemovedJobDiff[];
};

export type DiffSnapshotInput = {
  current: readonly NormalizedJob[];
  persisted: readonly PersistedJob[];
  ledger: readonly RoleLedgerEntry[];
  /** Only these companies are eligible for removal detection. */
  successfulCompanyIds: readonly string[];
  observedAt: string;
};

function createRole(
  job: NormalizedJob,
  observedAt: string,
  firstSeenAt: string = observedAt,
): RoleLedgerEntry {
  return {
    stableKey: job.stableKey,
    companyId: job.companyId,
    title: job.title,
    firstSeenAt,
    lastSeenAt: observedAt,
    lastSourceKey: job.sourceKey,
    repostCount: 0,
    appliedAt: null,
  };
}

function observeRole(
  role: RoleLedgerEntry,
  job: NormalizedJob,
  observedAt: string,
  reposted: boolean,
): RoleLedgerEntry {
  return {
    ...role,
    companyId: job.companyId,
    title: job.title,
    lastSeenAt: observedAt,
    lastSourceKey: job.sourceKey,
    repostCount: role.repostCount + (reposted ? 1 : 0),
  };
}

/** Pure snapshot classification. Persistence and transaction handling belong to the caller. */
export function diffSnapshot(input: DiffSnapshotInput): SnapshotDiff {
  const result: SnapshotDiff = { new: [], reposted: [], unchanged: [], removed: [] };
  const jobsBySource = new Map(input.persisted.map((job) => [job.sourceKey, job]));
  const rolesByStableKey = new Map(input.ledger.map((entry) => [entry.stableKey, entry]));
  const currentSourceKeys = new Set<string>();

  for (const job of input.current) {
    if (currentSourceKeys.has(job.sourceKey)) {
      throw new Error(`duplicate current sourceKey: ${job.sourceKey}`);
    }
    currentSourceKeys.add(job.sourceKey);

    const previousJob = jobsBySource.get(job.sourceKey) ?? null;
    const priorRole = rolesByStableKey.get(job.stableKey) ?? null;
    const isActiveSource = previousJob !== null && previousJob.removedAt === null;

    if (isActiveSource) {
      result.unchanged.push({
        job,
        previousJob,
        role: priorRole
          ? observeRole(priorRole, job, input.observedAt, false)
          : createRole(job, input.observedAt, previousJob.firstSeenAt),
      });
    } else if (priorRole) {
      result.reposted.push({
        job,
        previousJob,
        role: observeRole(priorRole, job, input.observedAt, true),
      });
    } else {
      result.new.push({ job, previousJob, role: createRole(job, input.observedAt) });
    }
  }

  const successfulCompanies = new Set(input.successfulCompanyIds);
  for (const job of input.persisted) {
    if (
      job.removedAt === null &&
      successfulCompanies.has(job.companyId) &&
      !currentSourceKeys.has(job.sourceKey)
    ) {
      result.removed.push({ job, removedAt: input.observedAt });
    }
  }

  return result;
}

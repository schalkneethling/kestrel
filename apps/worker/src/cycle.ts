import type {
  AtsAdapter,
  Company,
  Criteria,
  NormalizedJob,
  PersistedJob,
  PersistencePort,
  RoleLedgerEntry,
  SupportedAtsType,
} from "@kestrel/core";
import {
  diffSnapshot,
  isSupportedAtsType,
  matchesCriteria as coreMatchesCriteria,
  normalizeJob,
} from "@kestrel/core";

const RETENTION_DAYS = 3;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

export type ObservationClassification = "new" | "reposted" | "unchanged";

export type ClassifiedObservation = {
  classification: ObservationClassification;
  role: RoleLedgerEntry;
  job: PersistedJob;
};

export type SnapshotClassification = {
  observations: ClassifiedObservation[];
  removedJobs: PersistedJob[];
};

export type ClassifySnapshot = (input: {
  company: Company;
  observedAt: string;
  jobs: NormalizedJob[];
  existingJobs: PersistedJob[];
  findRole: PersistencePort["findRole"];
  createId: () => string;
}) => SnapshotClassification | Promise<SnapshotClassification>;

export type CriteriaMatcher = (criteria: Criteria, job: PersistedJob) => boolean;

export type CycleDependencies = {
  persistence: PersistencePort;
  adapters: ReadonlyMap<SupportedAtsType, AtsAdapter>;
  classifySnapshot: ClassifySnapshot;
  matchesCriteria: CriteriaMatcher;
  now?: () => Date;
  createId?: () => string;
};

export type CycleTrigger = "scheduled" | "manual";

export type CycleResult = {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  retentionPurged: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function eventCount(observations: ClassifiedObservation[], value: ObservationClassification) {
  return observations.filter(({ classification }) => classification === value).length;
}

export async function runRetentionSweep(
  persistence: PersistencePort,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_IN_MILLISECONDS).toISOString();
  return persistence.purgeRemovedJobs(cutoff);
}

/** Runs one provider-neutral polling cycle. Only a successful fresh snapshot may remove jobs. */
export async function runPollCycle(
  dependencies: CycleDependencies,
  trigger: CycleTrigger = "scheduled",
): Promise<CycleResult> {
  const {
    persistence,
    adapters,
    classifySnapshot,
    matchesCriteria,
    now = () => new Date(),
    createId = () => crypto.randomUUID(),
  } = dependencies;
  const started = now();
  const runId = createId();
  const run = {
    id: runId,
    trigger,
    startedAt: started.toISOString(),
    completedAt: null,
    status: "running" as const,
    companiesAttempted: 0,
    companiesSucceeded: 0,
    jobsSeen: 0,
    jobsNew: 0,
    jobsReposted: 0,
    jobsRemoved: 0,
    error: null,
  };
  await persistence.savePollRun(run);

  const errors: string[] = [];
  const companies = (await persistence.listCompanies()).filter(
    (company) => company.status === "active" && isSupportedAtsType(company.atsType),
  );
  const criteria = (await persistence.listCriteria()).filter((value) => value.enabled);

  for (const company of companies) {
    run.companiesAttempted += 1;
    const adapter = adapters.get(company.atsType as SupportedAtsType);
    if (!adapter) {
      errors.push(`${company.name}: no ${company.atsType} adapter registered`);
      continue;
    }

    try {
      const response = await adapter.fetchJobs(company);
      run.companiesSucceeded += 1;
      if (response.status === "not-modified") continue;

      const observedAt = now().toISOString();
      const normalized = response.jobs.map((job) => normalizeJob(company, job));
      const existingJobs = await persistence.listJobs(company.id);
      const classified = await classifySnapshot({
        company,
        observedAt,
        jobs: normalized,
        existingJobs,
        findRole: persistence.findRole.bind(persistence),
        createId,
      });

      for (const observation of classified.observations) {
        await persistence.recordObservation(observation.role, observation.job);
        if (
          observation.classification !== "unchanged" &&
          criteria.some((value) => matchesCriteria(value, observation.job))
        ) {
          const eventType = observation.classification === "new" ? "new" : "reposted";
          await persistence.saveNotification({
            id: createId(),
            jobId: observation.job.id,
            stableKey: observation.job.stableKey,
            eventType,
            dedupeKey: `${eventType}:${observation.job.sourceKey}`,
            status: "pending",
            sentAt: null,
            error: null,
            createdAt: observedAt,
          });
        }
      }
      for (const job of classified.removedJobs) {
        await persistence.saveJob({ ...job, removedAt: job.removedAt ?? observedAt });
      }

      run.jobsSeen += normalized.length;
      run.jobsNew += eventCount(classified.observations, "new");
      run.jobsReposted += eventCount(classified.observations, "reposted");
      run.jobsRemoved += classified.removedJobs.length;
    } catch (error) {
      // A failed provider snapshot is isolated to its company and never reaches removal detection.
      errors.push(`${company.name}: ${errorMessage(error)}`);
    }
  }

  let retentionPurged = 0;
  try {
    retentionPurged = await runRetentionSweep(persistence, now());
  } catch (error) {
    errors.push(`retention: ${errorMessage(error)}`);
  }

  const status =
    errors.length === 0 ? "succeeded" : run.companiesSucceeded > 0 ? "partial" : "failed";
  await persistence.savePollRun({
    ...run,
    completedAt: now().toISOString(),
    status,
    error: errors.length > 0 ? errors.join("; ") : null,
  });
  return { runId, status, retentionPurged };
}

/** Bridges the pure core diff into persistence-ready observations for the Worker cycle. */
export const classifyWithCore: ClassifySnapshot = async ({
  company,
  observedAt,
  jobs,
  existingJobs,
  findRole,
  createId,
}) => {
  const stableKeys = [...new Set(jobs.map((job) => job.stableKey))];
  const ledger = (await Promise.all(stableKeys.map((stableKey) => findRole(stableKey)))).filter(
    (entry): entry is RoleLedgerEntry => entry !== null,
  );
  const diff = diffSnapshot({
    current: jobs,
    persisted: existingJobs,
    ledger,
    successfulCompanyIds: [company.id],
    observedAt,
  });
  const observations = [
    ...diff.new.map((value) => ({ classification: "new" as const, ...value })),
    ...diff.reposted.map((value) => ({ classification: "reposted" as const, ...value })),
    ...diff.unchanged.map((value) => ({ classification: "unchanged" as const, ...value })),
  ].map(({ classification, job, previousJob, role }) => ({
    classification,
    role,
    job: {
      id: previousJob?.id ?? createId(),
      companyId: job.companyId,
      sourceKey: job.sourceKey,
      stableKey: job.stableKey,
      atsJobId: job.atsJobId,
      title: job.title,
      locationRaw: job.locationRaw,
      remoteScope: job.location.remoteScope,
      regions: job.location.regions,
      department: job.department ?? null,
      employmentType: job.employmentType ?? null,
      absoluteUrl: job.absoluteUrl,
      descriptionSnippet: job.descriptionSnippet ?? null,
      firstSeenAt: previousJob?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
      removedAt: null,
    },
  }));
  return { observations, removedJobs: diff.removed.map(({ job }) => job) };
};

export const matchesPersistedJob: CriteriaMatcher = (criteria, job) =>
  coreMatchesCriteria(
    {
      companyId: job.companyId,
      atsType: job.sourceKey.split(":")[1] as SupportedAtsType,
      atsJobId: job.atsJobId,
      sourceKey: job.sourceKey,
      stableKey: job.stableKey,
      title: job.title,
      locationRaw: job.locationRaw,
      absoluteUrl: job.absoluteUrl,
      ...(job.department === null ? {} : { department: job.department }),
      ...(job.employmentType === null ? {} : { employmentType: job.employmentType }),
      ...(job.descriptionSnippet === null ? {} : { descriptionSnippet: job.descriptionSnippet }),
      location: {
        remoteScope: job.remoteScope,
        regions: job.regions,
        rawLabel: job.locationRaw,
      },
    },
    criteria,
  );

export function createCronHandler(dependencies: CycleDependencies) {
  return async () => {
    await runPollCycle(dependencies, "scheduled");
  };
}

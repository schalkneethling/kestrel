import type { Company, RemoteScope } from "./domain";

export type PersistedJob = {
  id: string;
  companyId: string;
  sourceKey: string;
  stableKey: string;
  atsJobId: string;
  title: string;
  locationRaw: string;
  remoteScope: RemoteScope;
  regions: string[];
  department: string | null;
  employmentType: string | null;
  absoluteUrl: string;
  descriptionSnippet: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  removedAt: string | null;
};

export type RoleLedgerEntry = {
  stableKey: string;
  companyId: string;
  title: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSourceKey: string;
  repostCount: number;
  appliedAt: string | null;
};

export type Criteria = {
  id: string;
  name: string;
  enabled: boolean;
  titleIncludes: string[];
  titleExcludes: string[];
  locationHardExcludes: string[];
  regions: string[];
};

export type PushSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  createdAt: string;
  lastSuccessAt: string | null;
  failureCount: number;
  status: "active" | "dead";
};

export type Notification = {
  id: string;
  jobId: string | null;
  stableKey: string;
  eventType: "new" | "reposted";
  dedupeKey: string;
  status: "pending" | "sent" | "failed";
  sentAt: string | null;
  error: string | null;
  createdAt: string;
};

export type PollRun = {
  id: string;
  trigger: "scheduled" | "manual";
  startedAt: string;
  completedAt: string | null;
  status: "running" | "succeeded" | "partial" | "failed";
  companiesAttempted: number;
  companiesSucceeded: number;
  jobsSeen: number;
  jobsNew: number;
  jobsReposted: number;
  jobsRemoved: number;
  error: string | null;
};

/** Provider-neutral storage contract. Persistence adapters translate these values to database rows. */
export interface PersistencePort {
  listCompanies(): Promise<Company[]>;
  findCompany(id: string): Promise<Company | null>;
  saveCompany(company: Company): Promise<void>;
  deleteCompany(id: string): Promise<"deleted" | "not_found" | "conflict">;
  listJobs(companyId?: string): Promise<PersistedJob[]>;
  listRoleAppliedAt(stableKeys: string[]): Promise<Record<string, string | null>>;
  saveJob(job: PersistedJob): Promise<void>;
  findRole(stableKey: string): Promise<RoleLedgerEntry | null>;
  saveRole(entry: RoleLedgerEntry): Promise<void>;
  setRoleAppliedAt(stableKey: string, appliedAt: string | null): Promise<boolean>;
  listCriteria(): Promise<Criteria[]>;
  saveCriteria(criteria: Criteria): Promise<void>;
  deleteCriteria(id: string): Promise<boolean>;
  listPushSubscriptions(): Promise<PushSubscription[]>;
  savePushSubscription(subscription: PushSubscription): Promise<void>;
  deletePushSubscription(id: string): Promise<void>;
  listNotifications(): Promise<Notification[]>;
  saveNotification(notification: Notification): Promise<void>;
  findPollRun(id: string): Promise<PollRun | null>;
  findLatestPollRun(trigger?: PollRun["trigger"]): Promise<PollRun | null>;
  savePollRun(run: PollRun): Promise<void>;
  recordObservation(entry: RoleLedgerEntry, job: PersistedJob): Promise<void>;
  purgeRemovedJobs(cutoff: string): Promise<number>;
}

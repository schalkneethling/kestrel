import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const workerHealthChecks = sqliteTable("worker_health_checks", {
  id: text().primaryKey(),
  checkedAt: text("checked_at").notNull(),
});

export const companies = sqliteTable(
  "companies",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    atsType: text("ats_type").notNull(),
    boardToken: text("board_token"),
    careersUrl: text("careers_url").notNull(),
    status: text().notNull(),
    unsupportedPlatform: text("unsupported_platform"),
    notes: text(),
    ...timestamps,
  },
  (table) => [
    check(
      "companies_ats_type_check",
      sql`${table.atsType} in ('greenhouse', 'lever', 'ashby', 'unsupported')`,
    ),
    check("companies_status_check", sql`${table.status} in ('active', 'paused', 'unsupported')`),
    uniqueIndex("companies_ats_board_unique").on(table.atsType, table.boardToken),
    index("companies_status_idx").on(table.status),
  ],
);

export const roleLedger = sqliteTable(
  "role_ledger",
  {
    stableKey: text("stable_key").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    title: text().notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    lastSourceKey: text("last_source_key").notNull(),
    repostCount: integer("repost_count").notNull().default(0),
    appliedAt: text("applied_at"),
  },
  (table) => [
    check("role_ledger_repost_count_check", sql`${table.repostCount} >= 0`),
    index("role_ledger_company_idx").on(table.companyId),
    index("role_ledger_applied_idx").on(table.appliedAt),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text().primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    stableKey: text("stable_key")
      .notNull()
      .references(() => roleLedger.stableKey, { onDelete: "restrict" }),
    atsJobId: text("ats_job_id").notNull(),
    title: text().notNull(),
    locationRaw: text("location_raw").notNull(),
    remoteScope: text("remote_scope").notNull(),
    regionsJson: text("regions_json").notNull().default("[]"),
    department: text(),
    employmentType: text("employment_type"),
    absoluteUrl: text("absolute_url").notNull(),
    descriptionSnippet: text("description_snippet"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    removedAt: text("removed_at"),
  },
  (table) => [
    uniqueIndex("jobs_source_key_unique").on(table.sourceKey),
    check(
      "jobs_remote_scope_check",
      sql`${table.remoteScope} in ('onsite', 'remote', 'hybrid', 'unknown')`,
    ),
    index("jobs_company_removed_idx").on(table.companyId, table.removedAt),
    index("jobs_stable_key_idx").on(table.stableKey),
  ],
);

export const criteria = sqliteTable(
  "criteria",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    titleIncludesJson: text("title_includes_json").notNull().default("[]"),
    titleExcludesJson: text("title_excludes_json").notNull().default("[]"),
    locationHardExcludesJson: text("location_hard_excludes_json").notNull().default("[]"),
    regionsJson: text("regions_json").notNull().default("[]"),
    ...timestamps,
  },
  (table) => [index("criteria_enabled_idx").on(table.enabled)],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text().primaryKey(),
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    expirationTime: integer("expiration_time"),
    createdAt: text("created_at").notNull(),
    lastSuccessAt: text("last_success_at"),
    failureCount: integer("failure_count").notNull().default(0),
    status: text().notNull().default("active"),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    check("push_subscriptions_failure_count_check", sql`${table.failureCount} >= 0`),
    check("push_subscriptions_status_check", sql`${table.status} in ('active', 'dead')`),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text().primaryKey(),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    // This durable FK remains valid when the prunable job row is deleted.
    stableKey: text("stable_key")
      .notNull()
      .references(() => roleLedger.stableKey, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text().notNull(),
    sentAt: text("sent_at"),
    error: text(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("notifications_dedupe_key_unique").on(table.dedupeKey),
    index("notifications_created_idx").on(table.createdAt),
    check("notifications_event_type_check", sql`${table.eventType} in ('new', 'reposted')`),
    check("notifications_status_check", sql`${table.status} in ('pending', 'sent', 'failed')`),
  ],
);

export const pollRuns = sqliteTable(
  "poll_runs",
  {
    id: text().primaryKey(),
    trigger: text().notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    status: text().notNull(),
    companiesAttempted: integer("companies_attempted").notNull().default(0),
    companiesSucceeded: integer("companies_succeeded").notNull().default(0),
    jobsSeen: integer("jobs_seen").notNull().default(0),
    jobsNew: integer("jobs_new").notNull().default(0),
    jobsReposted: integer("jobs_reposted").notNull().default(0),
    jobsRemoved: integer("jobs_removed").notNull().default(0),
    error: text(),
  },
  (table) => [
    index("poll_runs_started_idx").on(table.startedAt),
    check("poll_runs_trigger_check", sql`${table.trigger} in ('scheduled', 'manual')`),
    check(
      "poll_runs_status_check",
      sql`${table.status} in ('running', 'succeeded', 'partial', 'failed')`,
    ),
    check(
      "poll_runs_counters_check",
      sql`${table.companiesAttempted} >= 0 and ${table.companiesSucceeded} >= 0 and ${table.companiesSucceeded} <= ${table.companiesAttempted} and ${table.jobsSeen} >= 0 and ${table.jobsNew} >= 0 and ${table.jobsReposted} >= 0 and ${table.jobsRemoved} >= 0`,
    ),
  ],
);

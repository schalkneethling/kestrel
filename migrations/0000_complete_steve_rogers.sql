CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ats_type` text NOT NULL,
	`board_token` text,
	`careers_url` text NOT NULL,
	`status` text NOT NULL,
	`unsupported_platform` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "companies_ats_type_check" CHECK("companies"."ats_type" in ('greenhouse', 'lever', 'ashby', 'unsupported')),
	CONSTRAINT "companies_status_check" CHECK("companies"."status" in ('active', 'paused', 'unsupported'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_ats_board_unique` ON `companies` (`ats_type`,`board_token`);--> statement-breakpoint
CREATE INDEX `companies_status_idx` ON `companies` (`status`);--> statement-breakpoint
CREATE TABLE `criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`title_includes_json` text DEFAULT '[]' NOT NULL,
	`title_excludes_json` text DEFAULT '[]' NOT NULL,
	`location_hard_excludes_json` text DEFAULT '[]' NOT NULL,
	`regions_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `criteria_enabled_idx` ON `criteria` (`enabled`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`source_key` text NOT NULL,
	`stable_key` text NOT NULL,
	`ats_job_id` text NOT NULL,
	`title` text NOT NULL,
	`location_raw` text NOT NULL,
	`remote_scope` text NOT NULL,
	`regions_json` text DEFAULT '[]' NOT NULL,
	`department` text,
	`employment_type` text,
	`absolute_url` text NOT NULL,
	`description_snippet` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`removed_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stable_key`) REFERENCES `role_ledger`(`stable_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "jobs_remote_scope_check" CHECK("jobs"."remote_scope" in ('onsite', 'remote', 'hybrid', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_key_unique` ON `jobs` (`source_key`);--> statement-breakpoint
CREATE INDEX `jobs_company_removed_idx` ON `jobs` (`company_id`,`removed_at`);--> statement-breakpoint
CREATE INDEX `jobs_stable_key_idx` ON `jobs` (`stable_key`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text,
	`stable_key` text NOT NULL,
	`event_type` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text NOT NULL,
	`sent_at` text,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stable_key`) REFERENCES `role_ledger`(`stable_key`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "notifications_event_type_check" CHECK("notifications"."event_type" in ('new', 'reposted')),
	CONSTRAINT "notifications_status_check" CHECK("notifications"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `poll_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`companies_attempted` integer DEFAULT 0 NOT NULL,
	`companies_succeeded` integer DEFAULT 0 NOT NULL,
	`jobs_seen` integer DEFAULT 0 NOT NULL,
	`jobs_new` integer DEFAULT 0 NOT NULL,
	`jobs_reposted` integer DEFAULT 0 NOT NULL,
	`jobs_removed` integer DEFAULT 0 NOT NULL,
	`error` text,
	CONSTRAINT "poll_runs_trigger_check" CHECK("poll_runs"."trigger" in ('scheduled', 'manual')),
	CONSTRAINT "poll_runs_status_check" CHECK("poll_runs"."status" in ('running', 'succeeded', 'partial', 'failed')),
	CONSTRAINT "poll_runs_counters_check" CHECK("poll_runs"."companies_attempted" >= 0 and "poll_runs"."companies_succeeded" >= 0 and "poll_runs"."companies_succeeded" <= "poll_runs"."companies_attempted" and "poll_runs"."jobs_seen" >= 0 and "poll_runs"."jobs_new" >= 0 and "poll_runs"."jobs_reposted" >= 0 and "poll_runs"."jobs_removed" >= 0)
);
--> statement-breakpoint
CREATE INDEX `poll_runs_started_idx` ON `poll_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`expiration_time` integer,
	`created_at` text NOT NULL,
	`last_success_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	CONSTRAINT "push_subscriptions_failure_count_check" CHECK("push_subscriptions"."failure_count" >= 0),
	CONSTRAINT "push_subscriptions_status_check" CHECK("push_subscriptions"."status" in ('active', 'dead'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `role_ledger` (
	`stable_key` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`title` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_source_key` text NOT NULL,
	`repost_count` integer DEFAULT 0 NOT NULL,
	`applied_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "role_ledger_repost_count_check" CHECK("role_ledger"."repost_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `role_ledger_company_idx` ON `role_ledger` (`company_id`);--> statement-breakpoint
CREATE INDEX `role_ledger_applied_idx` ON `role_ledger` (`applied_at`);--> statement-breakpoint
CREATE TABLE `worker_health_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL
);

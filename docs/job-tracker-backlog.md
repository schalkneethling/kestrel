# Job Posting Tracker Backlog

This backlog mirrors the owner-supplied tracker document. IDs are stable and
should appear in issue titles, branch names, and commit messages.

## E0 - Project Scaffolding, Configuration, And Secrets

Goal: establish the monorepo layout, Cloudflare Worker and D1 wiring,
Varlock-managed config, and test harness.

- E0.1 Repository and workspace layout: create `packages/core`, `apps/worker`,
  and `apps/dashboard`. `core` must build and test with plain Vitest.
- E0.2 Wrangler and D1 setup: configure Worker bindings, local D1, cron
  placeholder, and `nodejs_compat` if the Web Push path needs it.
- E0.3 Varlock config and schema: initialize Varlock, define `.env.schema`,
  encrypted local values, validation, scan, and a pre-commit hook.
- E0.4 VAPID keys via Wrangler secret: generate the key pair and store the
  private key outside the repository.
- E0.5 Test harness: configure plain Vitest, Workers-pool Vitest, Playwright,
  and CI example tests.

## E1 - Data Model And Migrations

Goal: create Drizzle-managed D1 migrations and a Worker repository
implementation for all tables, behind the domain persistence boundary described
in ADR 0001.

- E1.1 Core tables.
- E1.2 `role_ledger` table.
- E1.3 Domain persistence port and Drizzle/D1 repository layer.
- E1.4 Seed and fixtures.

## E2 - ATS Adapters And Normalization

Goal: fetch and normalize Greenhouse, Lever, and Ashby jobs behind one
interface.

- E2.1 Adapter interface and registry.
- E2.2 Greenhouse adapter.
- E2.3 Lever adapter.
- E2.4 Ashby adapter.
- E2.5 Conditional requests and error handling.
- E2.6 `stableKey`.
- E2.7 `classifyLocation`.

## E3 - Diff Engine, Ledger, Criteria Matching, And Retention

Goal: classify each poll cycle against the durable ledger and retain applied
memory across purges.

- E3.1 Diff classification against the ledger.
- E3.2 Removal detection.
- E3.3 Applied memory across reposts.
- E3.4 Criteria matcher.
- E3.5 Retention sweep.
- E3.6 Cycle orchestration and cron.

## E4 - Web Push Delivery

Goal: deliver desktop Chrome push notifications for matched jobs and clean up
dead subscriptions.

- E4.1 Push send from the Worker.
- E4.2 Service worker and client subscribe flow.
- E4.3 Notification content and click behavior.
- E4.4 Dead-subscription cleanup and idempotency.

## E5 - API Layer

Goal: expose guarded dashboard routes for companies, jobs, criteria, push,
manual poll, and manual purge.

- E5.1 Bearer-secret guard.
- E5.2 Company endpoints.
- E5.3 Jobs endpoints.
- E5.4 Criteria and push endpoints.
- E5.5 Cooldown-guarded poll and purge.

## E6 - Dashboard

Goal: build the single-user UI with shadcn and Tailwind.

- E6.1 App shell and API client.
- E6.2 Companies view.
- E6.3 Jobs feed.
- E6.4 Criteria editor.
- E6.5 Notifications view and enable control.
- E6.6 Refresh and purge controls.

## E7 - Observability And Politeness

Goal: make polling visible and ensure ATS requests are polite.

- E7.1 `poll_runs` logging and view.
- E7.2 Politeness controls.
- E7.3 Failure-isolation test.

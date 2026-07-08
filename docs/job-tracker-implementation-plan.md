# Job Posting Tracker Implementation Plan

This project is a single-user prototype for tracking named companies, polling
their applicant tracking systems on a schedule, detecting new and reposted jobs,
matching them against saved criteria, and sending desktop Chrome Web Push
notifications for matches.

The source planning document supplied by the owner is authoritative for product
behavior. This repo copy captures the implementation constraints that agents
must preserve while building the system.

## Scope

The prototype has exactly one user. There is no account system, no roles, no
multi-tenancy, and no automated company-to-ATS discovery. Companies are added
manually with a known ATS type and board token. Unsupported ATS platforms are
stored and shown separately, but never polled.

Supported ATS platforms for the first build are Greenhouse, Lever, and Ashby.
Workday, iCIMS, Taleo, SuccessFactors, and similar platforms are recorded with
`unsupported` status.

## Stack

The system runs on Cloudflare:

- Cloudflare Workers for API, scheduling, and static asset serving.
- Cloudflare Cron Triggers for polling.
- Cloudflare D1 for SQLite storage.
- Hono for HTTP routing unless a plain Worker fetch handler is sufficient.
- React 19 and Vite for the dashboard.
- Tailwind v4 and shadcn/ui, used idiomatically for the prototype.
- Web Push for desktop Chrome through service workers and `PushManager`.
- Vitest for unit and integration tests, with the Workers pool for Worker and D1
  tests.
- Playwright for dashboard end-to-end, component, and visual regression tests.
- Varlock for configuration, schema validation, encrypted local values, and leak
  scanning.

## Architecture

The repository is organized around three deployable or reusable areas:

- `packages/core`: platform-agnostic domain code for ATS adapters,
  normalization, diffing, and criteria matching.
- `apps/worker`: Cloudflare Worker API and scheduled poll handler.
- `apps/dashboard`: React dashboard served as static assets.

Core modules must not depend on Worker or DOM globals. That boundary keeps the
diff engine and matching logic testable in plain Vitest.

## Data Model

D1 migrations must define these tables:

- `companies`
- `jobs`
- `role_ledger`
- `criteria`
- `push_subscriptions`
- `notifications`
- `poll_runs`

The `role_ledger` is durable and never purged. It owns repost identity and
application state. Removed `jobs` rows are retained for three days and then
purged. Repost detection must resolve against `role_ledger`, not the prunable
`jobs` table.

## Engine Rules

The diff engine is the heart of the project and must be developed test-first. A
cycle classifies jobs as new, unchanged, reposted, or removed. A transient ATS
adapter failure must never be interpreted as all jobs being removed.

Criteria matching only gates location through explicit
`location_hard_excludes`. Location classification is for display and nuance, not
silent rejection.

## API

Every `/api/*` route is protected by a shared bearer secret. Routes cover
companies, jobs, application state, criteria, push subscription registration,
the VAPID public key, manual poll, and manual purge. Manual poll and purge are
cooldown-guarded server side.

## Dashboard

The dashboard includes:

- Companies, including a distinct unsupported section.
- Jobs feed with location badges, repost state, applied state, filters, and
  outbound links.
- Criteria editor.
- Notifications view and enable-notifications control.
- Refresh-now and purge-removed controls with cooldown countdowns.

Use semantic structural markup and keep Radix accessibility behavior intact when
using shadcn components.

## Mandatory Conventions

Use native web platform behavior first. CSS-in-JS is prohibited. Use Tailwind and
shadcn idiomatically for this prototype. Keep code explicit and readable. Write
tests first for logic. Documentation, comments, and commit messages use American
spelling, avoid contractions, and prefer prose when that is clearer than lists.

Deferred refactor targets are not prototype scope: Shared First CSS, `@property`
token registration, a native-element-first component audit, multi-user auth and
data modeling, and a Postgres or Supabase store swap.

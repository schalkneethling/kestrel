# Project Goal

## North Star

Give one job seeker a dependable, low-noise way to follow job postings at
companies they choose: detect new and reposted roles, match them to saved
criteria, and notify them via push notifications.

## Who This Is For

A single user tracking roles at a manually curated list of companies.

## Core Goals

1. Reliably poll Greenhouse, Lever, and Ashby boards and normalize their roles
   behind one interface.
2. Correctly distinguish new, unchanged, reposted, and removed roles using a
   durable role ledger, preserving application memory across reposts and job
   retention purges.
3. Let the user manage companies and criteria, inspect a useful jobs feed, and
   receive actionable push notifications for matching roles.
4. Operate reliably and politely: protect every API route, retain secrets
   outside the repository, isolate ATS failures, respect request limits, and
   make poll outcomes visible.

## Success Looks Like

- The user can add a known supported company board and see its normalized jobs
  in the dashboard after a scheduled or manual poll.
- A new or reposted job that matches saved criteria produces one useful push
  notification, while duplicate deliveries and dead subscriptions are handled
  safely.
- Transient failure from one ATS never marks its jobs removed or prevents other
  companies from completing a poll.
- Removed jobs can be pruned without losing the ledger identity or applied
  state needed to recognize a repost.
- Core domain logic, Worker/D1 behavior, and primary dashboard flows have
  automated coverage.

## Principles And Constraints

- This is a single-user prototype; favor clear, explicit, testable behavior
  over generalized product infrastructure.
- Companies are added manually with a known ATS type and board token.
- The initial supported platforms are Greenhouse, Lever, and Ashby. Unsupported
  platforms remain visible in the dashboard but are never polled.
- The role ledger is durable and is the source of truth for repost identity and
  application state; the prunable jobs table is not.
- Location classification adds display context. Only explicit
  `location_hard_excludes` reject a role.
- Use Cloudflare Workers, D1, React, and web-platform-first implementation
  patterns. Keep core domain code independent of Worker and DOM globals.
- Protect `/api/*` routes with the shared bearer secret. Treat configuration and
  secrets as sensitive operational concerns.

## Non-Goals

- Accounts, roles, multi-tenancy, or authentication/data modeling for multiple
  users.
- Automatic discovery of companies or identification of their ATS platforms.
- Polling Workday, iCIMS, Taleo, SuccessFactors, or other unsupported ATSs in
  the prototype.
- Silent location-based filtering beyond the user's explicit hard excludes.
- Replacing D1 with Postgres or Supabase, or undertaking broad CSS/component
  architecture refactors before the prototype works end to end.

## Current Focus

Complete the remaining E0 foundation, then deliver the implementation plan in
order: D1 data model, ATS adapters and normalization, diff/ledger and criteria
engine, web push, protected API, dashboard, and operational visibility.

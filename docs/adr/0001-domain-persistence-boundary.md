# ADR 0001: Keep Domain Logic Independent From Drizzle and D1

- Status: Accepted
- Date: 2026-07-11

## Context

E1 (data model and migrations) and E2 (ATS adapters and normalization) can be
implemented in parallel, but E3 needs both to agree on job identity and
persistence behavior. Letting adapters use database-shaped records, or letting
the diff engine query Drizzle directly, would couple independent workstreams and
make core logic harder to test.

## Decision

- `packages/core` owns provider-neutral domain types, normalization,
  `sourceKey`, `stableKey`, and the persistence port consumed by the diff
  engine.
- `sourceKey` identifies one observed provider posting: company, ATS platform,
  and provider job ID.
- `stableKey` identifies a durable, company-scoped role across reposts. Its
  pure calculation uses canonical role attributes rather than mutable posting
  details such as URL, description, or provider job ID.
- E2 adapters return provider data and use core normalization. They do not know
  about D1, Drizzle, tables, or SQL.
- E1 owns the Drizzle schema, generated versioned D1 migrations, and the D1
  implementation of the persistence port in `apps/worker`.
- E3 uses normalized core records and the persistence port. It does not query
  Drizzle or D1 directly.
- Drizzle-generated SQL is the sole migration source. A second migration
  mechanism must not be introduced.

## Consequences

- E1 and E2 can use separate worktrees after the core identity and persistence
  contracts are agreed and tested.
- Database rows require explicit translation at the Worker persistence boundary.
- Core domain and engine tests run without a Worker runtime or database.
- D1 integration tests validate the Drizzle repository, migrations, and
  transaction behavior separately from core logic.

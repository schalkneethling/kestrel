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
- `sourceKey` remains unchanged by this decision.
- `stableKey` identifies a durable, company-scoped role across reposts. Its
  version 1 input is the normalized `companyId`, `title`, location scope and
  regions, `department`, and `employmentType`. It excludes mutable posting
  details such as URL, description, timestamps, and provider job ID.
- `companyId` is the canonical persisted company identifier and is encoded
  without normalization. Stable-key strings use this exact serialization:
  `v1|company=<value>|title=<value>|location=<value>|department=<value>|employment=<value>`.
  Each role attribute is normalized with Unicode NFKC, trimmed, lowercased with
  `toLowerCase()`, and has runs of whitespace, hyphens, and underscores replaced
  by one space. Each serialized value is encoded with `encodeURIComponent()`.
- Location is `scope:region1,region2` when normalized regions are available;
  regions are normalized, deduplicated, and sorted lexicographically. Otherwise
  it is `scope:raw-label`. Missing optional values use the literal `~`.
- A missing or empty `companyId` or `title` makes a job invalid: no stable key
  is produced and it must not update ledger state. For conflicting non-empty
  candidate values, the normalizer deduplicates and sorts all candidates, then
  joins them with a comma. Conflicting location scopes use
  `conflict:scope1,scope2`; missing scope uses `unknown`. This prevents an
  adapter from silently choosing a provider-specific winner.

### Stable-Key Vectors

Equivalent inputs:

1. `companyId: company-acme`, `title: Senior Software Engineer`, `scope: remote`,
   `regions: [US, ZA]`, `department: Engineering`, `employmentType: Full Time`
2. `companyId: company-acme`, `title: senior   software engineer`, `scope: REMOTE`,
   `regions: [za, us]`, `department: engineering`, `employmentType: full-time`

Both produce
`v1|company=company-acme|title=senior%20software%20engineer|location=remote%3Aus%2Cza|department=engineering|employment=full%20time`.

Distinct inputs produce distinct identities:

- `companyId: company-acme`, `title: Senior Software Engineer`, `scope: remote`,
  `regions: [US]`, `department: Engineering`, `employmentType: Full Time`
  produces
  `v1|company=company-acme|title=senior%20software%20engineer|location=remote%3Aus|department=engineering|employment=full%20time`.
- `companyId: company-acme`, `title: Senior Software Engineer`, `scope: unknown`,
  `regions: []`, `rawLabel: London`, `department: missing`,
  `employmentType: Full Time` produces
  `v1|company=company-acme|title=senior%20software%20engineer|location=unknown%3Alondon|department=~|employment=full%20time`.

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

# Kestrel

Kestrel is a single-user prototype for tracking job postings across named
companies. It polls supported applicant tracking systems, detects new and
reposted roles, matches them against saved criteria, and sends desktop Chrome
notifications for matches.

The project is intentionally scoped for one user. There is no account system,
multi-tenancy, or automated company-to-ATS discovery in the prototype. Unsupported
ATS platforms are recorded so they are visible in the dashboard, but they are not
polled.

## Current Status

The repository is in early E0 scaffolding. The workspace layout exists, with
plain Vitest coverage for core logic, Workers-pool Vitest coverage for the
Worker and D1, and Playwright coverage for dashboard flows.

## Architecture

The target architecture, data flow, and dependency boundaries are documented in
[docs/architecture.md](docs/architecture.md). The decision to keep domain logic
independent from the Drizzle/D1 persistence implementation is recorded in
[ADR 0001](docs/adr/0001-domain-persistence-boundary.md).

## Workspace

- `packages/core`: platform-agnostic ATS, normalization, diff, and matching
  logic.
- `apps/worker`: Cloudflare Worker API and scheduled poll handler.
- `apps/dashboard`: React and Vite dashboard.
- `docs`: implementation plan and backlog notes.

## Package Manager

Use pnpm 10.33.2.

```sh
pnpm install
pnpm exec playwright install chromium
```

## Scripts

```sh
pnpm dev
pnpm build
pnpm test
pnpm test:e2e
pnpm run lint
pnpm run format:check
pnpm run actionlint
pnpm run zizmor
pnpm run quality
```

`actionlint` and `zizmor` are run through `uvx` with pinned versions. Install
[uv](https://docs.astral.sh/uv/getting-started/installation/) before running
the workflow checks locally. They skip cleanly when the repository has no
`.github/workflows` directory yet.

## Configuration And Secrets

Configuration is described in `.env.schema` and loaded with Varlock. The schema is safe for agents to read because it documents names, types, sensitivity, and requirements without storing secret values.

Useful commands:

```sh
pnpm run env:validate
pnpm run env:validate:production
pnpm run secrets:scan
```

Sensitive local values belong in git-ignored `.env.local` files as Varlock encrypted values. Use `varlock encrypt --file .env.local` to encrypt plaintext sensitive entries in place, or set a value to `varlock(prompt)` and run `pnpm run env:validate` to let Varlock prompt and rewrite it securely.

Production secrets remain in Cloudflare and are deployed through Varlock's Cloudflare integration. Use `varlock-wrangler deploy` instead of plain `wrangler deploy` once deployment is wired.

Generate the VAPID pair once, then provision its private half after Wrangler is authenticated:

```sh
pnpm run vapid:generate
pnpm run vapid:provision
```

Generation writes the public key to `.env` and an encrypted Varlock reference to `.env.local`. Both files are local and git-ignored. The public key is safe to share, but this prototype keeps it local beside the device-local encrypted private-key reference. That reference can only be decrypted on the device that created it, so keep an appropriate external recovery copy before relying on push delivery.

The private key is sent to Varlock and Wrangler only through standard input and is never printed, placed in command arguments, or inherited by the Wrangler child process. Generation refuses to replace an existing pair; `pnpm run vapid:generate -- --rotate` is intentionally required because rotation invalidates existing push subscriptions. Once subscriptions exist, do not use this one-step rotation. Introduce versioned old and new bindings, publish the new public key, migrate client subscriptions while retaining the old private key, and retire the old pair only after migration.

Provisioning targets only the root `kestrel` Worker because no named Wrangler environments are configured. Pass `--profile NAME` after `--` when needed; `--env` is rejected. The command confirms an existing `kestrel` deployment before uploading, then verifies the name-only `VAPID_PRIVATE_KEY` listing afterward. Provisioning can be retried with the encrypted local pair after a clear failure. If the upload result is ambiguous, a name-only listing cannot prove which private value is active; inspect the deployed Worker version and do not retry automatically. Cloudflare's `wrangler secret put` creates and immediately deploys a new Worker version, so confirm the account and Worker before running it.

## Local Worker And D1

Local Worker and D1 setup:

```sh
pnpm db:migrate:local
pnpm worker:dev
curl http://127.0.0.1:8787/api/health
```

## Prototype Stack

- Cloudflare Workers and Cron Triggers.
- Cloudflare D1, with Drizzle as the Worker persistence and migration tool.
- React 19 and Vite.
- Tailwind v4 and shadcn/ui for the dashboard when UI work begins.
- Vitest for unit tests and Workers-pool integration tests.
- Playwright for dashboard flows.
- Varlock for configuration and secret handling.

## License

MIT

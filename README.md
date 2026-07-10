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
```

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

## Local Worker And D1

Local Worker and D1 setup:

```sh
pnpm db:migrate:local
pnpm worker:dev
curl http://127.0.0.1:8787/api/health
```

## Prototype Stack

- Cloudflare Workers and Cron Triggers.
- Cloudflare D1.
- React 19 and Vite.
- Tailwind v4 and shadcn/ui for the dashboard when UI work begins.
- Vitest for unit tests and Workers-pool integration tests.
- Playwright for dashboard flows.
- Varlock for configuration and secret handling.

## License

MIT

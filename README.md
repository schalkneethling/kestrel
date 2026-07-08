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

The repository is in early E0 scaffolding. The workspace layout exists, the core
package has an executable Vitest test, and the Worker and dashboard apps have
minimal stubs.

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
```

## Scripts

```sh
pnpm dev
pnpm build
pnpm test
pnpm run lint
pnpm run format:check
```

## Prototype Stack

- Cloudflare Workers and Cron Triggers.
- Cloudflare D1.
- React 19 and Vite.
- Tailwind v4 and shadcn/ui for the dashboard when UI work begins.
- Vitest for unit and integration tests.
- Playwright for dashboard flows when E0 test harness work lands.
- Varlock for configuration and secret handling.

## License

MIT

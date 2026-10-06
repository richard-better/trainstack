# trainstack

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Astro, Hono, ORPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Astro** - The web framework for content-driven websites
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **Cloudflare D1** - Database engine
- **Authentication** - Better-Auth
- **Vite+** - Unified Vite toolchain, workspace task runner, linting, and formatting

## Getting Started

Install [mise](https://mise.jdx.dev/) and run `mise install` from the repository root to install the pinned Node.js and Bun versions. With mise activated in your shell, install the dependencies:

```bash
bun install
```

If your shell does not activate mise automatically, run project commands with `mise exec --`, for example `mise exec -- bun install`.

## Database Setup

This project uses Cloudflare D1 (SQLite) with Drizzle ORM.

Runtime database access uses the Cloudflare `DB` binding from `hosted-infra/alchemy.run.ts`. The database and auth implementation live inside the hosted API app.

Alchemy provisions the D1 database and applies migrations during `deploy`.

1. Generate migration files:

```bash
bun run db:generate
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:4321](http://localhost:4321) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

## Deployment

The Cloudflare infrastructure lives in [`hosted-infra/alchemy.run.ts`](hosted-infra/alchemy.run.ts). Alchemy manages the marketing and API Workers, D1 database and migrations, Astro session KV namespace, and custom domains with DNS/TLS. Optional Axiom resources live in [`hosted-infra/observability.ts`](hosted-infra/observability.ts), in their own stack. Deployment state is stored remotely with `Cloudflare.state()`, shared by local deployments and CI.

Production uses `trainstackhq.com` for the frontend and `api.trainstackhq.com` for the API. Alchemy supplies the frontend API URL, API auth URL, and trusted frontend origin. Non-production stages use local or `workers.dev` URLs. The production D1 database is retained when removed from the stack or destroyed; Alchemy stops tracking a retained resource, so preserve its ID before a teardown.

[`Check and deploy`](.github/workflows/deploy.yml) checks pull requests targeting `main`. Every push to `main`, including a merged pull request, runs checks, Workers/D1 integration tests, and the backend build before deploying the complete `production` stack. Production deployments are serialized, running deployments are not cancelled, and older revisions are skipped if `main` has advanced. A manual workflow run is also supported from `main`.

If `AXIOM_TOKEN` is missing, the frontend, API, and database still deploy with Cloudflare Workers Logs. Adding the token enables Axiom on the next deployment. Removing it later skips the Axiom stack without deleting its resources or state.

See [`docs/deployment.md`](docs/deployment.md) for account-token permissions, GitHub production secrets, initial setup, migration and recovery procedures.

```bash
bun run plan:production
bun run deploy:production
```

## Git Hooks and Formatting

- Optional native Vite+ hooks: `bun run hooks:setup`
- Docs: [Vite+ commit hooks](https://viteplus.dev/guide/commit-hooks)
- Run checks: `bun run check`

## Project Structure

```
trainstack/
├── hosted-apps/
│   ├── api/         # API Worker, auth, and database (Hono, oRPC, Drizzle)
│   └── marketing/   # Website (Astro)
├── packages/
│   ├── hosted-contract/  # Shared API contract and types
│   └── config/          # Shared TypeScript configuration
└── hosted-infra/        # Cloudflare infrastructure (Alchemy)
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:generate`: Generate database migrations
- `bun run check`: Run Vite+ format/lint checks and workspace TypeScript checks
- `bun run test`: Exercise the API and committed migrations in Cloudflare's local Workers/D1 runtime
- `bun run plan:production`: Preview production infrastructure changes with configured provider credentials
- `bun run deploy:production`: Deploy the complete production stack with configured provider credentials
- `bun run lint`: Run Vite+ lint checks
- `bun run format`: Run Vite+ formatting
- `bun run staged`: Run Vite+ checks against staged files
- `bun run hooks:setup`: Install Vite+ native Git hooks with `vp config`

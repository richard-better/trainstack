# TrainStack

TrainStack is an open source training app for serious amateur athletes. Today it is
**TrainStack Ride**, an indoor cycling app for iPhone, iPad, Mac and Apple Watch: pick a
structured workout, Ride sets your smart trainer's resistance for every interval, and it saves
the ride as a standard `.fit` file you can send to Strava.

![The Today screen suggests workouts that fit the time you have](docs/images/ride-today.png)

![The player runs a structured workout in ERG mode](docs/images/ride-player.png)

![History shows each ride with its power, heart rate and zones](docs/images/ride-history.png)

## Where it is going

Training is split across many apps today: one records, one plans, one tracks recovery, one
runs indoor sessions, and none of them sees the whole athlete. The long-term goal is the whole
training stack in one app: tracking across sports, plans generated from your goals and kept up
to date as life happens, recovery from sleep and wearable data, training scheduled around your
calendar, sharing with friends, and tools for coaches and clubs. Ride comes first because it is
useful on its own, and every ride produces the structured data the rest builds on. See
[the thesis](docs/THESIS.md) for more.

## Current state

Ride is an early alpha. See [the alpha guide](docs/ride-alpha.md) for what works, what does
not yet, and what to test first.

- Ride works without an account. Rides and settings stay on your device.
- You can create a TrainStack account with Sign in with Apple, and link it to Strava to send
  rides there.
- The Strava connection is limited to 10 users for now, so linking may not be available to you
  yet.

## Use at your own risk

TrainStack is experimental software, and everything you do with it is at your own risk. There
is no privacy policy or terms of service yet. They are coming, but until they exist, do not
rely on TrainStack for anything you cannot afford to lose, and export rides you want to keep.

## Contributing

If you want to help, please [open an issue](https://github.com/richard-better/trainstack/issues/new)
and say what you would like to work on, or report a Ride bug with the
[Ride bug report](https://github.com/richard-better/trainstack/issues/new?template=ride-bug.yml).
See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a pull request.

## Development

Ride lives in [`apps/ride`](apps/ride): see [`apps/ride/AGENTS.md`](apps/ride/AGENTS.md) to
build it and [the release guide](docs/ride-release.md) to ship a TestFlight build. The rest of
this README covers the hosted website, API and account app, which were started from
[Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack).

### Stack

- **TypeScript** - For type safety and improved developer experience
- **Astro** - The web framework for content-driven websites
- **TanStack Start** - The account application framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **Cloudflare D1** - Database engine
- **Authentication** - Better-Auth
- **Vite+** - Unified Vite toolchain, workspace task runner, linting, and formatting

### Getting Started

Install [mise](https://mise.jdx.dev/) and run `mise install` from the repository root to install the pinned Node.js and Bun versions. With mise activated in your shell, install the dependencies:

```bash
bun install
```

If your shell does not activate mise automatically, run project commands with `mise exec --`, for example `mise exec -- bun install`.

### Database Setup

This project uses Cloudflare D1 (SQLite) with Drizzle ORM.

Runtime database access uses the Cloudflare `DB` binding from `hosted/infra/alchemy.run.ts`. The database and auth implementation live inside the hosted API app.

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
The account app is running at [http://localhost:3001](http://localhost:3001). To run its placeholder independently of the infrastructure, use `bun run --cwd hosted/apps/account dev:bare`.

### Environment Configuration

Each app that uses environment variables owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `bun run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

The account placeholder has no environment variables yet.

Import the generated `ENV` accessor in application code. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

Run standalone Node/Bun tools that use Varlock from the owning app directory so they load that app's schema and env files. `env:generate` only generates TypeScript files; it does not initialize environment values in a subsequent command.

### Deployment

The Cloudflare infrastructure lives in [`hosted/infra/alchemy.run.ts`](hosted/infra/alchemy.run.ts). Alchemy manages the marketing, account, and API Workers, D1 database and migrations, Astro session KV namespace, and custom domains with DNS/TLS. Optional Axiom resources live in [`hosted/infra/observability.ts`](hosted/infra/observability.ts), in their own stack. Deployment state is stored remotely with `Cloudflare.state()`, shared by local deployments and CI.

Production uses `trainstackhq.com` for marketing, `account.trainstackhq.com` for the account app, and `api.trainstackhq.com` for the API. The account app currently serves only a placeholder homepage. Alchemy supplies the frontend API URL, API auth URL, and trusted frontend origin. Non-production stages use local or `workers.dev` URLs. The production D1 database is retained when removed from the stack or destroyed; Alchemy stops tracking a retained resource, so preserve its ID before a teardown.

[`Check and deploy`](.github/workflows/deploy.yml) checks pull requests targeting `main`. Every push to `main`, including a merged pull request, runs checks, Workers/D1 integration tests, and application builds before deploying the complete `production` stack. Production deployments are serialized, running deployments are not cancelled, and older revisions are skipped if `main` has advanced. A manual workflow run is also supported from `main`.

If `AXIOM_TOKEN` is missing, the frontend, API, and database still deploy with Cloudflare Workers Logs. Adding the token enables Axiom on the next deployment. Removing it later skips the Axiom stack without deleting its resources or state.

See [`docs/deployment.md`](docs/deployment.md) for account-token permissions, GitHub production secrets, initial setup, migration and recovery procedures.

```bash
bun run plan:production
bun run deploy:production
```

### Git Hooks and Formatting

- Optional native Vite+ hooks: `bun run hooks:setup`
- Docs: [Vite+ commit hooks](https://viteplus.dev/guide/commit-hooks)
- Run checks: `bun run check`

### Project Structure

```
trainstack/
├── hosted/              # FSL-1.1-ALv2: everything that runs trainstackhq.com
│   ├── apps/
│   │   ├── account/     # Account app placeholder (TanStack Start)
│   │   ├── api/         # API Worker, auth, and database (Hono, oRPC, Drizzle)
│   │   └── marketing/   # Website (Astro)
│   └── infra/           # Cloudflare infrastructure (Alchemy)
└── packages/            # AGPL-3.0 unless a package has its own LICENSE
    ├── contract/        # Shared API contract and types (Apache-2.0)
    └── config/          # Shared TypeScript configuration (Apache-2.0)
```

The hosted API uses [oRPC contract-first](https://v1.orpc.dev/docs/contract-first/define-contract).
`packages/contract/src/index.ts` defines the shared output schemas, errors, and client type.
`hosted/apps/api/src/router.ts` implements that contract and owns authentication middleware;
its request context comes from the API's Better Auth implementation. Marketing uses Better Auth
for authentication and has no oRPC dependency. API consumers can import the contract's client type.
Add API endpoints to the contract first, then implement them in the API router.

### Available Scripts

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

## License

TrainStack is open source under AGPL-3.0. The hosted backend in `hosted/` is source-available under FSL-1.1-ALv2, and packages that other code builds on, like the API contract, are explicitly Apache-2.0. See [LICENSING.md](LICENSING.md).

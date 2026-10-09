# Cloudflare deployment

## Infrastructure

Alchemy is the single infrastructure owner. Keep Cloudflare infrastructure in `hosted/infra/alchemy.run.ts` and optional Axiom infrastructure in `hosted/infra/observability.ts`; do not add a separate Wrangler or Terraform deployment of the same resources. The deployment manages:

- TanStack Start account Worker at `account.trainstackhq.com`, serving a placeholder homepage. Alchemy builds it through `Cloudflare.Website.Vite` and manages the custom domain and TLS.
- API Worker at `api.trainstackhq.com`, with a `DB` binding to D1 and a secret Better Auth signing key.
- Astro Worker served at `trainstackhq.com` by a `trainstackhq.com/*` route over the existing proxied DNS records, with the API URL, session KV, and Images binding.
- Committed Drizzle migrations before the API Worker update.
- When configured, Axiom dataset `trainstack-production-logs` and a dataset-scoped ingest token injected into both applications.
- Shared Cloudflare state storage, using a Worker, Durable Object, and Secrets Store for encrypted state and authentication.

Stack names `trainstack` and `trainstack-observability`, stage `production`, and logical resource IDs are persistent identities. Both stacks use the same remote Cloudflare state backend. Preserve them across deployments. Compatibility is pinned to `2026-07-30`; update it deliberately and test against the Workers runtime.

## Production credentials

Cloudflare account: `Anthropo`, ID `01cc6559c6f0e531712c9262c70af1b1`. The existing zone is `trainstackhq.com`, ID `cca15ce40d2768f89ee5664dd5c97e07`.

Create an **account-owned** API token from [this account's token settings](https://dash.cloudflare.com/01cc6559c6f0e531712c9262c70af1b1/api-tokens), named `Trainstack production GitHub Actions`. Do not use a user token or global API key.

| Scope                   | Permission               |
| ----------------------- | ------------------------ |
| Anthropo account        | Workers Scripts Write    |
| Anthropo account        | D1 Write                 |
| Anthropo account        | Workers KV Storage Write |
| Anthropo account        | Secrets Store Write      |
| Anthropo account        | Account Settings Read    |
| Only `trainstackhq.com` | Zone Read                |
| Only `trainstackhq.com` | Workers Routes Write     |

Workers Scripts Write lets Alchemy upload and deploy Worker scripts. Zone Read lets Alchemy discover this zone. Workers Routes Write, scoped to `trainstackhq.com`, lets it attach the API and account custom domains and the apex Worker route. No DNS write, API-token administration, or unrelated product permissions are required. The account grants cover resources created during deployment, including Alchemy's state Worker. Cloudflare does not limit those account-wide grants to this project; consider a dedicated Cloudflare account if stronger isolation is needed. See [Cloudflare's Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/), [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/), and the [Alchemy CI guide](https://alchemy.run/cloudflare/tutorial/part-5/).

Use a one-year expiry and rotate before it expires. Leave IP filtering unrestricted because GitHub-hosted runner addresses vary. Review the configuration yourself, create the token, and paste its value directly into GitHub. Do not paste secrets into chat, repository files, or command arguments.

Open [GitHub's environment settings](https://github.com/richard-better/trainstack/settings/environments) and select `production`. Restrict deployment branches to `main` and configure:

| Kind               | Name                    | Value                                                                         |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------- |
| Variable           | `CLOUDFLARE_ACCOUNT_ID` | `01cc6559c6f0e531712c9262c70af1b1`                                            |
| Secret             | `CLOUDFLARE_API_TOKEN`  | The account-owned token                                                       |
| Secret             | `BETTER_AUTH_SECRET`    | A stable random secret of at least 32 characters                              |
| Variable, optional | `STRAVA_CLIENT_ID`      | The client ID of the TrainStack Ride Strava API application                   |
| Secret, optional   | `STRAVA_CLIENT_SECRET`  | The client secret of the same Strava API application                          |
| Secret, optional   | `AXIOM_TOKEN`           | An Axiom provisioning token with dataset and API-token management permissions |
| Variable, optional | `AXIOM_ORG_ID`          | The target Axiom organization ID, if the token requires one                   |

Without `AXIOM_TOKEN`, deployment skips the Axiom stack and both applications emit logs to Cloudflare Workers Logs. Adding the secret enables Axiom on the next deployment. If it is later removed, the Axiom stack and its state remain untouched, while application log forwarding is disabled. A supplied but invalid token or a failed Axiom deployment remains an error; it is not silently ignored.

The Axiom provisioning token is used by CI; application Workers receive only the ingest token Alchemy creates. Keep `BETTER_AUTH_SECRET` stable across deployments to preserve existing sessions. If generating it locally, send it straight to GitHub without printing it:

```bash
openssl rand -base64 48 | gh secret set BETTER_AUTH_SECRET --env production --repo richard-better/trainstack
```

To enter a token without putting it into a command argument, use GitHub's secret form or `gh secret set CLOUDFLARE_API_TOKEN --env production --repo richard-better/trainstack` and its interactive input.

### Strava application

These optional credentials let the API Worker sign Ride in to Strava so it can upload rides. Register **TrainStack Ride** at [Strava API settings](https://www.strava.com/settings/api) with authorization callback domain `api.trainstackhq.com` (no scheme or path). Use a square PNG rendered from `hosted/apps/marketing/public/trainstack-logo.svg` as the icon. A Strava subscription is currently required to create an app, and an account can have only one API application.

Riders connect Strava to their TrainStack account, and the API uploads their rides for them. Everything but the callback needs the rider's session token as `Authorization: Bearer <token>`; the app gets that token by signing in (Sign in with Apple, or email and password), and `hosted/apps/api/src/strava/index.ts` serves:

- `POST /strava/connect` takes `{ "code_challenge": "<SHA-256 of a secret verifier, base64url>" }` and returns the Strava address to open in a web authentication session, with signed state. It asks only for the `activity:write` scope.
- `GET /strava/callback` (called by Strava's page) keeps the rider's tokens, encrypted, against that sign-in and redirects to `trainstackride://strava?connected=1`, or `?error=` (`access_denied`, `insufficient_scope`, `exchange_failed` or `strava_not_configured`). Nothing secret is in the redirect, and it connects nothing by itself.
- `POST /strava/connect/complete` takes `{ "code_verifier": "..." }`, the verifier behind the challenge, and turns the finished sign-in into the account's connection. Only the app that started the sign-in has the verifier, so a state that leaks cannot be used to link someone else's Strava to an account.
- `GET /strava` returns `{ connected, athleteName }`, and `DELETE /strava` tells Strava and forgets the tokens.
- `POST /strava/uploads?name=&fileName=` takes the FIT file as the body (up to 10 MB, read as a stream and never buffered past the limit), hands it to Strava as an indoor trainer ride and returns `{ id, status }`. `GET /strava/uploads/:id` returns `status` `processing`, `ready` (with `activityId`) or `error` (with `error`, and `duplicateOf` when Strava already has the ride).

Strava allows the whole app 200 requests per 15 minutes and counts them by athlete, so the API keeps its own budgets in the `strava_budget` table: 30 requests per athlete (each request to Strava counts, including a token refresh and a retry behind a single call), 10 starts of connecting per account, and 60 code exchanges for the whole app. They are taken in one statement, so requests that arrive together cannot exceed them, and they belong to the Strava athlete rather than the account, so extra accounts do not add budget. A Strava athlete is connected to one account at a time, and no one else can take it: another account that connects the same athlete gets `409 athlete_in_use` until the first disconnects. Only accounts made with Sign in with Apple can start connecting (`403 apple_account_required` otherwise), because email accounts are free to make in bulk and every sign-in costs Strava's shared limits. A sign-in gets one try with Strava, whatever its callback carries. Anything over a budget gets `429 rate_limited`. The app checks an upload every three seconds at most.

Failures are `409 not_connected` (no connection, or the rider revoked Ride in Strava, which also forgets it), `429 rate_limited` and `502 strava_unavailable`.

Tokens are stored in the `strava_connection` table, encrypted with AES-GCM under a key derived from `BETTER_AUTH_SECRET`, so a copy of the database is no use on its own. Changing that secret signs everyone out and makes riders connect Strava again. Deleting an account deletes its connection.

Sign in with Apple needs no secret: the app sends the identity token Apple gives it and the API checks it against Apple's keys, with the bundle ID `com.trainstackhq.ride` as the audience. Enable the Sign in with Apple capability on that App ID. Revoking a rider's Apple tokens on account deletion, which App Review also expects once Ride ships on the App Store, is not done yet.

The workflow passes the GitHub `production` variable and secret to Alchemy through `hosted/infra/.env.schema`. The API receives a plain ID binding and a redacted secret binding, accessed through `ENV.STRAVA_CLIENT_ID` and `ENV.STRAVA_CLIENT_SECRET` from `hosted/apps/api/src/env.server.ts`. Missing values default to empty strings so deployment works before registration. Configure both before enabling Strava features.

```bash
gh variable set STRAVA_CLIENT_ID --env production --repo richard-better/trainstack --body '<CLIENT_ID>'
gh secret set STRAVA_CLIENT_SECRET --env production --repo richard-better/trainstack
```

The second command prompts for the client secret without putting it in shell history. For rotation, rotate the secret in Strava's API settings, replace the GitHub secret, and redeploy the current `main` revision. Update the ID too if replacing the application. For local deployment, use the ignored `hosted/apps/api/.env`.

New apps start with only their owner's athlete account and default overall limits of 200 requests per 15 minutes and 2,000 per day. Strava now offers a self-service dashboard upgrade to 10 athletes, with overall limits of 400 per 15 minutes and 4,000 per day. Further capacity requires the [Developer Program review form](https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8), including screenshots of every place Strava data appears and the **Connect with Strava** button. Follow the [brand guidelines](https://developers.strava.com/guidelines/) for the button and **Powered by Strava** attribution (the guidelines also allow **Compatible with Strava**). Capacity and rate increases are subject to review and are not guaranteed; see [rate limits](https://developers.strava.com/docs/rate-limits/) and [getting started](https://developers.strava.com/docs/getting-started/). Uploads need the OAuth scope [`activity:write`](https://developers.strava.com/docs/authentication/).

## First deployment

1. Confirm the domain zone is active in this account and `trainstackhq.com` has a proxied DNS record. The apex Worker route uses the existing proxied records, so keep at least one in place. The API and account Workers use custom domains at `api.trainstackhq.com` and `account.trainstackhq.com`; resolve any conflicting records for those exact hostnames before deployment. Alchemy creates their domain records and TLS certificates.
2. Add the required Cloudflare credentials and auth secret above; Axiom is optional. GitHub deployment approvals are optional; requiring them pauses otherwise automatic deploys.
3. Merge the workflow and infrastructure changes into `main`. The workflow deploys automatically, bootstrapping Alchemy's state store if absent using `--yes --no-input`. No local state artifact or separate Alchemy password is needed.
4. The workflow verifies the API's `/health` endpoint, marketing homepage, and account homepage title. Initial DNS/certificate propagation is retried; if it exceeds the retry window, check Cloudflare's domain status and re-run the workflow.

For a local plan or deployment, configure Cloudflare using `cd hosted/infra && bunx alchemy profile edit`, and put the same auth signing secret in the ignored `hosted/apps/api/.env`. Use the same Cloudflare account and `production` stage as CI. Run `bun run plan:production` before `bun run deploy:production`. Avoid running a local production deploy while GitHub is deploying; CI concurrency cannot serialize your laptop.

`bun run deploy:production` runs `hosted/infra/deploy.ts`. A nonempty `AXIOM_TOKEN` enables Axiom automatically. To use Axiom credentials stored in an Alchemy profile, configure that profile and set `AXIOM_ENABLED=true` when invoking deployment. `AXIOM_ENABLED=false` explicitly disables forwarding and skips the Axiom stack. The wrapper deploys `axiom.run.ts` before the Cloudflare stack and passes the enabled setting to both processes.

To preview Axiom changes, run `bunx alchemy plan --config axiom.run.ts --stage production` from `hosted/infra`. After the Axiom stack has been deployed, use `AXIOM_ENABLED=true bun run plan:production` to preview Cloudflare with its shared Axiom outputs. A plain `bun run plan:production` previews Cloudflare without Axiom.

## Database changes

Edit `hosted/apps/api/src/db/schema`, run `bun run db:generate`, and commit the generated SQL **and** snapshots under `hosted/apps/api/src/db/migrations`. Do not generate migrations in CI. Alchemy applies pending migrations and tracks them in `__alchemy_migrations`; it detects changed or missing migration history. Do not run `drizzle-kit migrate` or Wrangler migrations against a database managed by this stack.

Use changes compatible with the currently running API because migrations run before its replacement. Add new columns/tables first, deploy code using them, and remove obsolete schema in a later release. A failed deployment can leave successfully applied migrations in place.

Run `bun run check`, `bun run test`, and `bun run build` before merging. Tests exercise deployment orchestration with and without Axiom, and bundle the actual API to execute committed SQL, authentication, health, and CORS behavior in local Workers/D1. The check job builds the account app before deployment. Alchemy builds the Astro and TanStack Start applications for Cloudflare during deployment. The account app uses the existing compatibility settings, runs on port 3001 in `alchemy dev`, and uses a `workers.dev` URL outside production. Run `bun run --cwd hosted/apps/account dev:bare` for standalone development without Cloudflare credentials.

## Recovery

For an application regression, revert the application commit on `main` and let CI redeploy. Old workflow revisions are intentionally skipped, so use a revert commit instead of re-running an old revision. Reverting application code does not reverse database migrations; fix schema issues with a new forward migration. Use D1 Time Travel for a data recovery incident after checking the affected database and restore point.

The production database has a retain removal policy. This prevents Alchemy from deleting it during replacement or teardown, but the state row is still removed. Do not use `destroy` to roll back an application release. Preserve database IDs and state access before deliberate infrastructure removal.

If deployment fails, inspect the Actions job and Alchemy plan, correct the configuration or code, and rerun the current `main` workflow. Do not delete shared state or use broad adoption to hide a failed deploy.

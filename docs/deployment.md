# Cloudflare deployment

## Infrastructure

Alchemy is the single infrastructure owner. Keep Cloudflare infrastructure in `hosted-infra/alchemy.run.ts` and optional Axiom infrastructure in `hosted-infra/observability.ts`; do not add a separate Wrangler or Terraform deployment of the same resources. The deployment manages:

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

Workers Scripts Write lets Alchemy upload and deploy Worker scripts. Zone Read lets Alchemy discover this zone. Workers Routes Write, scoped to `trainstackhq.com`, lets it attach the API custom domain and the apex Worker route. No DNS write, API-token administration, or unrelated product permissions are required. The account grants cover resources created during deployment, including Alchemy's state Worker. Cloudflare does not limit those account-wide grants to this project; consider a dedicated Cloudflare account if stronger isolation is needed. See [Cloudflare's Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/), [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/), and the [Alchemy CI guide](https://alchemy.run/cloudflare/tutorial/part-5/).

Use a one-year expiry and rotate before it expires. Leave IP filtering unrestricted because GitHub-hosted runner addresses vary. Review the configuration yourself, create the token, and paste its value directly into GitHub. Do not paste secrets into chat, repository files, or command arguments.

Open [GitHub's environment settings](https://github.com/richard-better/trainstack/settings/environments) and select `production`. Restrict deployment branches to `main` and configure:

| Kind               | Name                    | Value                                                                         |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------- |
| Variable           | `CLOUDFLARE_ACCOUNT_ID` | `01cc6559c6f0e531712c9262c70af1b1`                                            |
| Secret             | `CLOUDFLARE_API_TOKEN`  | The account-owned token                                                       |
| Secret             | `BETTER_AUTH_SECRET`    | A stable random secret of at least 32 characters                              |
| Secret, optional   | `AXIOM_TOKEN`           | An Axiom provisioning token with dataset and API-token management permissions |
| Variable, optional | `AXIOM_ORG_ID`          | The target Axiom organization ID, if the token requires one                   |

Without `AXIOM_TOKEN`, deployment skips the Axiom stack and both applications emit logs to Cloudflare Workers Logs. Adding the secret enables Axiom on the next deployment. If it is later removed, the Axiom stack and its state remain untouched, while application log forwarding is disabled. A supplied but invalid token or a failed Axiom deployment remains an error; it is not silently ignored.

The Axiom provisioning token is used by CI; application Workers receive only the ingest token Alchemy creates. Keep `BETTER_AUTH_SECRET` stable across deployments to preserve existing sessions. If generating it locally, send it straight to GitHub without printing it:

```bash
openssl rand -base64 48 | gh secret set BETTER_AUTH_SECRET --env production --repo richard-better/trainstack
```

To enter a token without putting it into a command argument, use GitHub's secret form or `gh secret set CLOUDFLARE_API_TOKEN --env production --repo richard-better/trainstack` and its interactive input.

## First deployment

1. Confirm the domain zone is active in this account and `trainstackhq.com` has a proxied DNS record. The apex Worker route uses the existing proxied records, so keep at least one in place. The API Worker uses a custom domain at `api.trainstackhq.com`; resolve any conflicting records for that exact hostname before deployment.
2. Add the required Cloudflare credentials and auth secret above; Axiom is optional. GitHub deployment approvals are optional; requiring them pauses otherwise automatic deploys.
3. Merge the workflow and infrastructure changes into `main`. The workflow deploys automatically, bootstrapping Alchemy's state store if absent using `--yes --no-input`. No local state artifact or separate Alchemy password is needed.
4. The workflow verifies the API's `/health` endpoint and frontend homepage. Initial DNS/certificate propagation is retried; if it exceeds the retry window, check Cloudflare's domain status and re-run the workflow.

For a local plan or deployment, configure Cloudflare using `cd hosted-infra && bunx alchemy profile edit`, and put the same auth signing secret in the ignored `hosted-apps/api/.env`. Use the same Cloudflare account and `production` stage as CI. Run `bun run plan:production` before `bun run deploy:production`. Avoid running a local production deploy while GitHub is deploying; CI concurrency cannot serialize your laptop.

`bun run deploy:production` runs `hosted-infra/deploy.ts`. A nonempty `AXIOM_TOKEN` enables Axiom automatically. To use Axiom credentials stored in an Alchemy profile, configure that profile and set `AXIOM_ENABLED=true` when invoking deployment. `AXIOM_ENABLED=false` explicitly disables forwarding and skips the Axiom stack. The wrapper deploys `axiom.run.ts` before the Cloudflare stack and passes the enabled setting to both processes.

To preview Axiom changes, run `bunx alchemy plan --config axiom.run.ts --stage production` from `hosted-infra`. After the Axiom stack has been deployed, use `AXIOM_ENABLED=true bun run plan:production` to preview Cloudflare with its shared Axiom outputs. A plain `bun run plan:production` previews Cloudflare without Axiom.

## Database changes

Edit `hosted-apps/api/src/db/schema`, run `bun run db:generate`, and commit the generated SQL **and** snapshots under `hosted-apps/api/src/db/migrations`. Do not generate migrations in CI. Alchemy applies pending migrations and tracks them in `__alchemy_migrations`; it detects changed or missing migration history. Do not run `drizzle-kit migrate` or Wrangler migrations against a database managed by this stack.

Use changes compatible with the currently running API because migrations run before its replacement. Add new columns/tables first, deploy code using them, and remove obsolete schema in a later release. A failed deployment can leave successfully applied migrations in place.

Run `bun run check`, `bun run test`, and `bun run build` before merging. Tests exercise deployment orchestration with and without Axiom, and bundle the actual API to execute committed SQL, authentication, health, and CORS behavior in local Workers/D1. Alchemy builds the Astro application during deployment.

## Recovery

For an application regression, revert the application commit on `main` and let CI redeploy. Old workflow revisions are intentionally skipped, so use a revert commit instead of re-running an old revision. Reverting application code does not reverse database migrations; fix schema issues with a new forward migration. Use D1 Time Travel for a data recovery incident after checking the affected database and restore point.

The production database has a retain removal policy. This prevents Alchemy from deleting it during replacement or teardown, but the state row is still removed. Do not use `destroy` to roll back an application release. Preserve database IDs and state access before deliberate infrastructure removal.

If deployment fails, inspect the Actions job and Alchemy plan, correct the configuration or code, and rerun the current `main` workflow. Do not delete shared state or use broad adoption to hide a failed deploy.

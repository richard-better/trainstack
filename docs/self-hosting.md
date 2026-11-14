# Self-hosting TrainStack

This guide runs your own TrainStack: the API, the web app and the website, on your own
Cloudflare account and domain. It is written for a developer who has not seen the repository
before. [The deployment guide](deployment.md) describes how trainstackhq.com itself runs; this
one covers what is different when it is yours.

Read [Sign-in](#sign-in) before you spend money. Today a self-hosted instance cannot sign anyone
in unless you have an Apple Developer Program membership and change three constants in the API.

## What you can run, and under which license

Everything under `hosted/` (the API, the web app, the website and the infrastructure code) is
source-available under [FSL-1.1-ALv2](../hosted/LICENSE.md). Running it for yourself, your club or
your organisation is a permitted use; offering it as a competing product or service is not. Each
version becomes Apache-2.0 two years after its release. The packages it builds on are Apache-2.0,
and the Ride app is AGPL-3.0. See [LICENSING.md](../LICENSING.md).

[TRADEMARKS.md](../TRADEMARKS.md) lets you keep the TrainStack name and logo in an unmodified copy
you run for yourself or your organisation. If you change the code (and today sign-in requires
it) and offer the result to anyone else, replace the name and logos with your own.

## What it runs on

| Part             | What it is                                                                                     | Where               |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------- |
| API              | A Cloudflare Worker, with a scheduled run every minute that summarises and analyses activities | `api.<domain>`      |
| Web app          | A TanStack Start app on a second Worker, where athletes sign in and do everything but record   | `account.<domain>`  |
| Website          | The Astro marketing site on a third Worker, with a KV namespace and an Images binding          | `<domain>`          |
| Database         | One Cloudflare D1 database                                                                     | Your account        |
| Activity files   | One private R2 bucket                                                                          | Your account        |
| Deployment state | Alchemy's state store: a Worker, a Durable Object and two Secrets Store secrets                | Your account        |
| Logs             | Cloudflare Workers Logs, or Axiom if you configure it                                          | Your account        |
| Apps             | Ride for iPhone, iPad, Mac and Apple Watch                                                     | Your own build only |

`hosted/infra/alchemy.run.ts` declares all of it, and [Alchemy](https://alchemy.run) creates it,
applies the database migrations in `hosted/apps/api/src/db/migrations`, builds the web app and
website, and deploys them. Nothing needs a server of your own, and there is no supported way to
run TrainStack outside Cloudflare.

## What you need

- A Mac or Linux machine with `git`, and [mise](https://mise.jdx.dev) or the versions of Bun and
  Node in `mise.toml`.
- A [Cloudflare](https://dash.cloudflare.com/sign-up) account on the **Workers Paid** plan. The
  free plan is not enough: uploads take more CPU than its 10 ms limit, and the API raises its
  subrequest limit for account exports, which only Workers Paid allows.
- A domain whose DNS is on Cloudflare, in the same account.
- For sign-in, an [Apple Developer Program](https://developer.apple.com/programs/) membership.
  See [Sign-in](#sign-in).
- Optionally, a Strava API application and an Axiom account. See [Settings](#settings).

### What it costs

At one athlete's scale, at Cloudflare's prices when this was written:

| Item                    | Cost                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Cloudflare Workers Paid | $5 a month. It includes 10 million requests, D1's first 25 billion rows read and 5 GB, and KV |
| R2                      | Free up to 10 GB stored. A year of daily one-hour activities is well under 1 GB               |
| Images and the cron run | Inside the included amounts: the cron runs about 44,000 times a month                         |
| A domain                | What your registrar charges, typically $10 to $15 a year                                      |
| Apple Developer Program | $99 a year, needed for sign-in                                                                |
| Strava, optional        | Strava asks for a subscription to create an API application                                   |

Check [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) for current numbers.

## Try it on your machine first

This runs the whole stack locally, with a stand-in for Apple, and needs no account of any kind.
It is how you see what you are about to host. It keeps nothing: the database and files live in
memory and are gone when it stops.

```bash
git clone https://github.com/richard-better/trainstack.git
cd trainstack
mise install
bun install --frozen-lockfile
bun run dev:account -- --history
```

When it prints `Open http://localhost:3001 and sign in with Apple`, open that address, press
**Sign in with Apple**, and press **Continue** on the page that plays Apple's part. You reach a
test athlete with 30 weeks of rides and runs, a plan and check-ins. `--empty` starts with no
activities instead. Ports 3000, 3001 and 3002 are used when free; the README lists the options
to choose others. Stop it with Ctrl-C.

The same checkout can run the checks CI runs:

```bash
bun run check
bun run test
bun run build
```

## Sign-in

TrainStack signs athletes in with Sign in with Apple and nothing else. Email and password sign-in
is turned off, and there is no other provider yet (it is on the roadmap as "Sign-in beyond
Apple"). Apple only signs people in to apps registered to an Apple Developer team, and the API
names trainstackhq.com's in `hosted/apps/api/src/auth/apple.ts`:

```ts
export const APPLE_APP_BUNDLE_ID = "com.trainstackhq.ride";
export const APPLE_SERVICES_ID = "com.trainstackhq.ride.web";
export const APPLE_TEAM_ID = "S64PDPJKMJ";
```

So what works depends on what you have:

- **No Apple Developer Program membership.** Nobody can sign in to your instance. The API,
  website and web app deploy and answer, but **Sign in with Apple** ends on an error from
  Apple, because Apple does not let trainstackhq.com's Services ID return to your domain.
  Running the code locally with `bun run dev:account` is the only way to use it.
- **A membership, and those three constants changed to your own identifiers.** The web app
  signs athletes in. Set this up as below.
- **The App Store, TestFlight or Homebrew Ride.** It talks only to `api.trainstackhq.com`
  (`apps/ride/RideKit/Sources/RideStrava/TrainStackClient.swift`), so it cannot use your
  instance. See [Pointing Ride at your server](#pointing-ride-at-your-server).

Changing the constants is a change to the code, so `bun run test` then fails in the tests that
check these identifiers (`tests/app-handoff.test.mjs`, `tests/apple-app-grant.test.mjs` and
`tests/account-data.test.mjs`) until you change them there too.

### Setting up Sign in with Apple for your domain

In [Apple Developer](https://developer.apple.com/account/resources/identifiers/list):

1. Note your Team ID, shown under Membership details.
2. Create an App ID, for example `com.example.trainstack`, with Sign in with Apple enabled. It is
   needed even without an app, because a Services ID is grouped under one.
3. Create a Services ID, for example `com.example.trainstack.web`. Enable Sign in with Apple,
   choose the App ID as its primary App ID, and add the domain `api.<domain>` with the return
   URL `https://api.<domain>/api/auth/callback/apple`.
4. Create a key with Sign in with Apple enabled for that App ID, and download its `.p8` file.
   Apple lets you download it once.
5. In `hosted/apps/api/src/auth/apple.ts`, set `APPLE_TEAM_ID` to your Team ID,
   `APPLE_SERVICES_ID` to the Services ID and `APPLE_APP_BUNDLE_ID` to the App ID.
6. Set `APPLE_SIGN_IN_KEY_ID` and `APPLE_SIGN_IN_PRIVATE_KEY` as in [Settings](#settings).

The API signs a short-lived client secret with the key for every exchange with Apple, so there is
nothing to renew. Deleting an account revokes what Apple granted, as App Review expects.

## Settings

Put the settings in `hosted/infra/.env`, which git ignores. The deploy reads them from there or
from the environment, and checks them against `hosted/infra/.env.schema` and
`hosted/apps/api/.env.schema` before it touches Cloudflare.

| Name                        | Required    | What it is for                                                                                                   | Without it                                                                                                                                                                    |
| --------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRAINSTACK_DOMAIN`         | Yes         | Your domain, such as `example.com`. The website is served there, the web app at `account.` and the API at `api.` | It defaults to `trainstackhq.com`, which is not in your account, so the deploy fails                                                                                          |
| `CLOUDFLARE_ACCOUNT_ID`     | Yes         | The account to deploy to                                                                                         | The deploy stops before doing anything                                                                                                                                        |
| `CLOUDFLARE_API_TOKEN`      | Yes         | An API token for that account, scoped as below                                                                   | The deploy stops before doing anything, unless you use an Alchemy profile instead                                                                                             |
| `BETTER_AUTH_SECRET`        | Yes         | Signs sessions, and derives the key that encrypts Strava and Apple tokens in D1. At least 32 characters          | The deploy refuses: `Value is required but is currently empty`. Changing it later signs everyone out and makes stored tokens unreadable                                       |
| `APPLE_SIGN_IN_KEY_ID`      | For sign-in | The ID of your Sign in with Apple key                                                                            | The web app cannot sign anyone in                                                                                                                                             |
| `APPLE_SIGN_IN_PRIVATE_KEY` | For sign-in | The contents of that key's `.p8` file, in double quotes across its lines                                         | The same                                                                                                                                                                      |
| `STRAVA_CLIENT_ID`          | No          | Your Strava API application's client ID                                                                          | Connecting Strava answers `strava_not_configured`. Only Ride connects Strava today, so leave it out unless you build Ride                                                     |
| `STRAVA_CLIENT_SECRET`      | No          | The same application's client secret                                                                             | The same                                                                                                                                                                      |
| `GITHUB_FEEDBACK_TOKEN`     | No          | Files feedback from Ride as GitHub issues                                                                        | Feedback answers `feedback_not_configured`. **Leave it out:** the API files issues on `richard-better/trainstack`, the public upstream repository, whatever token you give it |
| `AXIOM_TOKEN`               | No          | An Axiom token that can create datasets and API tokens, to send logs to Axiom                                    | Logs go to Cloudflare Workers Logs                                                                                                                                            |
| `AXIOM_ORG_ID`              | No          | Your Axiom organisation, if the token needs one                                                                  | -                                                                                                                                                                             |

`WEB_APP_ORIGIN` is only read outside the `production` stage. Always deploy the `production`
stage: it is the only one that puts the Workers on your domain. Other stages use `workers.dev`
addresses, where the web app and API are different sites, so browsers that block third-party
cookies do not keep the session.

The file holds secrets, so make it readable only by you, then add the secret and the Apple key
without printing them anywhere but the file:

```bash
touch hosted/infra/.env && chmod 600 hosted/infra/.env
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 48)" >> hosted/infra/.env
{ printf 'APPLE_SIGN_IN_PRIVATE_KEY="'; cat AuthKey_ABCDE12345.p8; printf '"\n'; } >> hosted/infra/.env
```

A complete `hosted/infra/.env` looks like this:

```bash
TRAINSTACK_DOMAIN=example.com
CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef
CLOUDFLARE_API_TOKEN=...
BETTER_AUTH_SECRET=...
APPLE_SIGN_IN_KEY_ID=ABCDE12345
APPLE_SIGN_IN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

### The Cloudflare API token

Create an account-owned token in the dashboard under **Manage Account > Account API Tokens**,
with these permissions and nothing else:

| Scope          | Permission               |
| -------------- | ------------------------ |
| Your account   | Workers Scripts Write    |
| Your account   | D1 Write                 |
| Your account   | Workers R2 Storage Write |
| Your account   | Workers KV Storage Write |
| Your account   | Secrets Store Write      |
| Your account   | Account Settings Read    |
| Only your zone | Zone Read                |
| Only your zone | Workers Routes Write     |

[The deployment guide](deployment.md#production-credentials) explains what each one is for.
Instead of a token you can sign Alchemy in to Cloudflare with
`cd hosted/infra && bunx alchemy profile edit` and leave `CLOUDFLARE_API_TOKEN` out.

### Optional: Strava and Axiom

Strava's setup, limits and rotation are in [the deployment guide](deployment.md#strava-application);
use `api.<domain>` as the authorization callback domain. Axiom's are in the same guide's
[first deployment](deployment.md#first-deployment) section.

## Domains

1. Add your domain to Cloudflare and wait until the zone is active.
2. Give the bare domain a proxied DNS record. The website is a Worker route on `<domain>/*`, which
   only receives traffic for a hostname Cloudflare proxies. If nothing else serves the domain,
   an `AAAA` record for `@` pointing at `100::`, proxied, is enough.
3. Leave `account.<domain>` and `api.<domain>` without records. The deploy makes them custom
   domains of their Workers, with their records and certificates. If records exist for those
   exact names, remove them first.

The web app and API must share the domain. The session cookie belongs to `api.<domain>`, and
browsers send it with the web app's requests only because both are the same site.

## First deploy

From the repository root:

```bash
bun run plan:production
```

The plan validates your settings, sets up Alchemy's state store in your account if it is missing,
and lists everything it would create: three Workers, the D1 database, the R2 bucket, the KV
namespace, two custom domains and one route. Read it, then deploy:

```bash
bun run deploy:production
```

The deploy creates the resources, applies every migration to the empty database, builds the web
app and website, and deploys the Workers. It ends by printing the stack's outputs: the three
addresses, the database's ID and name, and the bucket's name. Keep the database and bucket names
for backups.

Then check it:

```bash
curl https://api.<domain>/health
```

answers `{"status":"ok"}`. Open `https://account.<domain>`, sign in with Apple, and the first
sign-in creates your account. New domains can take a few minutes to get their certificates;
re-run the deploy if they have not after half an hour.

Anyone with an Apple ID can make an account on your instance. There is no allow list.

### Deploying from GitHub Actions instead

`.github/workflows/deploy.yml` deploys on every push to `main` once its checks pass. In a fork,
create a `production` environment in the repository's settings with the variables
`TRAINSTACK_DOMAIN`, `CLOUDFLARE_ACCOUNT_ID` and, if you use them, `APPLE_SIGN_IN_KEY_ID`,
`STRAVA_CLIENT_ID` and `AXIOM_ORG_ID`, and the secrets `CLOUDFLARE_API_TOKEN`,
`BETTER_AUTH_SECRET` and, if you use them, `APPLE_SIGN_IN_PRIVATE_KEY`, `STRAVA_CLIENT_SECRET`
and `AXIOM_TOKEN`. The workflow checks the API's health, the website, the web app and the API's
CORS on your domain after each deploy. Do not deploy from your machine while it runs.

## Upgrades

```bash
git pull
bun install --frozen-lockfile
bun run check && bun run test
bun run plan:production
bun run deploy:production
```

If you changed the Apple constants, keep them as a commit of your own and merge upstream into it.

The deploy applies new migrations before it replaces the API, and migrations only go forward.
Take a backup before you upgrade (see below). Each migration is written so the running API keeps
working with the new schema, so a deploy that fails halfway leaves a working instance; fix the
cause and deploy again. To go back to an older version, deploy that revision; if its code cannot
read what a newer migration changed, restore the database to before the upgrade with Time Travel.

The settings in `hosted/infra/.env` persist between upgrades. Keep `BETTER_AUTH_SECRET` the same.

## Backups and restore

D1 and R2 hold everything: the database has the accounts, settings, plans and every number
derived from activities, and the bucket has each activity's original file, under
`activities/<user id>/<activity id>`. Back up both, one after the other, the database first. The
two copies are not one snapshot: an activity uploaded or deleted between them can leave a row
without its file. Take them while nobody is uploading or deleting, which on an instance of your
own is easy to arrange.

Keep `BETTER_AUTH_SECRET` too, somewhere safe outside the machine, such as a password manager. The
database's Strava and Apple tokens are encrypted with a key derived from it. A database restored
under a different secret still works, but everyone is signed out, Strava connections stop working
until you clear them with `DELETE FROM strava_connection` and athletes connect again, and deleting
an account can no longer revoke the Sign in with Apple grant that Ride gave.

The commands use Wrangler, Cloudflare's CLI, through `bunx`. It reads `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` from the environment, not from `hosted/infra/.env`, so export them in the
shell first; the token above is enough. Set `DB` to the database name the deploy printed.

```bash
export CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... DB=...
```

### The database

D1 keeps a point-in-time history for 30 days on Workers Paid, which needs no setup. Before an
upgrade, note where it stands:

```bash
bunx wrangler d1 time-travel info "$DB"
```

and to go back to a moment, or to that bookmark:

```bash
bunx wrangler d1 time-travel restore "$DB" --timestamp=2026-11-14T08:00:00Z
bunx wrangler d1 time-travel restore "$DB" --bookmark=<bookmark>
```

For a copy you keep, export the schema and the rows as two files:

```bash
bunx wrangler d1 export "$DB" --remote --no-data --output schema.sql
bunx wrangler d1 export "$DB" --remote --no-schema --output data.sql
```

Two files, because D1 cannot import a single export of this database into an empty one: the
export inserts rows into a table before the table it refers to exists, and the import stops with
`no such table: main.user`.

To restore them into the stack's database, empty it, then run the schema and the rows. This
deletes everything in the database, so restore only into one you mean to replace:

```bash
bunx wrangler d1 execute "$DB" --remote --json \
  --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC" \
  | jq -r '.[0].results[] | "DROP TABLE \"\(.name)\";"' \
  | (echo "PRAGMA defer_foreign_keys = on;"; cat) > drop.sql
bunx wrangler d1 execute "$DB" --remote --file drop.sql
bunx wrangler d1 execute "$DB" --remote --file schema.sql
bunx wrangler d1 execute "$DB" --remote --file data.sql
```

Tables are dropped newest first, so a table goes before the tables it refers to. The export
includes `__alchemy_migrations`, Alchemy's record of applied migrations, so restore a backup with
the revision of TrainStack that made it, and upgrade afterwards.

### Activity files

R2 has no history of its own, so copy the bucket. [rclone](https://rclone.org) does it through
R2's S3 API. Create an R2 API token with **Object Read & Write** on the bucket under **R2 >
Manage API tokens**. Then run `rclone config` and add a remote named `r2` at its prompts, so the
keys stay out of your shell history: storage `s3`, provider `Cloudflare`, the token's access key
ID and secret access key, and the endpoint `https://<account id>.r2.cloudflarestorage.com`.

Set `BUCKET` to the bucket name the deploy printed. Back up with

```bash
rclone sync "r2:$BUCKET" ./backup/activity-files --backup-dir "./backup/deleted/$(date -u +%F)"
find ./backup/deleted -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} +
```

`sync` makes `./backup/activity-files` match the bucket, and `--backup-dir` moves the files of
activities deleted since the last run into a folder for the day instead of dropping them. Keep
those folders as long as D1 Time Travel can go back, 30 days, so a database restored to before a
deletion can have its files back too; the `find` line removes older ones. So a database export
you keep for longer than 30 days cannot get back the files of activities deleted after it: keep a
dated copy of `./backup/activity-files` with each such export, for as long as you keep the export.
An activity uploaded and deleted between two runs is in no copy at all, so a database restored to
a moment in between has its row without its file.

To restore, set `RESTORE_DATE` to the day of the database's restore point in UTC, as the folders
are named, such as `2026-11-14`, and put back the files and those deleted since that day. For an
export older than 30 days, copy from the dated copy you kept with it instead of
`./backup/activity-files`.

```bash
rclone copy ./backup/activity-files "r2:$BUCKET"
for day in ./backup/deleted/*/; do
  [[ "$(basename "$day")" < "$RESTORE_DATE" ]] && continue
  rclone copy "$day" "r2:$BUCKET"
done
```

Files never change once stored, so a restore only puts back what is missing. A folder is dated by
the backup that found the deletion, not the deletion, and the bucket copy is as of the latest
backup, so a restore can also bring back files of activities the restored database does not have.
Such a file is never read; it only takes space.

### One athlete's copy

Every athlete can download everything TrainStack holds about them from the web app's settings,
as a tar archive with their rows as JSON Lines and every original activity file. It is the most
readable backup, but nothing imports it back yet.

## Pointing Ride at your server

The Ride app on the App Store, TestFlight and Homebrew talks only to `api.trainstackhq.com`, and
there is no setting to change it. To use Ride with your instance, build it yourself: see
[apps/ride/AGENTS.md](../apps/ride/AGENTS.md). In your build:

- Set `TrainStackClient.server` in `apps/ride/RideKit/Sources/RideStrava/TrainStackClient.swift`
  to `https://api.<domain>`.
- Change the bundle identifiers and development team in `apps/ride/Ride.xcodeproj` to your own,
  and give the app's App ID the Sign in with Apple capability. Native Sign in with Apple sends
  the API an identity token for the app's bundle identifier, so `APPLE_APP_BUNDLE_ID` in the API
  must be that identifier.

Ride works without any account too: it records rides, syncs them through the athlete's iCloud and
saves them to Apple Health. That needs no server at all.

## Removing it all

Take the backups you want first. Then, from the repository root:

```bash
bun run --cwd hosted/infra destroy --stage production
```

If you turned on Axiom, also destroy its stack, which holds the dataset and its ingest token:

```bash
cd hosted/infra && bunx alchemy destroy --config axiom.run.ts --stage production
```

The first command deletes the Workers, their custom domains and route, and the KV namespace. It keeps the
database and the bucket, which the `production` stage protects from deletion, and only forgets
them. Delete them yourself:

```bash
bunx wrangler d1 delete "$DB"
rclone purge "r2:$BUCKET"
bunx wrangler r2 bucket delete "$BUCKET"
```

Last, once no stack is left, in the Cloudflare dashboard, delete the `alchemy-state-store` Worker
and its two secrets in the Secrets Store, `AlchemyStateStoreToken` and
`AlchemyStateStoreEncryptionKey`, the API token, and the DNS record you added for the bare domain. In Apple
Developer, delete the key and the Services ID; in Strava, the API application.

## What this guide could not test

The local path above was followed from a fresh clone. The cloud path was checked as far as it
goes without a Cloudflare account: the settings validation (a missing secret, a domain given as
a URL, an empty domain), the token and profile handling up to the first call to Cloudflare, the
build, and the database backup and restore against Wrangler's local D1 with a real athlete's
data. These steps have not been run against a real account: the plan and deploy themselves, the
custom domains and certificates, Sign in with Apple with your own identifiers, the remote
Wrangler and rclone commands (rclone's `sync --backup-dir` and the restore loop were tested between
local folders), and the teardown.

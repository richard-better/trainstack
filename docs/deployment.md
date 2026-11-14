# Cloudflare deployment

## Infrastructure

Alchemy is the single infrastructure owner. Keep Cloudflare infrastructure in `hosted/infra/alchemy.run.ts` and optional Axiom infrastructure in `hosted/infra/observability.ts`; do not add a separate Wrangler or Terraform deployment of the same resources. The deployment manages:

- TanStack Start web app Worker at `account.trainstackhq.com`, where athletes sign in with Apple. Alchemy builds it through `Cloudflare.Website.Vite` with the API's URL as `VITE_SERVER_URL`, and manages the custom domain and TLS.
- API Worker at `api.trainstackhq.com`, with a `DB` binding to D1, an `ACTIVITY_FILES` binding to the private R2 bucket that holds activity files, a Cron Trigger every minute that summarises activities that are due, a secret Better Auth signing key, and the web app's origin as `WEB_APP_ORIGIN`, the only origin it trusts for sign-in and credentialed requests.
- Astro Worker served at `trainstackhq.com` by a `trainstackhq.com/*` route over the existing proxied DNS records, with session KV and an Images binding.
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
| Anthropo account        | Workers R2 Storage Write |
| Anthropo account        | Workers KV Storage Write |
| Anthropo account        | Secrets Store Write      |
| Anthropo account        | Account Settings Read    |
| Only `trainstackhq.com` | Zone Read                |
| Only `trainstackhq.com` | Workers Routes Write     |

Workers Scripts Write lets Alchemy upload and deploy Worker scripts. Zone Read lets Alchemy discover this zone. Workers Routes Write, scoped to `trainstackhq.com`, lets it attach the API and account custom domains and the apex Worker route. No DNS write, API-token administration, or unrelated product permissions are required. The account grants cover resources created during deployment, including Alchemy's state Worker. Cloudflare does not limit those account-wide grants to this project; consider a dedicated Cloudflare account if stronger isolation is needed. See [Cloudflare's Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/), [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/), and the [Alchemy CI guide](https://alchemy.run/cloudflare/tutorial/part-5/).

Use a one-year expiry and rotate before it expires. Leave IP filtering unrestricted because GitHub-hosted runner addresses vary. Review the configuration yourself, create the token, and paste its value directly into GitHub. Do not paste secrets into chat, repository files, or command arguments.

Open [GitHub's environment settings](https://github.com/richard-better/trainstack/settings/environments) and select `production`. Restrict deployment branches to `main` and configure:

| Kind               | Name                        | Value                                                                         |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------- |
| Variable           | `CLOUDFLARE_ACCOUNT_ID`     | `01cc6559c6f0e531712c9262c70af1b1`                                            |
| Secret             | `CLOUDFLARE_API_TOKEN`      | The account-owned token                                                       |
| Secret             | `BETTER_AUTH_SECRET`        | A stable random secret of at least 32 characters                              |
| Variable, optional | `STRAVA_CLIENT_ID`          | The client ID of the TrainStack Ride Strava API application                   |
| Secret, optional   | `STRAVA_CLIENT_SECRET`      | The client secret of the same Strava API application                          |
| Variable, optional | `APPLE_SIGN_IN_KEY_ID`      | The ID of the Sign in with Apple key for Apple's web flow                     |
| Secret, optional   | `APPLE_SIGN_IN_PRIVATE_KEY` | The contents of that key's `.p8` file                                         |
| Secret, optional   | `GITHUB_FEEDBACK_TOKEN`     | A `kes-agent` GitHub token that can open issues on this repository            |
| Secret, optional   | `AXIOM_TOKEN`               | An Axiom provisioning token with dataset and API-token management permissions |
| Variable, optional | `AXIOM_ORG_ID`              | The target Axiom organization ID, if the token requires one                   |

Without `AXIOM_TOKEN`, deployment skips the Axiom stack and both applications emit logs to Cloudflare Workers Logs. Adding the secret enables Axiom on the next deployment. If it is later removed, the Axiom stack and its state remain untouched, while application log forwarding is disabled. A supplied but invalid token or a failed Axiom deployment remains an error; it is not silently ignored.

The Axiom provisioning token is used by CI; application Workers receive only the ingest token Alchemy creates. Keep `BETTER_AUTH_SECRET` stable across deployments to preserve existing sessions. If generating it locally, send it straight to GitHub without printing it:

```bash
openssl rand -base64 48 | gh secret set BETTER_AUTH_SECRET --env production --repo richard-better/trainstack
```

To enter a token without putting it into a command argument, use GitHub's secret form or `gh secret set CLOUDFLARE_API_TOKEN --env production --repo richard-better/trainstack` and its interactive input.

### Strava application

These optional credentials let the API Worker sign Ride in to Strava so it can upload rides. Register **TrainStack Ride** at [Strava API settings](https://www.strava.com/settings/api) with authorization callback domain `api.trainstackhq.com` (no scheme or path). Use a square PNG rendered from `hosted/apps/marketing/public/trainstack-logo.svg` as the icon. A Strava subscription is currently required to create an app, and an account can have only one API application.

Riders connect Strava to their TrainStack account, and the API uploads their rides for them. Everything but the callback requires the rider's session token as `Authorization: Bearer <token>`. Cookies cannot authenticate these routes, including when a bearer token is missing or invalid. The app gets its token through Sign in with Apple, and `hosted/apps/api/src/strava/index.ts` serves:

- `POST /strava/connect` takes `{ "code_challenge": "<SHA-256 of a secret verifier, base64url>" }` and returns the Strava address to open in a web authentication session, with signed state. It asks only for the `activity:write` scope.
- `GET /strava/callback` (called by Strava's page) keeps the rider's tokens, encrypted, against that sign-in and redirects to `trainstackride://strava?connected=1`, or `?error=` (`access_denied`, `insufficient_scope`, `exchange_failed` or `strava_not_configured`). Nothing secret is in the redirect, and it connects nothing by itself.
- `POST /strava/connect/complete` takes `{ "code_verifier": "..." }`, the verifier behind the challenge, and turns the finished sign-in into the account's connection. Only the app that started the sign-in has the verifier, so a state that leaks cannot be used to link someone else's Strava to an account.
- `GET /strava` returns `{ connected, athleteName }`, and `DELETE /strava` tells Strava and forgets the tokens.
- `POST /strava/uploads?name=&fileName=` takes the FIT file as the body (up to 10 MB, read as a stream and never buffered past the limit), hands it to Strava as an indoor trainer ride and returns `{ id, status }`. `GET /strava/uploads/:id` returns `status` `processing`, `ready` (with `activityId`) or `error` (with `error`, and `duplicateOf` when Strava already has the ride).

Strava allows the whole app 200 requests per 15 minutes and counts them by athlete, so the API keeps its own budgets in the `strava_budget` table: 30 requests per athlete (each request to Strava counts, including a token refresh and a retry behind a single call), 10 starts of connecting per account, and 60 code exchanges for the whole app. They are taken in one statement, so requests that arrive together cannot exceed them, and they belong to the Strava athlete rather than the account, so extra accounts do not add budget. A Strava athlete is connected to one account at a time. Another account that connects the same athlete gets `409 athlete_in_use` while Strava still accepts the first one's tokens (checked with a refresh), so a rider cannot be evicted by someone who tricked them into approving. The rider can always take the athlete back by removing Ride in Strava's settings, which makes Strava refuse the holder's tokens, and then connecting again. Only accounts made with Sign in with Apple can start connecting (`403 apple_account_required` otherwise), because email accounts are free to make in bulk and every sign-in costs Strava's shared limits. A sign-in gets one try with Strava, whatever its callback carries. Anything over a budget gets `429 rate_limited`. The app checks an upload every three seconds at most.

Failures are `409 not_connected` (no connection, or the rider revoked Ride in Strava, which also forgets it), `429 rate_limited` and `502 strava_unavailable`.

Tokens are stored in the `strava_connection` table, encrypted with AES-GCM under a key derived from `BETTER_AUTH_SECRET`, so a copy of the database is no use on its own. Changing that secret signs everyone out and makes riders connect Strava again; the stored tokens become unreadable, and the API keeps such a connection rather than hand its athlete to anyone, so clear it with `DELETE FROM strava_connection` in D1 after a rotation. Deleting an account tells Strava and deletes its connection (see [Account data](#account-data)).

Email/password signup and sign-in are disabled. Existing accounts and sessions are not removed. Automatic account linking stays off, so signing in with Apple never joins a legacy email account, which could have been registered by someone else without verifying the address. Any existing email collision needs a separately reviewed account recovery. Sign in with Apple needs no secret: the app sends the identity token Apple gives it and the API checks it against Apple's keys, with the bundle ID `com.trainstackhq.ride` as the audience. Enable the Sign in with Apple capability on that App ID.

### Sign in with Apple on the web

Builds signed with Developer ID, such as the Homebrew app, cannot hold the Sign in with Apple entitlement, so they sign in through Apple's web flow instead. The API runs it as the Services ID `com.trainstackhq.ride.web` and needs a Sign in with Apple key to sign its client secret. In [Apple Developer](https://developer.apple.com/account/resources/identifiers/list/serviceId):

1. Create the Services ID `com.trainstackhq.ride.web`, enable Sign in with Apple, choose `com.trainstackhq.ride` as its primary App ID, and add the domain `api.trainstackhq.com` with the return URL `https://api.trainstackhq.com/api/auth/callback/apple`. Grouping it with the App ID gives riders the same Apple user ID in both flows, so they reach the same account.
2. Create a key with Sign in with Apple enabled for `com.trainstackhq.ride`, and download its `.p8` file.
3. Store the key's ID as `APPLE_SIGN_IN_KEY_ID` and the file as `APPLE_SIGN_IN_PRIVATE_KEY`, without printing it:

```bash
gh variable set APPLE_SIGN_IN_KEY_ID --env production --repo richard-better/trainstack --body '<KEY_ID>'
gh secret set APPLE_SIGN_IN_PRIVATE_KEY --env production --repo richard-better/trainstack < AuthKey_<KEY_ID>.p8
```

Without them, the web flow sends the app `apple_web_not_configured` and native sign-in keeps working. The app opens `GET /api/auth/app-handoff/apple?code_challenge=` in a web authentication session. When Apple's flow ends with a new session, the API deletes the browser's session and redirects to `trainstackride://signed-in?code=`, or `?error=`. The app trades the code and its verifier at `POST /api/auth/app-handoff/token` for `{ token, user: { name } }`. Codes last two minutes, work once, and only with the verifier, which never leaves the app. Both endpoints allow 10 requests a minute per client address. Deleting an account revokes the refresh token Apple's web flow gave, which App Review expects.

The web app at `account.trainstackhq.com` uses the same Services ID. It asks the API to start Apple's flow with itself as the place to return to, Apple posts the result to the API's callback, and the API sets its session cookie and sends the browser back to the web app, or to the web app with `?error=`. The cookie belongs to `api.trainstackhq.com` and is `HttpOnly`, `Secure` and `SameSite=None`. The web app is the same site, so its credentialed requests to the API carry the cookie, and it never sees the token. Web and app sign-ins look up the account by Apple's user ID, so the same Apple ID reaches the same account from either. Apple's flow cannot return to a local API, so sign-in on the web can only be tried end to end against production.

The workflow passes the GitHub `production` variable and secret to Alchemy through `hosted/infra/.env.schema`. The API receives a plain ID binding and a redacted secret binding, accessed through `ENV.STRAVA_CLIENT_ID` and `ENV.STRAVA_CLIENT_SECRET` from `hosted/apps/api/src/env.server.ts`. Missing values default to empty strings so deployment works before registration. Configure both before enabling Strava features.

```bash
gh variable set STRAVA_CLIENT_ID --env production --repo richard-better/trainstack --body '<CLIENT_ID>'
gh secret set STRAVA_CLIENT_SECRET --env production --repo richard-better/trainstack
```

The second command prompts for the client secret without putting it in shell history. For rotation, rotate the secret in Strava's API settings, replace the GitHub secret, and redeploy the current `main` revision. Update the ID too if replacing the application. For local deployment, use the ignored `hosted/apps/api/.env`.

New apps start with only their owner's athlete account and default overall limits of 200 requests per 15 minutes and 2,000 per day. Strava now offers a self-service dashboard upgrade to 10 athletes, with overall limits of 400 per 15 minutes and 4,000 per day. Further capacity requires the [Developer Program review form](https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8), including screenshots of every place Strava data appears and the **Connect with Strava** button. Follow the [brand guidelines](https://developers.strava.com/guidelines/) for the button and **Powered by Strava** attribution (the guidelines also allow **Compatible with Strava**). Capacity and rate increases are subject to review and are not guaranteed; see [rate limits](https://developers.strava.com/docs/rate-limits/) and [getting started](https://developers.strava.com/docs/getting-started/). Uploads need the OAuth scope [`activity:write`](https://developers.strava.com/docs/authentication/).

### Feedback

Signed-in riders can send feedback from Ride (Settings, or **Help > Send Feedback** on the Mac and iPad), and the API files it as a GitHub issue on `richard-better/trainstack`, opened by the `kes-agent` account. `hosted/apps/api/src/feedback/index.ts` serves `POST /feedback`, which takes `{ "message": "...", "context": { "app", "system", "device", "screen", "window" } }` with the rider's session token as `Authorization: Bearer <token>` and returns `201 { number, url }`.

The repository is public, so the issue has the rider's words and the app's context, but not their name, email or account. The `feedback` table is the only record of which account sent which issue, and it goes when the account is deleted. The message goes in as a code block, so it cannot mention people, reference issues in other repositories or show images. Like Strava, only Sign in with Apple accounts can send feedback (`403 apple_account_required`), and each account can send 10 a day (`429 rate_limited`). A request GitHub fails gets `502 github_unavailable` and does not count. Without the token, the route answers `503 feedback_not_configured`.

`kes-agent` needs no access beyond what any GitHub account has to a public repository. Sign in to GitHub as `kes-agent`, create a [classic personal access token](https://github.com/settings/tokens/new) named `TrainStack feedback` with only the `public_repo` scope and a one-year expiry, and send it straight to GitHub:

```bash
gh secret set GITHUB_FEEDBACK_TOKEN --env production --repo richard-better/trainstack
```

A fine-grained token cannot write to a repository that `kes-agent` does not own, which is why this is a classic one. Rotate it before it expires by replacing the secret and redeploying.

### Activities

Activities are served through the contract in `packages/contract` (`activities.upload`, `list`, `get`, `file`, `makePrimary`, `unlink`, `link` and `delete`), over RPC at `/rpc` for TypeScript clients and as plain HTTP at `/api-reference` for the app, documented at `/api-reference/spec.json`: `POST /activities` (multipart, with `file`, `source` and optionally `sourceId`, `sport`, `name` and `startedAt`), `GET /activities?limit=&cursor=&onePerWorkout=`, `GET /activities/{id}`, `GET /activities/{id}/file`, `POST /activities/{id}/primary`, `POST /activities/{id}/unlink`, `POST /activities/{id}/link` (with `to`) and `DELETE /activities/{id}`. They take the rider's session as a bearer token, or as the session cookie from the web app's origin; a cookie sent from any other site counts as no session.

An activity is named by the SHA-256 of its file, in lowercase hex, like the app's iCloud record for a ride, so uploading the same file again returns the activity it already made. The file (FIT, GPX or TCX, up to 25 MB) is stored in R2 at `activities/<user id>/<activity id>` and never changes. Sport and source are open lowercase words (`cycling`, `apple_health`), so a new sport or source needs no migration.

A sport says what was done, not where: `cycling`, `running`, `swimming`, `strength`, `bouldering` and so on. Whether it was indoors, on a trainer, treadmill or climbing wall, is the activity's `indoor`. One function, `activitySport` in `@trainstack/activity-file`, turns a file's FIT sport and sub sport (GPX and TCX names map to them first) into both, so the server and the web app cannot disagree: FIT `training` with `strengthTraining` is `strength`, `rockClimbing` is `bouldering` when its sub sport says so and `climbing` otherwise, `generic` is no sport, and every other FIT sport is its name in snake case (`cross_country_skiing`). `indoor` is true for the indoor sub sports (`indoorCycling`, `virtualActivity`, `spin`, `treadmill`, `indoorRunning`, `indoorRowing`, `indoorClimbing` and the like) and false otherwise. A client may send `indoor` with its sport. `indoor_cycling` is not a sport: it is `cycling` with `indoor` true. Ride sends `indoor_cycling` for its recordings, and installed builds will keep doing so, so an `indoor_<sport>` a client sends is stored as `<sport>` done indoors; the migration did the same to the words already stored. Ride's indoor ride and a head unit's `cycling` file of the same session are therefore the same sport to duplicate matching. Numbers that sum an activity up go in `activity_statistic` as named values, and laps, pauses and other moments in `activity_event`. `activity_sync` holds each source's sync cursor for importers.

#### Summaries

The server derives each activity's summary from its file: its start time, its sport and name when the client sent none, the statistics named in `activityStatistics` in `packages/contract` (`<what>_<unit>`, such as `distance_m` and `average_power_w`), and its laps as events. The file's start time wins over the one the client sent, because the file measured it. The client's sport and name win over the file's, because they are the athlete's choice, such as a sport corrected in Strava; the file's fill in whatever the client left out. The file's values are kept in their own columns (`file_sport`, `file_name`), so summarising again never mistakes them for the client's.

`@trainstack/activity-file`'s `summarizeActivityFile` reads FIT, GPX and TCX alike, telling them apart by their content, without keeping the file's records, and `hosted/apps/api/src/activities/activity-file.ts` turns what it returns into a summary. It returns no timer events, so pauses are not stored as events for now; timer time leaves them out.

An upload is summarised before it is answered. A Cron Trigger runs every minute and summarises up to 5 activities that are due: those stored before summaries existed and those summarised by an older `SUMMARY_VERSION` (raise it in `activities/summary.ts` when the summary logic changes). A file that will not decode keeps its activity stored, listed and downloadable, with `summarizedAt` null and `summaryError` set to `truncated`, `corrupt`, `no_activity`, `too_large` (more than 10,000 laps or sessions) or `failed`.

Files up to the 25 MB upload limit are summarised. Measured in workerd through the bundled API, a 25 MB upload takes about 0.7 s of CPU, of which summarising is about 0.35 s, for FIT, GPX and TCX alike; the upload's own copies of the body dominate its memory, and summarising adds little (about 8 MB of heap, measured in `packages/activity-file`). A scheduled run of 5 such files stays far inside Workers Paid's 30 s default. Each attempt is counted before the file is decoded, so a summary that dies on a CPU or memory limit is retried at most three times and then reported as `failed`. A failed file goes to the back of the queue, so it cannot hold up the rest. An activity keeps at most its first 2,000 laps as events.

The same workout often arrives more than once: Ride uploads its FIT file, and the watch or head unit that also recorded it is uploaded by hand, or later comes from Apple Health or Strava. The files differ, so their ids do too. The server links such activities into one workout instead of dropping any: every file stays stored and downloadable, and one activity is the workout's primary. `list` with `onePerWorkout` shows only primaries, the view for totals and training load; without it, `list` holds every activity, because Ride's sync treats a ride missing from the list as deleted on the server and removes it from the device. Every activity carries `primary` and `duplicates`, the other activities of its workout.

Two activities of one athlete are the same workout when all of these hold (`activities/workout-match.ts`):

- Their sports are the same family, or one is unknown. Indoors or out makes no difference, so Ride's indoor ride matches a watch that called it plain cycling. `e_biking` counts as `cycling` and `hiking` as `walking`; `multisport` matches only `multisport`.
- They share at least half of the shorter one's elapsed time, from start time to start time plus `elapsed_s`. Elapsed time includes pauses, so a head unit that auto-paused still spans the whole ride. Start times are instants, so a GPX written in local time with an offset matches a FIT file in UTC.
- Unless the shorter one lies almost wholly (90%) inside the longer, like one half of a ride the watch saved in two around a cafe stop, the shorter lasts at least half as long as the longer. This keeps apart two rides back to back where the first was stopped late.
- Outdoors, when both have a distance: if they last about as long (within 20%), their distances agree within 20%; otherwise the shorter did not go more than 20% further than the longer. An indoor activity skips this, because a trainer's or app's virtual distance means little, and so does a file with no distance.

A file whose clock is wrong is not matched; the athlete links it with `activities.link`. An activity joins every workout it matches, so a ride split in two by a cafe stop and the head unit's single file of it become one workout.

The primary is the athlete's choice, made with `activities.makePrimary`, the latest choice in a workout winning. Without one it is the richest file: power counts 2, and heart rate, cadence, distance and elevation gain 1 each; then the larger file, then the first stored. `activities.unlink` says an activity is not the same workout as the others; it gets a workout of its own and the server never links it to them again, until the athlete links them with `activities.link`. Choices live in their own columns and in `distinct_activities`, so they survive new arrivals, matching again and summarising again. Deleting the primary hands the workout to the next richest, and the deleted copy stays deleted as below.

An upload is matched right after it is summarised. Summarising an activity again marks it for matching again, and the Cron Trigger, after summaries, matches up to 50 activities that are due: those stored before matching existed (`match_version` null) and those summarised since. Matching only reads the database, so it adds little to the run. Matching only links; it never splits a workout the server linked before.

Deleting an activity deletes its file and leaves a row in `deleted_activity`, like the app's `DeletedRide` record. From then on, uploading that file to that account answers `410 ACTIVITY_DELETED` with the deletion's `id` and `deletedAt`, so a stale device can drop the activity instead of treating it as a failure. A device can delete an activity the server never had, which stops any other device sending it. Deleting is idempotent. Deleting an account deletes its activity rows, then every file under `activities/<user id>/` in R2, with retries until it succeeds (see [Account data](#account-data)), and an upload whose row cannot be stored deletes its own file.

### Athlete settings

Athlete settings are served through the contract's `settings` procedures: `settings.get` (`GET /settings?day=`), the settings that held on a day, or now, per listed sport; `settings.zones` (`GET /settings/zones?day=&sport=`), the zones that applied to a sport on a day; `settings.history` (`GET /settings/history?since=`), every dated entry; and `settings.write` (`POST /settings/history`), up to 100 writes or removals in one request. Thresholds, zone models and the history's rules live in `packages/zones`, which the web app imports too.

A setting is a dated change keyed by what it sets and its day, such as `ftp` for every sport on 2026-06-01. Days are the athlete's own calendar days, with no time zone. `athlete_setting` holds one row per user, key and day. Sports, thresholds and models are open words, so a new sport needs no migration.

Writes resolve per key and day by last writer wins, on the `updatedAt` the device stamps when the athlete makes the edit. The later stamp wins whatever order writes arrive in. On equal stamps a removal beats an edit, and between two edits the greater canonical JSON wins, so every order converges on the same row. A removal leaves a tombstone, so a stale device's older edit cannot bring the entry back, and replaying a write changes nothing. Each write answers with what its keys now hold, so a device that lost learns the value that won. Stamps more than 10 minutes ahead of the server's clock are refused. Every row that changes takes the user's next `revision`; `settings.history` with `since` returns only rows changed after that cursor, removals included, for a device to sync from.

### Threshold detection

After analysis, the Cron Trigger detects thresholds for up to 10 athletes (`thresholds/detection.ts`): those with no analysis due whose analysed activities or settings changed since their last detection, or whose last detection is 20 hours old, so ageing moves on. It reads the statistics `thresholdStatistics` names for the athlete's primary activities of the last 180 days and runs `detectThresholds` from `packages/analysis` (its README has the methods) for each sport with the thresholds set today. Each estimate goes to the setting it would change: the sport's own when the sport has its own zones for that metric, pace always the sport's, otherwise the default. When two sports estimate the same default, the higher max heart rate wins, and otherwise the more confident, then the more recent effort.

`threshold_suggestion` keeps one current suggestion per athlete, setting and threshold, when nothing is set or the estimate differs meaningfully: FTP by 3 % or 5 W, threshold pace by 2 % or 3 s, lactate threshold heart rate by 3 bpm, and max heart rate only upward by 2 bpm, since an observed max is a floor. A `low` estimate never suggests lowering a threshold. `thresholds.suggestions` serves them with their evidence, compared with the settings at the time of the read. `thresholds.accept` writes the threshold and a `threshold_test` with protocol `detected` through `settings.write`'s rules, from today or from the effort's day as the athlete chooses, listing the sport first for a pace it does not have. `thresholds.dismiss` hides it. Both record the answer in `threshold_answer` by the suggestion's evidence, so the same evidence never suggests it again, while a new effort can. A suggestion's id changes when its value or evidence does, so accepting a stale one answers `404`. Nothing changes a threshold without the athlete's say.

### Account data

An athlete can take everything TrainStack holds about them, and delete their account, from the web app's settings. `hosted/apps/api/src/account/athlete-data.ts` lists every D1 table and every R2 prefix that holds an athlete's data, and says for each table how the export finds the athlete's rows and which columns it leaves out, or why it is not exported at all. The list is typed over the Drizzle schema, so a new table does not typecheck until it is listed, and `tests/account-data.test.mjs` fails when a table in the migrations is missing from the export's README, when an exported table has no rows in the test's seeded athlete, or when anything that names the athlete is left in D1 or R2 after deleting the account. Add a new table or prefix to that list, and seed it in the test, in the change that adds it.

`GET /account/export` answers with a tar archive, `trainstack-export-<day>.tar`, built as it streams: a `README.md` that documents the layout and every table, the athlete's rows of each exported table as JSON Lines under `data/<table>/`, in parts of about 4 MB, and the original file of every activity under `activities/<id>.<format>`. It takes the session cookie on a same-site navigation, which is how the web app's download link reaches it, or a bearer token; a request from another site or origin counts as no session. Tar rather than zip because a zip entry needs the CRC-32 of its bytes, which would cost Worker CPU for every byte of every file; a tar entry needs only the size R2 already knows, so file bodies are piped from R2 to the response without passing through JavaScript, and an account's size does not touch the CPU limit. Streaming rather than preparing it in the background means no copy of the athlete's data is stored, so there is nothing to expire, protect or delete afterwards, and HTTP responses have no duration limit. Each file costs one R2 request and each 500 rows one D1 request, so the API Worker raises its subrequest limit to 100,000. A download that breaks starts again from the beginning. macOS and Windows open `.tar` files themselves; elsewhere, `tar -xf`.

Deleting an account (`POST /api/auth/delete-user`, Better Auth's endpoint) needs a session made in the last day, or answers `400 SESSION_EXPIRED`, and the web app asks the athlete to sign in again. Before deleting the rows, it writes a row in `account_file_sweep`, revokes the refresh tokens Apple's web flow and Ride's native sign-in gave (see below), and disconnects Strava as `DELETE /strava` does: it refreshes an access token about to run out, tells Strava with `/oauth/deauthorize` whatever the athlete's call budget, and forgets the tokens. It then forgets the account's and its Strava athlete's call budgets. Every table that holds an athlete's rows goes with the account through `ON DELETE CASCADE`. Once the account is gone it deletes every file under the athlete's prefixes in R2 and then the `account_file_sweep` row. If that fails, partway or at all, the scheduled run sweeps again for accounts that no longer exist, so the deletion still answers success and no file outlives it. An upload that loses the race with a deletion deletes its own file, and if that fails it writes the sweep row itself. Strava and Apple refusing to revoke is logged and does not stop the deletion. The scheduled run forgets Strava call budgets whose window has passed, so no budget names an athlete for more than fifteen minutes after its last call.

Sign in with Apple in Ride's native flow gives the server only an identity token, which Apple's revoke endpoint does not take. So Ride sends the authorization code that comes with the Apple credential to `POST /account/apple-authorization` with its bearer token and `{ "authorization_code": "..." }`. The API trades it at Apple's `/auth/token` as the app (`client_id` `com.trainstackhq.ride`, with a client secret signed by the same Sign in with Apple key as the web flow), checks that the Apple ID it belongs to is the account's, and keeps the refresh token in `apple_app_grant`, encrypted like the Strava tokens. Deleting the account revokes it as the app. It answers `204`, `400 invalid_request`, `400 invalid_code` (Apple refused the code: codes last five minutes and work once), `403 apple_account_required`, `409 another_apple_id`, `502 apple_unavailable` and `503 apple_not_configured`. Ride can send a code at every sign-in, which keeps the newest grant, and again just before deleting, after asking Apple for a fresh credential; a Ride that sends none keeps working, and its account's deletion revokes only what the web flow got.

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

Run `bun run check`, `bun run test`, and `bun run build` before merging. Tests exercise deployment orchestration with and without Axiom, and bundle the actual API to execute committed SQL, authentication, health, and CORS behavior in local Workers/D1. The check job builds the account app before deployment. Alchemy builds the Astro and TanStack Start applications for Cloudflare during deployment. The account app uses the existing compatibility settings, runs on port 3001 in `alchemy dev`, and uses a `workers.dev` URL outside production. Run `bun run dev:account` for local development signed in, without Cloudflare or Apple credentials (see the README), or `bun run --cwd hosted/apps/account dev:bare` for the web app alone. Alone, it calls the API at `http://localhost:3000`, from `hosted/apps/account/.env.development`; `dev:account` passes the API's address and its own port instead, and sets the API's `WEB_APP_ORIGIN` to match.

## Recovery

For an application regression, revert the application commit on `main` and let CI redeploy. Old workflow revisions are intentionally skipped, so use a revert commit instead of re-running an old revision. Reverting application code does not reverse database migrations; fix schema issues with a new forward migration. Use D1 Time Travel for a data recovery incident after checking the affected database and restore point.

The production database and activity files bucket have a retain removal policy. This prevents Alchemy from deleting it during replacement or teardown, but the state row is still removed. Do not use `destroy` to roll back an application release. Preserve database IDs and state access before deliberate infrastructure removal.

If deployment fails, inspect the Actions job and Alchemy plan, correct the configuration or code, and rerun the current `main` workflow. Do not delete shared state or use broad adoption to hide a failed deploy.

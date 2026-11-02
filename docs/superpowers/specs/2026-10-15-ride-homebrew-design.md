# Ride on Homebrew, with browser Sign in with Apple

Status: draft for review, 2026-10-15

## Goal

Install Ride on a Mac from Richard's tap:

```sh
brew install --cask richard-better/tap/trainstack-ride        # named releases
brew install --cask richard-better/tap/trainstack-ride@alpha  # every push to main
```

Homebrew users keep the TrainStack account and Send to Strava.

## Decisions

- Homebrew needs a Developer ID signed, notarized app. Apple does not allow the Sign in with
  Apple entitlement in Developer ID builds (DTS: developer.apple.com/forums/thread/793244), and a
  local export fails on exactly that. So the Developer ID build signs in through the browser.
  App Store and TestFlight builds keep the native button.
- Ride picks the flow at run time: the native button when it holds
  `com.apple.developer.applesignin`, the browser flow when it does not. No compile flags.
- The browser flow uses a Services ID on the existing team. Richard has run Sign in with Apple
  for the web on apps that were only on TestFlight, so the App Store prerequisite in Apple's
  docs is not treated as a blocker.
- CI signs in the cloud with the App Store Connect API key, upgraded to the Admin role, and
  notarizes with the same key. The current key lacks the role, which is also why the TestFlight
  run on 2026-10-12 failed with `Cloud signing permission error`.
- Named releases come from running the release workflow by hand. Every push to `main` that
  touches Ride publishes an alpha.
- A fine-grained token lets trainstack start the tap's update workflow.

## Non-goals

- Sparkle or any in-app updater. Homebrew upgrades the app.
- Sign in with Apple on the web account app (`hosted/apps/account`). The Services ID makes it
  possible later.
- Changing the iOS or watch apps.

## 1. API: an app handoff for Apple's web flow

better-auth runs Apple's web flow. A small plugin, `appHandoff`, modelled on better-auth's own
`oauth-popup` plugin, carries the result out of the browser to the app with a PKCE-bound,
single-use code. The session token never appears in a URL, and nothing an attacker can make a
signed-in browser visit hands over an existing session.

### Apple provider

```ts
apple: {
  clientId: APPLE_SERVICES_ID,                  // "com.trainstackhq.ride.web"
  clientSecret: await appleClientSecret(env),   // ES256 JWT, see below
  audience: [APPLE_APP_BUNDLE_ID, APPLE_SERVICES_ID],
  appBundleIdentifier: APPLE_APP_BUNDLE_ID,
}
```

better-auth 1.7.7 picks token audiences from `audience` first, so both are listed explicitly.
Native ID tokens (`aud` = bundle ID) and web tokens (`aud` = Services ID) both verify.
`appleClientSecret` signs a JWT with `jose` (`iss` = team ID, `sub` = Services ID,
`aud` = `https://appleid.apple.com`, one-hour `exp`) using the Sign in with Apple key from Worker
secrets, and caches it per isolate until shortly before it expires. better-auth takes
`clientSecret` as a resolved string, so `createAuth` (already built per request in
`services.ts`) awaits it first. `https://appleid.apple.com`
joins `trustedOrigins` for the `form_post` callback.

Apple gives one Apple ID the same `sub` for every client on the team, once the Services ID is
grouped with Ride's primary App ID. better-auth keys accounts by provider plus `sub`, so a rider
who signed in natively lands on the same account through the browser. Account linking stays off.

### Flow

1. The app makes a random 32-byte verifier and opens, in `ASWebAuthenticationSession` with the
   `trainstackride` scheme and an ephemeral session:
   `GET /api/auth/app-handoff/apple?code_challenge=<S256>`.
2. `app-handoff/apple` checks the challenge (43 base64url characters), sending the app
   `error=invalid_request` if it is wrong, and stores it with
   `addOAuthServerContext`, which better-auth keeps in the server side of the OAuth state where
   no client can set it (unlike `additionalData`). It then calls `signInSocial` for Apple
   through the endpoint API with `returnHeaders: true`, `disableRedirect: true`,
   `callbackURL` and `errorCallbackURL` both `/api/auth/app-handoff/done`. It forwards every
   `Set-Cookie`, sets a short-lived `app_handoff` marker cookie, and redirects the browser to the
   returned authorization URL itself.
3. Apple posts back to `/api/auth/callback/apple`. better-auth checks state, exchanges the
   code and creates a browser session.
4. An `after` hook on `/callback/:id` handles Apple only, and ignores the POST that better-auth
   bounces to a GET before it parses state. It reads the state with `getOAuthState`. A state
   without `serverContext.appChallenge` is someone else's flow and is left alone.
   - **Success** (`ctx.context.newSession` set, valid challenge):
     - insert a handoff row: a random 32-byte code (only its SHA-256 is stored), the
       challenge, the user ID, and an expiry two minutes out
     - delete the browser session, and take its cookies and any `set-auth-token` header off
       the queued response headers. `deleteSessionCookie` only appends expiring cookies, so the
       real ones would still go out. The `appHandoff` plugin is listed before `bearer()`, so
       bearer finds no session cookie to expose either way
     - redirect to `trainstackride://signed-in?code=<code>`
   - **Failure after valid state** (no new session): redirect to
     `trainstackride://signed-in?error=<better-auth code>`.
   - **State cannot be recovered** (missing, expired or forged): better-auth redirects to its
     own `/error` page, not `errorCallbackURL`. If the browser holds the marker cookie, the hook
     sends it to `trainstackride://signed-in?error=<code>` instead, which carries no credential.
     Without the marker, the redirect stands.
   - `done` is only reached if the hook did not run. It turns an `error` parameter into the
     same app redirect and answers 400 without one.
     Every destination is fixed in code, so no scheme comes from the request and nothing joins
     `trustedOrigins`. Error codes are passed on only if they look like one
     (`[A-Za-z0-9_]{1,64}`), otherwise `sign_in_failed`. Responses carry
     `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. A sign-in link carrying
     someone else's challenge gains them nothing. The code goes to the signed-in rider's own
     machine, and only the challenge's verifier redeems it.
5. The app posts `{ code, code_verifier }` to `/api/auth/app-handoff/token`. One
   `DELETE … WHERE code_hash = ? AND challenge = ? AND expires_at > now RETURNING user_id`
   consumes the row atomically: the challenge is computed from the verifier, so a wrong verifier
   matches nothing. On a match it creates a fresh session for the user and returns
   `{ token, user: { name } }`, the shape `sign-in/social` returns natively. Anything else gets
   a 400.

Handoff rows live in D1 (`app_handoff` table, a drizzle migration). Expired rows are deleted on
every insert. better-auth's rate limiter covers both public endpoints:

- `rateLimit: { storage: "database" }`. better-auth turns the limiter on in production. The
  plugin declares its own rule of 10 per minute per IP for `/app-handoff/apple` and
  `/app-handoff/token`
- the `rateLimit` table, added to the auth schema in the same migration
- `advanced.ipAddress.ipAddressHeaders: ["cf-connecting-ip"]`, so the IP is Cloudflare's
  rather than a spoofable `x-forwarded-for`

Apple sends the rider's name with the first `form_post` only. better-auth stores it when it
creates the user, so the app's follow-up `update-user` call is only for the native path.

### Account deletion

The web flow stores an Apple refresh token. `deleteUser.beforeDelete` revokes it at
`https://appleid.apple.com/auth/revoke` with the Services ID's client secret before the rows
go. A failed revocation is logged and does not block deletion.

### Configuration

New Worker secrets, through `hosted/infra/alchemy.run.ts` and `.env.schema`:
`APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_PRIVATE_KEY`. The team ID and Services ID are
constants next to `APPLE_APP_BUNDLE_ID`. Without the secrets, `createAuth` leaves
`clientSecret` out, `app-handoff/apple` sends the app `error=apple_web_not_configured`, and
native sign-in keeps working. A key that does not parse is logged and treated as missing. Module start-up (`index.ts:23`) must not fail either way.

## 2. App

- `TrainStackClient` gets `startAppleWebSignIn() -> WebSignInAttempt` (URL and verifier, the
  same shape as `ConnectAttempt`) and `finishAppleWebSignIn(_:callback:)`. That parses
  `code` or `error` from the callback, posts to `app-handoff/token`, and saves the session
  exactly as `signInWithApple` does. PKCE helpers move out of the Strava section and are shared.
- `AppleSignInCapability.isNative` reads `com.apple.developer.applesignin` with
  `SecTaskCopyValueForEntitlement` and checks for the `Default` value. It is always true on iOS.
- `AccountSettingsView` shows `SignInWithAppleButton` when native. Otherwise it shows a button
  drawn to Apple's Sign in with Apple guidelines (logo, "Sign in with Apple", black or white with
  the colour scheme) that runs the web attempt through `webAuthenticationSession`, as Strava
  connect does. Cancelling is silent, and errors map to the existing `StravaError` messages.
- Keychain: the data protection keychain needs `com.apple.application-identifier`, which comes
  from the Developer ID provisioning profile. `KeychainSessionStore.save` currently ignores a
  failed write, which would make sign-in vanish on relaunch. It now reports failure, and the
  client surfaces "Ride could not keep your sign-in".

## 3. Building for Developer ID

- `Ride/Ride-macOS-DeveloperID.entitlements` holds only `keychain-access-groups` with Ride's own
  group, `$(AppIdentifierPrefix)com.trainstackhq.ride`. Without an entitlement that needs a
  profile, Xcode embeds none and the app loses `com.apple.application-identifier`. Keychain
  Sharing is allowed under Developer ID, and its first group matches the App Store build's default
  group, so both builds read the same items. Sandbox, network, Bluetooth and file access come
  from build settings and stay.
- `apps/ride/scripts/build-notarized.sh <version> <build> <output>` archives with
  `CODE_SIGN_ENTITLEMENTS=Ride/Ride-macOS-DeveloperID.entitlements`, then exports with
  `ExportOptions-DeveloperID.plist`. Xcode makes a Developer ID profile without Sign in with
  Apple. The script then:
  - checks bundle ID, versions and the Developer ID / team requirement
  - checks the signed entitlements have `com.apple.application-identifier`, the sandbox and
    Bluetooth, and do not have `com.apple.developer.applesignin`
  - notarizes the ZIP, staples the app, runs `spctl`, then writes `Ride-<version>.zip` and
    `SHA256SUMS`
    In CI it authenticates with the API key. Locally it uses the Xcode account and
    `NOTARY_KEYCHAIN_PROFILE`.
- Versions: a named release is `X.Y.Z`, which is also its marketing version. An alpha is
  `<marketing>-alpha.<build>`, where `<marketing>` is the project's `MARKETING_VERSION` (`1.0`
  today, `X.Y` or `X.Y.Z`). The build number is `yyMMddHHmm` UTC, as for TestFlight.

## 4. Release workflows (trainstack)

- `ride-release.yml` runs by hand only, with a required `version` input. The tag trigger goes.
  It runs the existing TestFlight matrix, plus a `homebrew` job that:
  - builds with the script
  - creates release `ride-v<version>` at the run's commit, with the ZIP and `SHA256SUMS`,
    marked latest and with notes generated since the previous named release
  - starts the tap's update for `trainstack-ride`
- `ride-alpha.yml` runs on push to `main` for `apps/ride/**` and its own file. It:
  - builds `<marketing>-alpha.<build>`
  - publishes prerelease `ride-v<marketing>-alpha.<build>`
  - starts the tap's update for `trainstack-ride@alpha`
  - deletes alpha prereleases and tags beyond the newest ten
    Concurrency group `ride-alpha`, not cancelling a run in progress.
- Both use the `testflight` environment: the ASC key plus a new `HOMEBREW_TAP_TOKEN`, a
  fine-grained token with Actions read and write on `homebrew-tap` only. Jobs that publish
  get `contents: write`.

## 5. Tap (richard-better/homebrew-tap)

- `Casks/trainstack-ride.rb` and `Casks/trainstack-ride@alpha.rb` live in the tap, which
  owns their shape. Both use
  `url "https://github.com/richard-better/trainstack/releases/download/ride-v#{version}/Ride-#{version}.zip"`,
  `depends_on macos: ">= :tahoe"`, `app "Ride.app"`, and
  `zap trash: "~/Library/Containers/com.trainstackhq.ride"`, and each has
  `conflicts_with cask:` pointing at the other. No `auto_updates`.
- `scripts/update-trainstack-ride.sh stable|alpha`:
  - lists every release with `gh api --paginate`
  - keeps published ones matching a strict tag pattern, prereleases for alpha and full
    releases for stable
  - picks the highest by numeric comparison of marketing version, then build
  - exits without changes unless that is strictly newer than the cask's current version, so it
    never downgrades, even if releases were deleted
  - fails if the ZIP or `SHA256SUMS` is missing or the checksum does not match
  - rewrites only the `version` and `sha256` lines
  - runs `ruby -c` and `brew style` on the cask
- `update.yml` gains a `cask` choice input (`switcheroo` by default, so today's command still
  works). Every run shares one concurrency group, `tap-write`, so writes to the tap never race,
  and the push fetches and rebases first. The Switcheroo path is otherwise unchanged. The README documents both
  apps.

## 6. One-time setup (Richard)

Apple Developer:

1. Create Services ID `com.trainstackhq.ride.web`, enable Sign in with Apple, group it with
   `com.trainstackhq.ride`, and add the domain `api.trainstackhq.com` and return URL
   `https://api.trainstackhq.com/api/auth/callback/apple`.
2. Create a Sign in with Apple key for the primary App ID. Its ID and `.p8` become the Worker
   secrets.
3. Give the App Store Connect API key the Admin role (or make an Admin key) and update the
   `testflight` secrets.

GitHub: add `HOMEBREW_TAP_TOKEN` to the `testflight` environment.

## 7. Testing

- API (node tests in `tests/`, run against the Worker with a stubbed Apple):
  - challenge validation
  - state carries the challenge
  - the hook mints a code only for a new session created with a valid challenge
  - failures map to the error redirect, including unrecoverable state
  - direct visits to `done` get a 400
  - wrong verifier, replay and expiry are rejected
  - concurrent redemption yields one session
  - the browser session is deleted
  - the callback response carries no session cookie and no `set-auth-token`
  - rate limits apply per `cf-connecting-ip`
  - both audiences verify
  - deletion revokes
- App (Swift Testing in RideKit): callback parsing, the token exchange through a stub
  transport, the capability check's fallback, and the keychain save failure path.
- Build: a local run of `build-notarized.sh` through stapling and `spctl`. Then check that the
  exported entitlements are right, and that a session saved in the Developer ID build survives a
  relaunch.
- End to end: on a Mac, sign in through the browser in the Homebrew build with an Apple ID that
  already has a native account, and confirm it is the same account (Strava still connected).
  Then delete the account and confirm Apple shows the app's access removed.
- Tap: run the update script against a real alpha release, `brew install` from a local tap
  checkout, `brew upgrade` across two alphas, and the conflict between the two casks.

## Risks

- Cloud-managed Developer ID signing with an Admin API key is unproven here. The first CI run
  proves it. The fallback is Switcheroo's approach: import the existing Developer ID `.p12`, with
  the profile still made by Xcode.
- better-auth internals the plugin leans on (OAuth state, `newSession`, cookie names) can change
  between versions. The version stays pinned, and the API tests cover the plugin.

# TrainStack Prehab

Independent native iOS and macOS apps, migrated from `trainstackhq/prehab-app`.
The Ride app is unchanged. Both targets share `PrehabKit`; its core, API and UI
modules can later be composed into a unified TrainStack app.

## Run locally

Requires Xcode 27, Bun via mise, and Docker (OrbStack works).
From the repository root:

```sh
mise exec -- bun install
cp hosted/.env.prehab.example hosted/.env.prehab
docker compose -f hosted/prehab-local/docker-compose.yaml up -d
mise exec -- bun run --cwd hosted/apps/prehab-api db:migrate
mise exec -- bun run prehab:api
```

In separate terminals:

```sh
mise exec -- bun run prehab:worker
mise exec -- bun run --cwd hosted/apps/prehab-api db:seed
mise exec -- bun run prehab:web
mise exec -- bun run prehab:docs
```

The API uses port 3002, the website/admin 4322, docs 4323, and Postgres 25432.
Sign in with `test1@trypre.app` / `12341234` after seeding. These are local
fixtures, never production credentials. Add a working Google AI key to the ignored
`hosted/.env.prehab` for Coach and generation. The Anthropic key is optional for
flows configured to use that provider. Email delivery and Apple sign-in also
require their corresponding service configuration.

Open `Prehab.xcodeproj` and choose `PrehabiOS` with an iOS Simulator or
`PrehabmacOS` with My Mac. Both schemes enable `-prehab-local` in Debug, bypassing
the membership gate. Release builds do not recognize this bypass. The sign-in
screen's server disclosure allows choosing a different API URL. Local HTTP is
allowed through `NSAllowsLocalNetworking`; hosted APIs should use HTTPS.

For command-line simulator builds without a signing team:

```sh
xcodebuild build -project apps/prehab/Prehab.xcodeproj -scheme PrehabiOS \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=
xcodebuild build -project apps/prehab/Prehab.xcodeproj -scheme PrehabmacOS \
  -destination 'platform=macOS,arch=arm64' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=
```

Use ad-hoc signing for simulator execution: Keychain requires the app's entitlements.
No distribution provisioning or deployment is included. The macOS Debug target
omits the Apple sign-in entitlement so ad-hoc local builds need no provisioning
profile; Release uses `PrehabRelease.entitlements` and requires proper signing.

## Exercise media

Large videos remain outside Git. The local API serves `MEDIA_DIRECTORY`; without
that setting it uses the configured S3 bucket. To import the original project's
cached media:

```sh
hosted/prehab-local/import-media.sh /path/to/trainstackhq/prehab-app
```

The source maintenance scripts live in `hosted/apps/prehab-api/scripts`. The seed
session uses the original shared placeholder; individual catalogue entries use
`exercises/<exercise-id>/demo.mp4`. Missing source assets return 404 rather than
showing an unrelated exercise. Media supports AVPlayer byte-range requests.

## Verification

```sh
mise exec -- bun run prehab:test
mise exec -- bun run check
mise exec -- bun run test
swift format lint --strict --recursive apps/prehab
```

After editing the TypeScript contract or onboarding questions:

```sh
mise exec -- bun run prehab:contract
```

This regenerates typed Codable response models, endpoint paths, and the bundled
onboarding schema. Do not edit generated Swift files directly.

See [migration notes](../../docs/prehab/migration.md) for architecture, feature
coverage, local verification and remaining external prerequisites.

The schemes also reference `Prehab.storekit` for local purchase/restore testing
without real payments. Open Profile > Manage membership to exercise the paywall;
disable `-prehab-local` in the scheme to exercise the membership gate. The prices
in this local configuration are test fixtures, not a published offer.

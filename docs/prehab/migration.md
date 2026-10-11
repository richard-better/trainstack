# Prehab native migration

## Boundaries

Prehab is a separate product and executable on each Apple platform. No files in
`apps/ride` change. `PrehabCore` owns generated data types and session execution;
`PrehabAPI` owns HTTP and Keychain; `PrehabUI` owns SwiftUI features. The two app
entry points compose that package, leaving a straightforward route to future
composition in TrainStack.

The full implemented backend stays as a dedicated Fastify/Postgres service under
`hosted/apps/prehab-api`, with Graphile background workers. This preserves its
transactions, jobs, admin tools and data model without mixing it into the existing
D1 service. There are no existing users to transfer. The original checkout remains
intact; React Native, Expo and their deployment configuration are not dependencies
of either native app.

The imported marketing/admin app, email templates and docs site remain separate
hosted workspaces. Historical designs and planning documents are retained under
`docs/prehab/source`; descriptions of Mastra, React Native, infrastructure and
unimplemented roadmap items in those files describe the old project.

## Native feature coverage

- Email/password account creation and sign-in, session restoration via Keychain,
  configured Apple sign-in, sign-out and scheduled account deletion.
- Resumable structured onboarding, profile editing, sport/equipment/goal choices,
  preferred practice time, native daily reminders, appearance settings and legal links.
- Daily agenda, readiness check-in, rest-day acknowledgement, streaks, on-demand
  session generation and session regeneration with feedback.
- Plan, session and exercise discovery; sport filtering, search, exercise details,
  media playback, template starts, generated plan reveal and retries.
- Durable Coach conversation, red-flag guidance, intake completion/skip and plan creation.
- Native session player with repetition/timed sets, left/right exercises, rest,
  pause, skips, local checkpoint recovery, server progress and completion feedback.
- Readiness chart, session history, calendar date selection and plan history.
- StoreKit membership purchase/restore UI and entitlement updates. Local StoreKit
  configuration replaces the RN RevenueCat client. Existing server RevenueCat
  webhook/admin subscription data is retained for compatibility; new native StoreKit
  transactions are not synchronized to it. This is a local-only build, not a billing
  deployment. App Store products, server-side entitlement enforcement and integration
  with the chosen billing backend need configuring before a production release.

The design combines Pre's warm palette, terracotta accent and garden image with
native navigation, forms, sheets, video controls and accessibility. iOS has tabs;
macOS has a sidebar and a resizable window. Typography uses platform fonts.
Optional anonymous native PostHog usage events are controlled in Profile and exclude
health details and conversation text. Server LLM usage/latency observability and
the existing web instrumentation are retained.

## Durable agents

Mastra and AI SDK provider adapters are replaced by pi-durable 1.1.0. Coach and
structured generation persist JSONL journals under `PI_DURABLE_DIRECTORY`, with a
filesystem lock and per-process serialization. A Coach thread has a stable storage
key. Retried message IDs reuse completed/in-flight submissions; terminal provider
failures can create a new attempt. Structured output is validated against Zod and
can request a corrected answer, with repairs also persisted and deduplicated.

Coach commits the assistant response and tool effects before returning its SSE
payload. Native clients reload the canonical thread afterward. It currently shows
"Coach is thinking" until the durable turn completes, rather than partial token
animation. Keep the journal directory on persistent storage with restricted access;
it contains conversation data. Multi-host storage/deployment is outside this local
migration. Account deletion must also purge journals before production retention
policies can be considered complete.

## Verification and prerequisites

Both iOS Simulator and arm64 macOS targets build locally. The Mac executable was
launched and its visible window confirmed through AppKit debugger inspection; the
computer-use tool returned `cgWindowNotFound`, so Mac visual interaction could not
be verified through that tool. Swift tests cover timer
transitions, left/right sets, pauses, skipped-exercise completion, persisted recovery
and local-calendar dates. Backend tests include real pi-durable journal reopen,
request deduplication, provider failure retry and JSON repair using a deterministic
provider. No production fake model is installed.

On 2026-10-11, verification passed: 101 backend tests, 9 Swift tests,
11 repository tests, repository lint/type checks, and all workspace builds.
Both native targets also built successfully with ad-hoc local signing.

The live local smoke script covers authentication, all onboarding steps, the
43-exercise catalogue, template session creation and completion, skipped/progress recovery,
check-ins and valid/invalid AVPlayer byte ranges against Postgres. Run it after
seeding and importing media:

```sh
mise exec -- bun run --cwd hosted/apps/prehab-api test:smoke
```

The imported migrations were missing SQL for session lifecycle and schedule
metadata that existed in schema snapshots. Migration 0009 closes that gap and was
verified against the actual database. The simulator was exercised through sign-in,
catalogue browsing, template start, player video and set/rest transition.

Live Google calls returned `API_KEY_INVALID` for the existing local credential;
Coach/plan/session generation therefore requires a working key for live verification.
Apple sign-in, email delivery and real purchases also require external configuration.
No service, site, app or database was deployed. See the [runbook](../../apps/prehab/README.md).

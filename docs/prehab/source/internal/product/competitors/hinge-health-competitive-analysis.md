# Hinge Health — Competitive Analysis

**Date:** 2026-04-08
**Method:** App Store intelligence, public API probing, DNS enumeration, CSP header analysis, GraphQL schema discovery
**IPA download status:** ipatool returned "app not found" — not available for the authenticated Apple ID. All findings from public sources.

---

## Company & Traction

| Field                   | Data                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| Legal name              | Hinge Health, Inc.                                                |
| Founded                 | ~2014                                                             |
| App Store launch        | 2020-09-28                                                        |
| Current version         | 1.199.0 (released 2026-03-26)                                     |
| App Store ID            | 1429270372                                                        |
| Bundle ID               | `com.hingehealth.phoenix`                                         |
| App Store rating        | **4.93 / 5** (133,168 ratings)                                    |
| Category                | Medical (primary), Health & Fitness                               |
| Price                   | Free (employer/health plan-gated)                                 |
| Size                    | ~246 MB                                                           |
| Min iOS                 | 15.1                                                              |
| Languages               | EN, NL, FR, DE, ES                                                |
| Claimed members         | 20 million+                                                       |
| Employer/plan customers | 2,200+                                                            |
| Business model          | B2B2C — employers and health plans pay; members access at no cost |
| Tagline                 | "#1 digital clinic for joint and muscle pain"                     |

### Key traction signals

- 133k+ App Store ratings at 4.93 stars — exceptional social proof for a gated, B2B app
- IPO attempt disclosed in 2024; paused due to market conditions
- Acquired Enso (TENS pain relief wearable) to add a hardware component
- Contentful used as CMS (space ID: `hjcv6wdwxsdz`)
- Marketing site generated with Gatsby 5

---

## Tech Stack (Confirmed)

### Frontend — Member App

- **React** (SPA, served from CloudFront via S3)
- **Auth0** for authentication (`login.hingehealth.com` → `edge.tenants.us.auth0.com`)
- **Cloudflare** CDN for app endpoints (`app.hingehealth.com`, `my.hingehealth.com`, `scheduling.hingehealth.com`, BFFs)
- **Amazon CloudFront + S3** for marketing site and CDN assets
- Custom font: BrownLLWeb (licensed from Lineto)

### Frontend — Marketing Site

- **Gatsby 5.16.1** (static site generator)
- **styled-components 5.3.11**
- **Contentful** headless CMS

### Backend

- **Apollo Server** (GraphQL) with introspection disabled in production — error messages confirm this
- **Node.js** (confirmed via Apollo Server usage)
- **Cloudflare** in front of all BFF services
- Multiple BFF (backend-for-frontend) services:
  - `care-team-tools-bff.hingehealth.com` — GraphQL API for clinical care team portal
  - `scheduling-bff.hingehealth.com` — scheduling service
  - `operations-hub-bff.hingehealth.com` — operations/admin GraphQL
- S3 bucket: `hingehealth-basilisk-4abe24ae` (us-east-1, access denied / private)

### Infrastructure

- **AWS** (S3, CloudFront) for static assets and marketing site
- **Cloudflare** for all application services and BFFs
- **Amazon S3** us-east-1 and us-west-1 for media storage (referenced in CSP)

### Observability & Feature Flags

- **Sentry** — error tracking (org ID: 364130, `o364130.ingest.us.sentry.io`)
- **Datadog** — RUM and browser monitoring (`browser-intake-datadoghq.com`)
- **Split.io** — feature flags (`sdk.split.io`, `auth.split.io`, `events.split.io`, `streaming.split.io`)
  - Uses Ably for realtime feature flag delivery: `split-realtime.ably.io`

### Analytics

- **Mixpanel** — product analytics (`api-js.mixpanel.com`)

### Communications & Real-time

- **Stream.io** — chat and video
  - Chat: `chat.stream-io-api.com`, `wss://chat.stream-io-api.com`
  - Video: `video.stream-io-api.com`, `https://hint.stream-io-video.com`, `wss://*.stream-io-video.com`
- **Twilio** — video calls (care team side): `wss://global.vss.twilio.com`, `wss://sdkgw.us1.twilio.com/v1/VideoEvents`
- **Ably** — realtime pubsub (used for Split.io streaming)

### Auth (Internal / Care Team)

- **Okta** — SSO for care team and staff
  - `hingehealth.okta.com`
  - `hingehealth-wf.okta.com` (workforce identity)
  - Preview tenants also present (oktapreview.com) — suggests active Okta development

### Scheduling

- **YouCanBook.me** — external scheduling widget (embedded in care team portal iframe)
- **Google Calendar API** — integrated in care team portal

### Support

- **Freshdesk** — customer support (`*.freshdesk.com`)

### Compliance & Consent

- **OneTrust / CookiePro** — cookie consent management
  - Domain script ID: `84abbc5d-a278-4b63-ab38-e742e0aee49d`

---

## Subdomain Map

| Subdomain                             | Infrastructure              | Purpose                                   |
| ------------------------------------- | --------------------------- | ----------------------------------------- |
| `www.hingehealth.com`                 | CloudFront + S3             | Marketing site (Gatsby)                   |
| `app.hingehealth.com`                 | Cloudflare                  | Member app (redirects to hingehealth.com) |
| `my.hingehealth.com`                  | Cloudflare                  | Member portal (Phoenix app)               |
| `login.hingehealth.com`               | Auth0 (Cloudflare edge)     | Auth                                      |
| `scheduling.hingehealth.com`          | CloudFront                  | Member scheduling SPA                     |
| `scheduling-bff.hingehealth.com`      | Cloudflare                  | Scheduling backend API                    |
| `ctp.hingehealth.com`                 | CloudFront                  | Care Team Products portal                 |
| `ctt-shell.hingehealth.com`           | CloudFront                  | Care Team Tools Operations Hub            |
| `care-team-tools-bff.hingehealth.com` | Cloudflare                  | Care team GraphQL API                     |
| `operations-hub-bff.hingehealth.com`  | Cloudflare                  | Operations GraphQL API                    |
| `configurator.hingehealth.com`        | CloudFront                  | Program configurator                      |
| `coach.hingehealth.com`               | (referenced in CSP iframes) | Coach interface                           |
| `cdn.hingehealth.com`                 | CloudFront                  | Media/asset CDN                           |

---

## API Structure (GraphQL Schema — Care Team BFF)

Discovered via error-message probing of the unauthenticated (but requiring auth for data) GraphQL endpoint at `https://care-team-tools-bff.hingehealth.com/graphql`.

### Confirmed Query Fields

| Query                                   | Return Type                    | Notes                               |
| --------------------------------------- | ------------------------------ | ----------------------------------- |
| `user`                                  | (object)                       | Requires auth                       |
| `getAppointments(endDateTime: String!)` | `[Appointments!]!`             | Required arg                        |
| `getMessages`                           | `MessageList!`                 | Messaging                           |
| `conversations`                         | `ConversationList!`            | Conversation threads                |
| `careTeam`                              | `[CareTeamCoverageInfo!]!`     | Care team assignment                |
| `getWorkflow`                           | `WorkflowPayload!`             | Clinical workflows                  |
| `exercisesGetAll`                       | `[ExerciseConfig!]!`           | Exercise library                    |
| `healthLog`                             | `HealthLog!`                   | Health tracking                     |
| `healthLogV2`                           | `MultiIndicationHealthLog!`    | Multi-indication health tracking    |
| `getBills`                              | `BillsPaginatedType!`          | Billing                             |
| `getNotes`                              | `[Note!]!`                     | Clinical notes                      |
| `getRule`                               | `Rule!`                        | Rules engine                        |
| `getVideoCalls`                         | `[VideoCall!]!`                | Video call history                  |
| `searchMembers`                         | `SearchMembersResponse!`       | Member search                       |
| `userAQInfo`                            | `UserAQData!`                  | User questionnaire/AQ data          |
| `getSubscriptions`                      | `SubscriptionsPaginationType!` | Subscriptions                       |
| `getPainScores`                         | `[PainScore!]!`                | Pain score tracking                 |
| `getCompletedEtSessions`                | (list)                         | Completed exercise therapy sessions |
| `pelvicSessions`                        | (list)                         | Pelvic floor sessions               |
| `getCompletedMembers`                   | (list)                         | Members who completed program       |
| `getIncompleteMembers`                  | (list)                         | Members who haven't completed       |
| `getFacet`                              | (object)                       | Clinical facet data                 |
| `getTreatments`                         | (list)                         | Treatment tracking                  |
| `getUserTags`                           | (list)                         | Member tags/labels                  |

### Key Type Names (from error messages)

- `WorkflowPayload` — clinical workflow engine
- `ExerciseConfig` — exercise definitions
- `HealthLog` / `MultiIndicationHealthLog` — supports multiple pain areas (multi-indication)
- `BillsPaginatedType` — billing is paginated
- `Note` — clinical notes
- `PainScore` — pain scoring
- `CareTeamCoverageInfo` — care team assignment to members
- `SearchMembersResponse` — member directory
- `UserAQData` — assessment questionnaire data
- `SubscriptionsPaginationType` — subscription management
- `VideoCall` — telehealth video sessions
- `ConversationList` — messaging conversations
- `MessageList` — message threading

---

## Feature List

### Core Member Features (from App Store description + review analysis)

1. **Personalized exercise therapy** — programs based on medical history, self-reported info, and clinical questionnaire; designed by physical therapists
2. **AI motion tracking ("Insight")** — computer vision that watches form during exercises and provides real-time verbal/sound cues; camera-based
3. **Exercise sessions** — 10-15 minutes, do anywhere, guided video
4. **Dedicated physical therapist** — each member gets a PT; reachable via in-app messaging and video visits
5. **Health coach** — behavioral support alongside the PT
6. **In-app messaging** — async communication with care team
7. **Video visits** — scheduled telehealth with PT/coach
8. **Goal setting and progress tracking**
9. **Educational content library** — videos and articles on nutrition, sleep, relaxation, women's reproductive health
10. **Pain tracking** — regular check-ins on pain levels
11. **Streaks and gamification** — daily exercise completion streaks, rewards/incentives (mentioned in reviews: gifts, travel cups)
12. **Enso wearable** — TENS device for drug-free pain relief, shipped to eligible members
13. **Women's pelvic health program** — pelvic floor therapy, pregnancy/postpartum, bladder/bowel control
14. **Multi-condition support** — back, knee, hip, shoulder, neck, elbow, foot, and pelvic
15. **Scheduling** — dedicated scheduling subdomain for booking video visits (uses YouCanBook.me under the hood in care team view)

### Care Team Features (from CTP portal analysis)

1. **Member search** — clinical staff can search members
2. **Exercise library management** — configure exercise programs per member
3. **Clinical notes** — note-taking for PT/coach
4. **Pain score tracking** — view member pain history
5. **Workflow engine** — rules-based clinical workflows
6. **Video call management** — Twilio-powered video for care team
7. **Messaging/conversations** — Stream.io chat
8. **Appointment management** — scheduling with required datetime args
9. **Billing** — paginated billing records
10. **Health log** — multi-indication health tracking per member
11. **Session tracking** — completed ET sessions, pelvic sessions
12. **Member engagement tracking** — completed/incomplete member lists
13. **Treatment tracking** — `getTreatments`
14. **User tagging** — `getUserTags` for clinical segmentation
15. **Subscriptions management** — managing member plan subscriptions
16. **Google Calendar integration** — care team scheduling
17. **Rules engine** — `getRule` type suggests automated triggers/protocols

### Hidden/Inferred Features

- **Multi-indication programs** — `MultiIndicationHealthLog` type suggests a member can have multiple pain areas tracked simultaneously
- **AQ (Assessment Questionnaire) system** — `userAQInfo` / `UserAQData` suggests a structured intake and ongoing assessment system
- **Configurator** — `configurator.hingehealth.com` suggests a tool for building/configuring care programs, likely used by clinical operations
- **Real-time member workflows** — `user-workflows/subscribe` endpoint in JS bundle suggests server-sent events or WebSocket for workflow state updates
- **Facet-based clinical data model** — `getFacet` suggests a flexible/extensible clinical data architecture

---

## Pricing

- **Free to members** via employer or health plan coverage
- No direct-to-consumer pricing; no B2C subscription tier exists
- B2B pricing to employers/health plans is not public
- Traction: 2,200+ employers and health plans; 20M+ covered members
- Revenue model: per-member-per-month (PMPM) fees to employer/plan customers (standard in digital health)
- Members can receive hardware (Enso wearable) at no cost — included in employer contract

---

## Gaps and Weaknesses

### Business Model Gaps

1. **No B2C offering** — if your employer doesn't have Hinge Health, you can't get it. Significant addressable market locked out.
2. **Enterprise sales cycle** — slow to onboard new employer customers; not self-serve
3. **Employer-gated eligibility** — members must verify eligibility before using the app, creating friction

### Product Gaps (from reviews and analysis)

1. **Insight AI mode has audio/visual sync issues** — one 4-star review specifically noted: when using Insight (motion tracking), the app doesn't provide verbal/sound cues for non-Insight exercises since your head turns away from screen
2. **Limited offline capability** — cloud-dependent exercise delivery
3. **No strength/resistance tracking beyond bodyweight** — programs appear bodyweight and light resistance focused
4. **Pelvic health is a separate add-on** — not universally available, tied to plan
5. **Hardware (Enso) is eligibility-gated** — not all members receive it
6. **Some features require country/plan-specific availability** — educational content, care team support, equipment all have restrictions
7. **App experience feels clinical** — multiple reviews mention it as physical therapy, not general fitness
8. **No community/social features** — purely individual program delivery
9. **No nutrition tracking integration** (educational content only)
10. **YouCanBook.me used for scheduling** — third-party scheduling widget is not custom-built; likely an early product decision that created technical debt

### Technical Gaps

1. **Twilio used for care team video vs Stream.io for member video** — two separate video stacks = complexity
2. **Split.io + Ably for feature flags** — relatively expensive for feature flag delivery; suggests scale but also cost
3. **YouCanBook.me iframe** — scheduling not custom-built in the care team portal
4. **Multiple BFF services** — `care-team-tools-bff`, `scheduling-bff`, `operations-hub-bff` suggests microservice complexity rather than a unified API

---

## What's Worth Replicating

### High Priority

1. **AI motion tracking ("Insight")** — real-time form correction via camera is a major differentiator and the most technically distinctive feature; increases engagement and clinical outcomes
2. **Dedicated human PT + health coach model** — the combination of asynchronous messaging and synchronous video visits creates high-touch care that drives retention and clinical credibility
3. **Exercise therapy program structure** — programs that adapt over time based on feedback; not just static exercise lists
4. **Multi-indication support** — members can have multiple body areas tracked; `MultiIndicationHealthLog` type confirms this is a first-class data model
5. **Gamification + rewards** — streaks, gifts, tangible incentives mentioned repeatedly in reviews as key retention drivers

### Medium Priority

6. **Assessment questionnaire (AQ) system** — structured intake that maps to program personalization; `UserAQData` type suggests rich data model
7. **Pain score tracking over time** — longitudinal `PainScore` history with visualization; core to demonstrating clinical outcomes
8. **Clinical notes + workflow engine** — rules-based protocols for care team; allows scale without adding headcount
9. **Stream.io for chat and video** — good choice for in-app messaging; avoid building your own
10. **Split.io or equivalent for feature flags** — production-grade feature flag system needed for safe rollouts at scale

### Lower Priority (for early stage)

11. **Configurator tool** — program configuration UI for clinical ops; build this once you have programs to configure
12. **Full GraphQL BFF architecture** — works at scale but complex; REST is fine to start
13. **Hardware (Enso)** — interesting differentiator but requires supply chain and hardware ops

---

## User Review Themes

Based on 40+ recent App Store reviews (4.9 avg from 133k ratings):

### Positive Themes

- **Convenience** — "do it at home," "no appointments needed," "fits into my schedule"
- **10-15 minute sessions** — short duration is cited as key to actually doing them consistently
- **Human care team responsiveness** — "PT is a message away," "fast response to questions"
- **Results** — "back pain improved," "more flexible," "less pain," "stronger"
- **AI motion correction** — the Insight camera feature is specifically praised
- **Enso device** — called out as "magic" and a major bonus; drives delight
- **Consistency** — "most consistent exercise I've ever done," gamification works
- **Pelvic health** — specifically praised by women for pelvic floor work
- **Multi-injury** — users with shoulder + back + knee issues all treated in one app

### Negative/Improvement Themes (from 4-star review)

- **Insight mode missing audio cues** — when using camera-based form tracking, verbal/audio cues disappear for exercises where you look away from screen
- **Limited customization of exercise progression** (implied from review patterns)

### Competitors Mentioned in Reviews

- None directly named — suggests strong NPS and no obvious switch-away trigger

---

## Infrastructure Summary

```
DNS / Hosting:
  www.hingehealth.com      → CloudFront (AmazonS3 origin)
  cdn.hingehealth.com      → CloudFront (d67fwdwx0b2g7.cloudfront.net)
  ctt-shell.hingehealth.com → CloudFront (d3gqw8r86lv5d9.cloudfront.net)
  ctp.hingehealth.com      → CloudFront (d3rkc1x0xvwxot.cloudfront.net)
  scheduling.hingehealth.com → CloudFront (d3fplgz7pvqi2v.cloudfront.net)
  configurator.hingehealth.com → CloudFront (d3dy1av0lz6oh4.cloudfront.net)
  app.hingehealth.com      → Cloudflare (redirects)
  my.hingehealth.com       → Cloudflare (member app)
  login.hingehealth.com    → Auth0 edge (Cloudflare)
  scheduling-bff.hingehealth.com → Cloudflare
  care-team-tools-bff.hingehealth.com → Cloudflare
  operations-hub-bff.hingehealth.com → Cloudflare

S3:
  hingehealth-basilisk-4abe24ae.s3.amazonaws.com (us-east-1) — member media

Security Headers (app.hingehealth.com):
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  X-XSS-Protection: 1; mode=block
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Referrer-Policy: same-origin
  x-robots-tag: none (prevents search engine indexing of app)
```

---

## Tech Stack Summary Table

| Layer                | Technology                           | Confidence               |
| -------------------- | ------------------------------------ | ------------------------ |
| Marketing site       | Gatsby 5 + React + styled-components | Confirmed                |
| CMS                  | Contentful                           | Confirmed                |
| Member app           | React SPA                            | Confirmed                |
| Care team portal     | React SPA                            | Confirmed                |
| API style            | GraphQL (Apollo Server)              | Confirmed                |
| Auth (members)       | Auth0                                | Confirmed                |
| Auth (internal)      | Okta                                 | Confirmed                |
| CDN (assets)         | AWS CloudFront                       | Confirmed                |
| CDN (app)            | Cloudflare                           | Confirmed                |
| Static hosting       | AWS S3                               | Confirmed                |
| Error tracking       | Sentry (org 364130)                  | Confirmed                |
| Browser monitoring   | Datadog RUM                          | Confirmed                |
| Product analytics    | Mixpanel                             | Confirmed                |
| Feature flags        | Split.io + Ably realtime             | Confirmed                |
| In-app chat          | Stream.io                            | Confirmed                |
| Member video         | Stream.io Video                      | Confirmed                |
| Care team video      | Twilio Video                         | Confirmed                |
| Real-time            | Ably (for Split.io)                  | Confirmed                |
| Scheduling widget    | YouCanBook.me                        | Confirmed                |
| Calendar integration | Google Calendar API                  | Confirmed                |
| Support              | Freshdesk                            | Confirmed                |
| Cookie consent       | OneTrust/CookiePro                   | Confirmed                |
| Mobile               | React Native / Expo (inferred)       | Inferred                 |
| Backend language     | Node.js                              | Inferred (Apollo Server) |
| AI/ML (motion)       | Custom (Insight feature)             | Inferred                 |
| Hardware             | Enso TENS device                     | Confirmed (acquired)     |

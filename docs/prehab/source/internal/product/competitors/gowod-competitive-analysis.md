# GOWOD – Competitive Analysis

**App:** GOWOD – Mobility & Stretching
**Bundle ID:** `eu.gowod`
**App Store ID:** `1227834875`
**Version analyzed:** 5.6.2
**Date:** 2026-04-08

---

## Tech Stack

### Confirmed

| Layer                  | Technology                                                            |
| ---------------------- | --------------------------------------------------------------------- |
| Mobile framework       | React Native (Expo, Hermes JIT, New Architecture enabled)             |
| Backend runtime        | Node.js + Express                                                     |
| API style              | **GraphQL** (introspection disabled in production)                    |
| Backend infra          | **AWS App Runner** (us-east-2, 3-instance load balanced cluster)      |
| Proxy                  | Envoy (via App Runner)                                                |
| Real-time/DB           | Firebase Realtime Database + Storage (`gowod-71f94` project)          |
| Crash reporting        | **Bugsnag** (API key: `151ea66d041a2265ffe3bbad2811b4d2`)             |
| Push/email marketing   | **Klaviyo** (React Native SDK v2.1.0, Notification Service Extension) |
| Analytics              | Facebook App Events, Google Tag Manager                               |
| Website                | **Webflow**                                                           |
| Subscription analytics | **Profitwell** (key: `ada73fd748f0163b71aeee7d4f86518b`)              |
| Affiliate program      | **Rewardful** (key: `5b1452`)                                         |
| In-app purchases       | `react-native-iap`                                                    |
| Watch                  | **Garmin ConnectIQ**                                                  |
| TV casting             | **Google Cast** (Chromecast)                                          |
| Video player           | Jitter.video                                                          |
| Animations             | Lottie                                                                |
| UI components          | React Native Paper, React Navigation, react-native-screens            |
| Auth providers         | Email/password, Apple Sign In, Facebook Login, Google Sign In         |

### Inferred

- Database is likely PostgreSQL or MongoDB behind the Express/GraphQL layer; Firebase handles supplementary real-time and asset storage
- No RevenueCat SDK found — IAP handled directly via `react-native-iap`; `prod_P6J9nWeXFMaNk` is likely a RevenueCat entitlement ID referenced from server-side RevenueCat integration
- Mobile app is compiled with `RCTNewArchEnabled: true` — they're on the new React Native architecture (Fabric/TurboModules)

---

## Infrastructure

- **API hostname:** `api.gowod.app` → CNAME `ynb4tpfcsw.us-east-2.awsapprunner.com`
- **IPs:** `3.142.192.200`, `3.20.22.105`, `13.58.177.223` (AWS us-east-2)
- **TLS:** TLS 1.2 (ECDHE-RSA-AES128-GCM-SHA256)
- **CORS:** `access-control-allow-origin: *`
- **Website:** Webflow on IONOS CDN (217.160.0.150 — EU-hosted, consistent with Belgian company)
- **Firebase project:** `gowod-71f94` (Firebase Realtime DB + Storage)

---

## API Structure & Data Models

**Protocol:** GraphQL at `https://api.gowod.app/graphql`. All endpoints require authentication. Introspection disabled in production.

**Auth:**

```
mutation SignIn($email: String!, $password: String!)
mutation SignInWithApple($tokenId: String!, ...)
mutation SignInWithFacebook($accessToken: String!, ...)
mutation SignInWithGoogleCredentialManager(...)
mutation SignInWithLimitedFacebook(...)
mutation SignUp($email: String!, $password: String!, $firstname: String!, ...)
mutation ResetPassword($email: String!)
mutation UpdatePassword($currentPassword: String!, $newPassword: String!)
mutation acceptTerms($userId: String!)
mutation deleteUser($email: String!)
```

**Core Queries:**

```
query GetMe
query getSportsConfigurations
query GetSportConfiguration($sportKey: String!)
query getMobilityResultsV5($userId: String!)
query GetProtocols($limit: Int, $from: Date)
query GetLastProtocolByTypeAndSport
query getSubscribedPersonalProtocols
query listPrograms
query GetSubProgData($programId: String!, $subProgId: String!)
query GetWodMoves
query getTrophies
query mobilityTimeByYearsByMonths($userCurrentDate: String)
query getFeatureflags
query getNewsContents(...)
query GetEvents
query GetTermsOfUse
query isAppUpdateRequired($userAppVersion: String!)
query GetDuplicatePremiumDetails
query ValidatePurchase(...)
query CreateUpdateSubscriptionPortal
query FindAffiliate($query: String!)
query GetAffiliatePartnerProgramDayForDate(...)
query SendPersonalData
```

**Protocol Generation (core feature):**

```
mutation GenerateProtocolV5($protoData: ProtoInputV5)
mutation ValidateProtocolV5($protoData: ValidateProtoInputV5)
mutation ExcludeGearsFromProtocolV5($protoData: ProtoExcludeGearsInputV5)
```

**Mobility Testing:**

```
mutation CreateMobilityResultV5($input: MobilityResultV5Input!)
mutation ResetMobilityResultV5
mutation MobilityResultV4ToV5(...)          # migration mutation — they shipped v5 recently
```

**Personal Protocols (sharing ecosystem):**

```
mutation CreatePersonalProtocol($personalProtocol: PersonalProtocolInput!)
mutation UpdatePersonalProtocol($personalProtocol: PersonalProtocolInput!)
mutation DeletePersonalProtocol($personalProtocolId: String!)
mutation UpdatePersonalProtocolsOrder($personalProtocolsIds: [String!]!)
mutation SubscribeToPersonalProtocol($personalProtocolId: String!)
mutation UnsubscribeFromPersonalProtocol($personalProtocolId: String!)
mutation UpdateSubscribedPersonalProtocolsOrder(...)
```

**Exercises:**

```
mutation AddScaledExercise($exerciseId: String!)
mutation RemoveScaledExercise($exerciseId: String!)
```

**Gamification:**

```
mutation startChallenge($trophy: String!)
mutation updateChallenge($progress: Int!)
mutation cancelChallenge
query getTrophies
```

**Reminders:**

```
mutation createReminder($days: [Int!]!, $time: String!)
mutation modifyReminder(...)
mutation deleteReminder($reminderId: String!)
```

**User model fields:**
`email`, `firstname`, `lastname`, `locale`, `isPremium`, `goals`, `favorites`, `platform`, `appVersion`, `missedFeaturesSeen`, `personalProtocolsInfos`, `subscribedPersonalProtocolsIds`, `availableGears`, `premiumDetails`, `authenticationToken`

---

## Pricing

- **Free:** Mobility test + 300+ free exercises (very limited — major complaint in reviews)
- **Premium:** 7-day free trial, then:
  - Monthly: ~$14/month
  - Annual: ~$125/year (~$10.42/month)
  - Black Friday: up to 35% off
- Marketing claim: **GOWOD Premium users gain 18% in mobility in just 60 days**
- Affiliate/referral program via Rewardful

---

## Company & Traction

| Metric              | Value                          |
| ------------------- | ------------------------------ |
| Company             | Mobility First Group           |
| Founding            | March 2018 (app launch)        |
| HQ                  | Belgium (EU)                   |
| Lead mobile dev     | Maxime (from Xcode build path) |
| Users               | **1.7M athletes**              |
| Protocols generated | **38M+**                       |
| App Store rating    | 4.8/5 (3,237 ratings)          |
| App size            | 110 MB                         |
| Min iOS             | 15.1                           |
| Languages           | EN, FR, ES, PT, DE, IT         |
| Current version     | 5.6.2 (released 2026-03-23)    |

---

## Feature List

1. **Mobility test** — standardized assessment, tracks score over time (monthly comparisons)
2. **Protocol types:** ACTIVATE (pre-workout), RECOVER (post-workout), DAILY FLOW (maintenance), Classic Flows
3. **50+ sports** covered including CrossFit, Running, Triathlon, Hyrox, Trail Running, Bodybuilding, Hockey, Padel, Wrestling, and more
4. **300+ exercises** with video instructions
5. **AI-ish protocol generation** (server-side, v5 model) — personalized by sport, gear, and mobility weaknesses
6. **Gear exclusion** — protocols adapt to available equipment
7. **Scaled exercises** — modify exercises to your level
8. **Personal protocols** — create custom routines, share with others, subscribe to community protocols
9. **Challenges + trophies** — gamification layer for streaks/goals
10. **Smart reminders** — day-of-week scheduling
11. **Apple Health integration** — writes workout data
12. **Garmin ConnectIQ** integration
13. **Chromecast/Google Cast** support
14. **Programs + sub-programs** — structured learning content
15. **WOD Moves** — CrossFit-specific movement library
16. **Affiliate partner program** — coaches/box owners as distributors
17. **Multi-language** (6 languages)
18. **Action tracking** — `CreateAction` mutation suggests behavioral analytics/habit tracking

---

## Gaps & Weaknesses

From App Store reviews (April 2026):

| Complaint                                | Frequency | Notes                                                            |
| ---------------------------------------- | --------- | ---------------------------------------------------------------- |
| Free tier too limited                    | High      | "Everything behind paywall", $14/mo feels steep for casual users |
| No Apple TV app                          | Medium    | Users explicitly mention Pliability has this                     |
| No home screen widgets                   | Medium    | User said this was their only complaint                          |
| Audio bugs with AirPlay/screen mirroring | Medium    | Sound drops when casting — despite having Cast SDK               |
| Portrait-only                            | Low       | Landscape view requests                                          |
| Video/text instruction mismatch          | Low       | Content QA issue                                                 |
| Expensive                                | High      | Users comparing to "just using YouTube"                          |

**Strategic gaps:**

- **No AI/LLM integration** — protocol generation is rule-based (server-side function), not adaptive AI
- **No coach/team product** — affiliate program exists but no B2B product
- **No injury rehabilitation** — positioned as performance/prehab, not rehab
- **No community/social layer** — personal protocol sharing is rudimentary; no feed, challenges are solo
- **No web app** — mobile-only (blocks users wanting to do routines on laptop)
- **No wearable-driven adaptation** — ConnectIQ integration is basic; no HRV or recovery data feeding protocol generation

---

## What's Worth Replicating

1. **Protocol type taxonomy** (ACTIVATE / RECOVER / DAILY FLOW) — clean mental model, users immediately understand what they're getting
2. **Multi-sport as core positioning** — 50+ sports creates a broad TAM and word-of-mouth within sports communities
3. **Mobility score + tracking** — quantified progress is a strong retention hook ("up 18% in 60 days")
4. **Personal protocol sharing** — enables coaches to deliver protocols via the app without a full B2B product; sneaky viral loop
5. **Profitwell** for subscription revenue analytics — table stakes for a subscription business
6. **Klaviyo** for lifecycle marketing from day 1 — they're clearly sophisticated about email/push

---

## User Review Themes

**Positive:**

- Routine structure removes decision fatigue ("being told what to do is easier")
- Measurable progress scores keep users coming back
- Multi-sport positioning is validated: users mention using it across 2+ sports

**Negative/Opportunity:**

- Users comparing price to YouTube — need a strong value proposition beyond "just stretching videos"
- Apple TV request suggests users want a living-room / coach-mode experience
- Free tier gatekeeping is aggressive — creates good trial-to-paid conversion but lots of angry 1-star reviews that hurt discoverability
- Sound/AirPlay bugs suggest QA/hardware testing gaps

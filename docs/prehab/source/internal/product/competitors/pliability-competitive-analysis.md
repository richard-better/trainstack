# Pliability Competitive Analysis

**App:** pliability: stretch + mobility (formerly ROMWOD)
**Bundle ID:** `com.romwodllc.romwod`
**App ID:** 1175346453
**Version:** 3.27.4 (March 2026)
**Researched:** 2026-04-08

---

## Company & Traction

| Field             | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| Company           | pliability, LLC                                       |
| App Store release | 2018-08-12                                            |
| Original brand    | ROMWOD (Range of Motion Workout of the Day)           |
| Ratings           | 9,271 ratings, **4.81/5 avg**                         |
| Min iOS           | 16                                                    |
| App size          | 274 MB                                                |
| Target demo       | CrossFit/HIIT/endurance athletes, fitness enthusiasts |

## Pricing

From App Store reviews (pricing page is JS-rendered, not scrapeable):

| Plan                   | Price                  |
| ---------------------- | ---------------------- |
| Monthly                | ~$19/month             |
| Annual                 | ~$180/year ($15/month) |
| Free trial             | 7-day                  |
| Cancellation retention | 50% discount offer     |

**Billing complaints are their #1 negative review theme.** No auto-renewal notifications, no refunds, difficult cancellation path (forces you into the app). This is a real brand risk they've accepted as a churn lever.

---

## Tech Stack

### Confirmed

| Layer               | Technology                                                         |
| ------------------- | ------------------------------------------------------------------ |
| iOS framework       | Swift, UIKit/SwiftUI hybrid                                        |
| Min iOS             | 16                                                                 |
| Database (remote)   | **Firebase Firestore** (real-time + offline)                       |
| Database (local)    | **Core Data** (model still named "romwod.mom")                     |
| Realtime DB         | Firebase Realtime DB (`app-romwod.firebaseio.com`)                 |
| Storage             | Firebase Storage (`app-romwod.appspot.com`) + Cloudinary           |
| Video player        | **Mux** (MuxCore + MUXSDKStats)                                    |
| Image CDN           | Cloudinary                                                         |
| HTTP networking     | Alamofire                                                          |
| Push/CRM            | **Braze** (BrazeKit + BrazeUI)                                     |
| Analytics           | **Segment** + Firebase Analytics + Google Analytics                |
| Attribution         | **AppsFlyer**                                                      |
| Deep linking        | **Branch** (`key_live_ga22ks2sMMyufmBhNPBFSfjctAfyTm4T`)           |
| In-app support      | **Intercom**                                                       |
| Error tracking      | **Sentry**                                                         |
| Animations          | **Rive** (used for AI animations) + **Lottie**                     |
| Social auth         | Google Sign-In, Facebook SDK                                       |
| A/B testing         | Firebase Remote Config + Firebase A/B Testing                      |
| Streaming           | **Google Cast** (Chromecast) + AirPlay                             |
| Pose estimation SDK | **Stretch_SDK** (custom/proprietary — contains AI Rive animations) |

### Inferred

| Layer              | Technology                                                   |
| ------------------ | ------------------------------------------------------------ |
| Backend            | Unknown — API responses return HTML 404s (well-protected)    |
| Website            | **Framer** on Cloudflare (marketing site)                    |
| CDN (web)          | Cloudflare (main), Fastly (`pm.mtasv.net` for cdn subdomain) |
| Assets hosting     | AWS (assets.pliability.com → 3 AWS IPs)                      |
| Transport protocol | gRPC bundled (used by Firebase Firestore internally)         |

### Firebase Project

```
Project ID:      app-romwod
Realtime DB URL: https://app-romwod.firebaseio.com
Storage Bucket:  app-romwod.appspot.com
GCM Sender ID:   618273614299
```

---

## API Structure

`api.pliability.com` resolves to Cloudflare IPs and returns HTML 404 pages (no REST API exposed publicly). No OpenAPI/Swagger docs found. No Supabase detected.

Their backend is likely:

- A REST or GraphQL API behind auth (all endpoints require tokens)
- Possibly direct Firestore reads from the client (Firebase SDK handles auth + data transport)
- gRPC is via Firestore's internal protocol, not a custom gRPC API

**Key inference:** Much of the data access may be direct Firebase client SDK calls (Firestore queries), not a traditional REST API. This means their backend logic lives in Firestore security rules and Cloud Functions.

---

## Feature Map

### Core Content

- 1,700+ guided mobility/stretching routines (video)
- Programs (structured multi-week plans)
- Paths (curated topic-based journeys)
- Daily sessions (12–20 min routines)
- Offline downloads
- Closed captions
- Audio-only mode

### Navigation (from Tab Bar assets)

- Home
- Explore/Discover
- Activity
- Paths/Programs
- Mobility (test hub)
- Downloads
- Favorites
- WHOOP (dedicated tab)
- Shop
- Integrations
- Settings/Support

### AI / Personalization

- **Mobility Test** — camera-based body assessment using `Stretch_SDK` with pose estimation. Takes ~3 minutes. Results in a mobility report + customized program recommendations.
  - Uses `com.romwodllc.uploadMotionVideo` background task (video upload after test)
  - Rive animations for the AI experience (`pliability_ai_bg.riv`, `pliability_ai_lines.riv`)
- **AI Program Builder** — generates custom programs based on goals (sport/outcomes: corrective, recovery, performance)
  - Animation assets: `building_program_animation.json`
- Onboarding quiz for personalization

### Programs

- Preset programs by sport type: HIIT, CrossFit, cycling, running, weightlifting, golf, swimming
- Custom programs (user-defined)
- HYROX-specific program (visible in assets: `build_program_hyrox`)
- Outcomes: corrective, recovery (visible in program outcome icons)

### Social / Sharing

- Post-routine sharing cards (multiple variants: blue, transparent, white)
- Snapshot sharing (mobility test results)
- Refer-a-friend program
- Solo vs. with-friend workout modes

### Wearable Integrations

- **WHOOP** (dedicated tab + recovery-based recommendations: high/medium/low recovery states)
- **Garmin**
- **Apple Health** (activity read + heart rate write)

### Streaming

- Chromecast (Google Cast SDK + mDNS bonjour)
- AirPlay

### Gamification

- Streak tracking
- Program completion recap screen
- Trophy/achievement system (challenges)
- Weekly schedule / calendar view

### Widget

- iOS home screen widget (`ROMWOD_WidgetExtension.appex` — old name not yet updated)

---

## Data Model Hints

From Core Data entity metadata (`romwod.mom`):

- Entity field: `CD_romwodId` — primary ID field in local cache (still using old brand)
- Firebase Firestore is authoritative; Core Data is the local cache layer

From binary type names:

- `ASession`, `AConfig`, `AService`, `ARealtime` — service layer types
- `AdbManager` — likely analytics/database manager
- `ApplicationIdentifierModel` — device/session identity

---

## Infrastructure Summary

| Component      | Stack                                                |
| -------------- | ---------------------------------------------------- |
| Marketing site | Framer on Cloudflare                                 |
| API            | Cloudflare-proxied, fully auth-gated                 |
| Video          | Mux                                                  |
| Images         | Cloudinary                                           |
| CDN            | Cloudflare + Fastly                                  |
| App assets     | AWS (S3-backed)                                      |
| Error pages    | Still reference `static.romwod.com` (technical debt) |

---

## Gaps & Weaknesses

### Critical

1. **No medical/PT positioning.** It's a fitness flexibility app, not a prehab/rehab tool. No physical therapist involvement is surfaced. The mobility test measures range of motion but doesn't diagnose or create rehab protocols.

2. **Billing practices are their biggest brand risk.** Reviews are split: 5-star content praise, 1-star billing outrage. "Beware billing practices" and "thieves" are recurring review titles. No advance renewal notifications, no easy cancellation.

3. **Technical debt is significant.** The app bundle ID, Core Data model, widget extension, push notification extension, and CDN assets are all still branded `romwod`. This suggests messy internal codebase post-rebrand.

### Functional

4. **Beginner-hostile content.** Multiple reviews note that "for all levels" is misleading — many routines require significant baseline flexibility.

5. **AI is surface-level.** Program generation is goal/sport-based questionnaire → preset program mapping, not adaptive real-time personalization. The camera mobility test appears to be a once-per-assessment tool, not continuous feedback.

6. **Chromecast as a feature bet feels dated.** Heavy investment in Google Cast (dedicated Bonjour services, full Cast SDK) for a streaming-to-TV use case that most people solve with AirPlay already.

7. **Shop tab.** Diversifying into merchandise/physical products (tshirt_icon, shop tab) — dilutes focus and adds operational complexity.

8. **No web app.** `pliability.com/app` redirect suggests there may be a web app, but it's not referenced in the native app's main flow. Pure native experience.

---

## What's Worth Replicating

1. **Mobility Test as a hook.** Camera-based assessment that gives you a personalized report is a strong acquisition + activation moment. Users immediately get value and a reason to subscribe.

2. **WHOOP integration as a retention layer.** A dedicated tab for WHOOP (not just generic HealthKit sync) makes the app stickier for the Crossfit/endurance audience that over-indexes on WHOOP ownership.

3. **Program + Paths architecture.** Two distinct content structures: Programs (structured multi-week, goal-based) and Paths (topic-based journeys) give users multiple entry points into long-term engagement.

4. **Post-routine sharing cards.** Multiple visual variants for social sharing built into the completion flow. Low-cost viral loop.

5. **Referral program.** Asset evidence of a refer-a-friend flow — consistent with subscription apps that have solved for organic acquisition.

---

## Review Themes

**Positive:**

- "Only app I need for stretching"
- Mobility test + personalized program is the key hook
- Content quality, music, instruction quality praised
- Works for athletes across sports (CrossFit, cycling, running, golf)
- Long-term users (5-6 years) consistently retained

**Negative:**

- Predatory auto-renewal (no advance notice, no refunds)
- Cancellation requires opening the app
- "Not for beginners" despite marketing claims
- Poor customer service for billing disputes
- Redirecting to website for sign-up is a friction point

---

## Strategic Implications for Prehab App

| Pliability                            | Our Opportunity                                                           |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Flexibility/mobility focus (fitness)  | Prehab/rehab focus (clinical-adjacent)                                    |
| Sport performance positioning         | Injury prevention + recovery positioning                                  |
| Camera test = passive range of motion | Camera test = active movement quality assessment (with PT-grade criteria) |
| AI = questionnaire → preset program   | AI = continuous assessment → adaptive protocol                            |
| No PT involvement                     | PT-designed protocols = credibility differentiator                        |
| Billing predatory = brand risk        | Transparent billing = trust builder                                       |
| $19/month for video content           | Value proposition can include clinical-grade guidance at similar price    |
| WHOOP/Garmin for athletes             | Can target same audience with different clinical lens                     |
| No beginner entry point               | Pain-area questionnaire → beginner-friendly personalized program          |

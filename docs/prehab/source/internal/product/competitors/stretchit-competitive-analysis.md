# STRETCHIT Competitive Analysis

**Date:** 2026-04-08
**Source:** IPA binary analysis (v6.0.1, App Store ID 1124278517) + live API probing + App Store metadata
**Bundle ID:** com.stretchitapp.stretchit

---

## Company / Traction Signals

| Field             | Value                                                               |
| ----------------- | ------------------------------------------------------------------- |
| Company           | STRETCHIT, INC.                                                     |
| Developer         | StretchIt, Inc. (Apple Developer ID 1124278516)                     |
| Launch date       | 2016-09-06 (App Store)                                              |
| Current version   | 6.0.1 (released 2026-03-09)                                         |
| App Store ratings | 14,948 ratings, 4.77/5 average                                      |
| Category          | Health & Fitness                                                    |
| Min iOS           | 16.4                                                                |
| Binary size       | ~136 MB (IPA), ~102 MB download                                     |
| Platforms         | iOS (iPhone + iPad), Android, Web                                   |
| Watch app         | Yes — included in bundle                                            |
| Localizations     | EN, ES, PT-BR, IT, DE (French listed as "coming next")              |
| Web               | https://web.stretchitapp.com (Angular SPA, hosted on S3/CloudFront) |
| Support           | support@stretchitapp.com                                            |
| Social            | @stretchitapp (Instagram, Facebook, YouTube)                        |

---

## Tech Stack

### Confirmed (from IPA)

**Backend / API**

- Custom REST API: `https://api.stretchitapp.com` (Symfony PHP framework — error pages show Symfony's default "An Error Occurred" template; nginx server)
- Staging API: `https://api-stage.stretchitapp.com` (confirmed in stub JSON files)
- Media CDN: `d2bu5x7wh3zdqa.cloudfront.net` and `d2bkxke45bupbc.cloudfront.net` (AWS CloudFront)
- Video CDN: `d2yrrq8emiheea.cloudfront.net` (HLS/MP4 streaming) and `d3swzpin57orr2.cloudfront.net` (full file downloads)
- File storage: `stretchit-images.s3.us-west-2.amazonaws.com` (S3 us-west-2)
- Firebase Realtime Database: `stretchit-5693e.firebaseio.com`
- Firebase Storage: `stretchit-5693e.appspot.com`

**iOS App Frameworks (bundled)**

- Alamofire — HTTP networking
- Kingfisher — async image downloading/caching
- Lottie — animation (used for loading/celebration states)
- AppAuth / GTMAppAuth / GTMSessionFetcher — OAuth/Google Sign-In
- AdjustSigSdk — Adjust attribution (in Frameworks/, not a bundle — suggests manual integration)
- OneSignal (Core, Extension, Framework, LiveActivities, Notifications, OSCore, Outcomes, User) — push notifications, live activities
- Amplitude — analytics/event tracking
- Firebase suite: Analytics, ABTesting, Auth, Core, Crashlytics (+ Swift), Installations, RemoteConfig
- Facebook SDK: AEM, Core, Login, Share (FBSDK)
- Google: Cast, AppMeasurement, AdsOnDeviceConversion, AppMeasurementIdentitySupport
- Cache (likely PINCache or similar)

**Firebase services in use**

- Firebase Analytics
- Firebase A/B Testing
- Firebase Auth
- Firebase Remote Config (paywall config, feature flags, maintenance mode)
- Firebase Crashlytics
- Firebase Realtime Database (realtime features, possibly competitions/friends)
- Google Sign-In

**Third-Party Keys / IDs extracted**

| Service                | Value                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| Firebase Project       | `stretchit-5693e`                                                          |
| Firebase App ID        | `1:617438587450:ios:d5f332adf8af42e7a2a303`                                |
| GCM Sender ID          | `617438587450`                                                             |
| Firebase API Key       | `[redacted API key]`                                                       |
| Google OAuth Client ID | `617438587450-4ap8uuos32a97ehad3c27flu77crj2t9.apps.googleusercontent.com` |
| Facebook App ID        | `841146102608637`                                                          |
| Facebook Client Token  | `5ae2b47d39da37bf8a04b17ea240aa0f`                                         |
| OneSignal App Group    | `group.stretchit.defaults`                                                 |
| reCAPTCHA Site Key     | `6LdUZb0pAAAAAO6z3C2poDtE1A-fWkIGwK5_83_c`                                 |

**No RevenueCat** — subscription management appears to be handled natively via StoreKit (product IDs follow a `bundle5.*` namespace, not RevenueCat's standard format). No `appl_` key found.

**No PostHog** — analytics split between Amplitude and Firebase Analytics/A/B Testing.

**No Supabase** — custom Symfony backend.

**Web app**

- Angular SPA (evidenced by `[defer]="true"` Angular template syntax in served HTML)
- TailwindCSS v3 (CSS variable pattern, `--tw-*` tokens)
- Hosted on S3/CloudFront (not a CDN worker or Vercel/Netlify)
- Custom design system with `canada-type-gibson` font (Adobe Typekit)

**Infrastructure**

- `api.stretchitapp.com` → AWS EC2/ELB (54.245.133.145, us-west-2 CloudFront for media)
- All endpoints require auth — no public OpenAPI spec found
- Nginx reverse proxy in front of Symfony
- Image proxy: `/media/cache/resolve/{format}/...` → redirects to S3/CloudFront URLs

---

## API Structure

No public OpenAPI spec available. All API endpoints return 404 unauthenticated. The following structure is inferred from stub JSON files embedded in the app:

### Confirmed Endpoints / Resource Models

**Lessons (Classes)**

```
GET /api/v?/lessons
```

Fields: `id`, `name`, `description`, `description_web`, `mobile_description`, `slogan`, `free` (0/1), `package`, `url_streaming_short`, `url_streaming_full`, `url_single_file`, `full_duration`, `duration` (mins), `complexity` (beginner/intermediate), `difficulty` (1-4), `type` (single char code), `met`, `is_active`, `is_all_levels`, `is_available`, `is_favorite`, `views`, `vimeo_id`, `trainer` (ID), `trainer_profile` (name + avatar), `tags`, `search_tags`, `property_items` (equipment), `bonus` (points), `image1x1`, `image16x11`, `images` (many resolution variants), `next_event`

Lesson types (single-char codes): `A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`, `I`, `K`, `L`, `M`, `N`, `O`, `P`, `Q`, `R`, `S`, `T`, `U`, `V`, `W`, `X`, `Y`, `Z` — the app has a very large variety of class categories.

**Challenges / Programs**

```
GET /api/v?/challenges
```

Fields: `id`, `name`, `name_html`, `description`, `join_description`, `short_description`, `start_time`, `end_time`, `days_total`, `days_current`, `is_started`, `is_joined`, `is_individual`, `is_available`, `is_active`, `is_course`, `is_chat_enabled`, `complexity` (1-3 string), `complexity_levels`, `classes` (list), `groups`, `course_packages`, `cancel_challenges`, `notify`, `class_start_time`, `search_tags`, `tags`, `color`, `color_cancel_btn`, `sort_order`, `mobile_thumbnail`, `details_view_image`, `mobile_preview`, `video_preview`, `image_preview`, `images`

**Users / Friends**
Fields: `id`, `created_at`, `nickname`, `avatar_urls`

**Competitions**
Structure: `competitions[]` (name, current_week, previous_week with members), `results[]` (cups/trophies), `remain[]` (classes remaining)

**Pagination pattern**

```json
{
  "meta": { "num_items_per_page": 100, "current_page_number": 1, "total_count": 140 },
  "items": [...]
}
```

**Media URL patterns**

- Images: `https://api.stretchitapp.com/media/cache/resolve/{format}/default/{path}` (proxied, redirects to CloudFront)
- Video streaming (short preview): `https://d2yrrq8emiheea.cloudfront.net/{filename}.mp4`
- Video download (full): `https://d3swzpin57orr2.cloudfront.net/{folder}/{filename}.m4v`
- Assets CDN: `https://d2bkxke45bupbc.cloudfront.net/`

---

## Feature List

### Core Features

- **100+ hours of video classes** (new classes released weekly), 5–45 min each
- **Flexibility levels:** Beginner and Intermediate (difficulty 1–4)
- **Trainers:** Alicia, Natasha, Allison (3 named trainers in current build)
- **Equipment options:** No props, Yoga blocks, Strap, Chair, Pillow/Pillow+Block
- **Offline download** — full M4V files downloadable (icon: `ic_download`, `ic_downloaded`)
- **Video player:** custom with speed control, flip camera, volume, landscape/portrait
- **Audio options:** short/full audio versions per class segment (warm-up, training, cool-down)

### Programs

Goal-based programs selected via quiz:

- Front splits, Middle splits, Standing splits
- Backbends, Achieve dancer pose
- Hip mobility, Shoulder mobility, Ankle & calves
- Relieve back pain/stiffness, Neck pain, Shoulder pain, Hip pain
- Morning routine, Stretch at desk, Morning stiffness
- Improve posture, Improve sleep, Reduce stress, Get centered
- Full body release/flexibility, Mobility & flexibility, Flexibility & strength
- Overall flexibility, Splits & backbends
- Relax & restore, Open heart, Touch your toes
- Recover from exercise, Improve & recover, Relieve soreness
- Improve performance, Relieve full body pains

### Challenges (Group Programs)

- Time-boxed structured programs (e.g., 90-Day Flexibility Bootcamp)
- Calendar scheduling with personalized day assignment
- Group chat enabled per challenge (`is_chat_enabled`)
- Course packages for premium challenges
- Beginner, Intermediate, Advanced scheduling variants
- Progress tracking (days_current/days_total)

### Competitions (New Feature)

- Weekly goals competition with friends
- Points/cups leaderboard
- Friends list with avatars
- Cups trophy system for winning weeks

### Onboarding

- "Chat with Alicia" conversational onboarding (AI persona named trainer)
- Collects: main goal, current flexibility level, activity frequency, age
- Proposes a specific challenge/program at end
- 25 onboarding screen images (onb_1 through onb_25)
- Alternative "program quiz" flow (non-chat, faster)

### Social / Community

- Friends system (add friends, avatar display)
- Competition with friends (weekly goals)
- Leaderboard / cups system
- Challenge group chats

### Integrations

- Apple Health (calories burned, class tracking) — read + write
- Apple Music (listen to music during training)
- Google Cast (Chromecast support — `_googlecast._tcp` Bonjour)
- Google Sign-In
- Facebook Login
- Apple Sign-In

### Notifications

- OneSignal push notifications
- Live Activities (iOS Dynamic Island / Lock Screen) — `OneSignalLiveActivities.framework`
- Scheduled class reminders

### Widgets

- iOS home screen widgets (`StretchitWidgetExtension.appex`)
- Motivational message widgets (7-day through 91-day progress milestones)
- "Jump into your routine faster" use case

### watchOS

- WatchKit companion app included

### Affiliate Program

- Live affiliate program — users earn commission on purchases
- Dedicated portal (referenced in update messages)

### AI Search (in development)

- `prod_is_ai_search_enabled: false` — AI search exists in dev/staging, not yet prod
- Stop-words list configured for search normalization

### Paywall / Monetization

- 7-day free trial (standard)
- Multiple paywall variants (A/B tested via Firebase Remote Config):
  - `paywall_regular` — standard
  - `paywall_onboarding` — shown during onboarding
  - `paywall_lto_for_newbies` — limited time offer for new users
  - `paywall_lto_for_cancelled_trial` — win-back after trial cancel
  - `paywall_sales` — Black Friday / seasonal sales
  - `paywall_promo_sales` — promo code paywalls
  - `special_paywall_1` through `special_paywall_5` — gift/special paywalls
  - `discount_paywall` — discounted entry
- Sale mechanics: code `blackfridayautumn2025`, up to 40% off
- Maintenance mode flag (currently false)

---

## Pricing

From product IDs and offer IDs in remote config (not confirmed prices, inferred from offer names):

| Product                                  | Offer ID            | Inferred Price                   |
| ---------------------------------------- | ------------------- | -------------------------------- |
| `bundle5.1month.subscription.app`        | `freetrial`         | ~$19.99/mo (standard)            |
| `bundle5.12months.subscription.app`      | standard            | ~$79.99/yr                       |
| `bundle5.12months.subscription.app`      | `30daysfree`        | 30-day free trial                |
| `bundle5.12months.subscription.app`      | `50percent`         | 50% off first year               |
| `bundle5.12months.subscription.app`      | `9-99-first-month`  | $9.99 first month                |
| `bundle5.12months.subscription.app`      | `79-99-first-year`  | $79.99/yr promo                  |
| `bundle5.12months.s1.subscription.app2`  | `p1y-sale`          | sale price (BF 40% off)          |
| `bundle5.6months.subscription.app.promo` | `promo999for1month` | $9.99 intro for cancelled trials |

**Key insight:** they run aggressive win-back paywalls specifically for users who cancel trials (`paywall_lto_for_cancelled_trial`). Up to 5 different gift-style special paywalls suggest heavy referral/gift card testing.

Reviews mention: ~$20/month, ~$186/year charged on trial (suggesting ~$185-190/year standard price). One reviewer mentions "$20/mo" being worth it. The most common subscription appears to be `bundle5.12months.subscription.app` (annual).

---

## Gaps and Weaknesses

### From user reviews (recurring themes):

1. **Confusing free trial → immediate charge** — multiple 1-star reviews about being charged immediately after signing up for "7-day free trial." This is a major trust/UX issue.
2. **Chatbot onboarding is polarizing** — users explicitly request it be removed ("Please get rid of the chatbot onboarding experience," "Endless bot questions"). The slow Q&A format frustrates users who want to jump straight in.
3. **Too many paywalls / not truly free** — repeated complaints: "Not free," "PAID APP BEWARE," "only 1 free class." Free tier is extremely limited (essentially demo-only).
4. **Content getting repetitive / easier** — long-time users (3-5 years) complain classes have become repetitive and the difficulty ceiling has dropped, suggesting content strategy shifted toward beginner acquisition.
5. **Content not updating fast enough** for long-term subscribers.
6. **iPad landscape mode** — missing on home page (one review requests it).
7. **Update nagging bug** — app asks for updates when none exist.
8. **No web/desktop app** (only mobile + basic web app) — no mention of desktop-class UX.
9. **Only 3 trainers** visible in the current build — limited trainer diversity.
10. **No AI-generated content** — AI search is in dev but not live. No personalized AI coaching beyond the onboarding quiz.

### Technical / Product gaps:

- **No Supabase/modern backend** — legacy Symfony PHP stack (slower to ship features)
- **No real-time AI feedback** — video classes are pre-recorded, no form correction
- **Social is weak** — friends/competitions exist but are essentially just leaderboards, no feed or community content
- **No injury/pain area input** beyond goal selection — the questionnaire is goal-oriented ("achieve splits") not body-condition-oriented ("I have tight hip flexors and lower back pain")
- **No prehab/rehab framing** — purely flexibility/mobility, not therapeutic positioning
- **No progress photos** within programs (though camera permission exists for profile photos)
- **No wearable data integration** beyond Apple Health calories
- **Competitions feel shallow** — just class counts per week, no skill-based or goal-based competitions

---

## What's Worth Replicating

1. **Conversational onboarding with AI trainer persona** — "Alicia" as a named, trusted trainer creates rapport. The chat-style onboarding (despite complaints about speed) does collect rich goal data. The key is making it faster.

2. **Goal → Program matching quiz** — the full decision tree is embedded in `ProgramQuize.plist` and maps specific goals (back pain → relieve back stiffness program; stress → get centered, etc.) directly to program IDs. This is a clean pattern for prehab.

3. **Milestone-based motivational widgets** — the 7/14/21/28-day widget messages are well-crafted habit-formation nudges aligned with behavior change milestones.

4. **Multiple paywall variants with Firebase Remote Config A/B testing** — very mature conversion optimization apparatus. 10+ distinct paywall designs tested simultaneously.

5. **Win-back paywall for cancelled trials** — dedicated `paywall_lto_for_cancelled_trial` with a distinct limited-time offer is best practice.

6. **Offline video download** — M4V download with checksum verification (`single_file_sum` field) is a strong retention feature for users without reliable internet.

7. **Challenge + group chat combo** — structured programs with embedded community chat is a meaningful retention driver that most competitors lack.

8. **Affiliate program** — user-referral commission system actively promoted in update messages.

9. **Lean trainer roster but high production quality** — 3 expert trainers with consistent branding beats a marketplace of 100 random creators.

10. **Content localization depth** — video classes + all UI in 5 languages (EN, ES, PT, IT, DE) from early on is a strong international acquisition moat.

---

## User Review Themes

**Positive themes:**

- Works for complete beginners (most common praise)
- Visible results within weeks (splits, reduced pain, improved posture)
- Clear, precise instruction in videos
- Helps people 40-75 years old who've never stretched before
- Effective for pain relief (lower back, hip, knee, shoulder)
- Great for athletes wanting to improve sport performance (pole dancing, running, CrossFit, cycling)
- Customer support praised in some reviews

**Negative themes:**

- Deceptive "free trial" → immediate charge (most common complaint)
- Too expensive for what it is
- App paywall appears too early in onboarding
- Chatbot onboarding is annoying/slow
- Content becoming repetitive for long-term subscribers
- Limited free content (essentially 1 class free)
- Competitors mentioned: **Pliability** (mentioned by name as better), YouTube (free alternative mentioned)

**Competitor mentioned by name:** "Pliability is so much better. Save your money." — suggests Pliability is the primary competitor in users' minds.

---

## Infrastructure Summary

| Service              | Provider                                                        |
| -------------------- | --------------------------------------------------------------- |
| API server           | AWS EC2 (54.245.133.145, us-west-2 region)                      |
| Reverse proxy        | Nginx                                                           |
| App framework        | Symfony PHP                                                     |
| Web frontend         | Angular SPA on S3 + CloudFront                                  |
| Video CDN            | AWS CloudFront (2 distributions)                                |
| Image CDN            | AWS CloudFront (`d2bu5x7wh3zdqa.cloudfront.net`)                |
| Asset CDN            | AWS CloudFront (`d2bkxke45bupbc.cloudfront.net`)                |
| Database (realtime)  | Firebase Realtime Database (`stretchit-5693e.firebaseio.com`)   |
| Crash reporting      | Firebase Crashlytics                                            |
| Analytics            | Firebase Analytics + Amplitude                                  |
| A/B testing          | Firebase A/B Testing + Remote Config                            |
| Push notifications   | OneSignal                                                       |
| Attribution          | Adjust                                                          |
| Auth (social)        | Firebase Auth + Facebook Login + Google Sign-In + Apple Sign-In |
| Subscription billing | Apple StoreKit (native, no RevenueCat)                          |
| S3 storage           | us-west-2 (`stretchit-images.s3.us-west-2.amazonaws.com`)       |

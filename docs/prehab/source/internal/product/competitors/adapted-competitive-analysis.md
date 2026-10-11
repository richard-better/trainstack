# Adapted: Prehab & Recovery — Competitive Analysis

App Store: https://apps.apple.com/us/app/adapted-prehab-recovery/id6756030925
Bundle ID: `app.adapted.Adapted`
Company: Get Convey Inc.
Contact: team@adapted.app
Launched: Feb 25, 2026
Version: 0.1.1 (updated Apr 6, 2026)
Ratings: 17 (all 5★, likely seeded)
Min OS: iOS 26.1

---

## Pricing

- Monthly: $8.99/month
- Annual: $39.99/year (~$3.33/month)
- Free tier exists with limited access

They ran a waitlist/access-code phase at launch (`access_code_enabled` flag in their config API, now disabled — open to all).

---

## Tech Stack

Reconstructed via IPA extraction, binary analysis, and open API endpoints.

### Backend

- **Custom REST API** at `https://api.adapted.app` (Cloudflare-fronted)
- **Supabase** — PostgREST, Postgres, Realtime channels, Presence, Storage
  - The iOS app queries Supabase directly (PostgREST from client)
  - The "Phoenix Channels" / `phx_join` / `presence_diff` strings in the binary are from the Supabase Realtime SDK, which runs on Elixir/Phoenix under the hood — not a custom backend
- **Firebase** — Auth, push notifications (GCM), Storage bucket (`adaptedhealth.firebasestorage.app`, project: `adaptedhealth`)

### iOS App

- Pure SwiftUI (dark mode only, `UIUserInterfaceStyle: Dark`)
- URLSession for networking (no Alamofire)
- Google Sign In + Apple Sign In + Firebase Auth
- RevenueCat (subscriptions + paywall)
- PostHog (analytics + session recording)
- Sentry (error tracking)
- AVFoundation (video playback)
- String literals are encrypted at compile time — binary analysis yields type names but not plaintext strings

### Infrastructure

- API on Cloudflare (confirmed via `cf-ray` response headers)
- Video CDN base URL unknown (encrypted in binary — requires Charles Proxy to capture)
- Firebase project ID: `adaptedhealth`
- PostHog project key: `phc_qxSl5ZESr1cMNeRUT6AybwQQh8AxyCP1vb7R791j4Rl` (left in Info.plist)
- Google OAuth Client ID: `820900663678-p4k7dbq3b7opqkisejfvejudve7t5ebl.apps.googleusercontent.com`

---

## API Structure

Full OpenAPI spec publicly available at: `https://api.adapted.app/openapi.json`
Swagger UI: `https://api.adapted.app/docs`

No authentication required on the exercises endpoint.

### Endpoints

| Method | Path                                       | Description                                           |
| ------ | ------------------------------------------ | ----------------------------------------------------- |
| GET    | `/v0/exercises/`                           | Full exercise library (public, no auth)               |
| GET    | `/v0/programs/`                            | User's programs                                       |
| POST   | `/v0/programs/`                            | Generate program (sync)                               |
| POST   | `/v0/programs/async`                       | Generate program (async → job)                        |
| GET    | `/v0/programs/{id}`                        | Get program                                           |
| PATCH  | `/v0/programs/{id}`                        | Update program                                        |
| POST   | `/v0/programs/{id}/sessions`               | Trigger next session generation                       |
| GET    | `/v0/sessions/`                            | All sessions                                          |
| GET    | `/v0/sessions/{id}`                        | Get session                                           |
| PATCH  | `/v0/sessions/{id}/start`                  | Mark started                                          |
| PATCH  | `/v0/sessions/{id}/complete`               | Complete with feedback + set logs                     |
| PATCH  | `/v0/sessions/{id}/cancel`                 | Cancel                                                |
| POST   | `/v0/sessions/{id}/regenerate`             | Regenerate with feedback + optional duration override |
| PATCH  | `/v0/sessions/{id}/exercise/{id}/complete` | Mark exercise complete                                |
| PATCH  | `/v0/sessions/{id}/exercise/{id}/skip`     | Skip exercise                                         |
| PATCH  | `/v0/sessions/{id}/exercise/{id}/remove`   | Remove exercise                                       |
| POST   | `/v0/sessions/on-demand`                   | Standalone session (activation/mobility/recovery)     |
| POST   | `/v0/regions/`                             | Track a body region                                   |
| GET    | `/v0/regions/distinct`                     | Distinct regions from check-in history                |
| DELETE | `/v0/regions/{id}`                         | Remove tracked region                                 |
| POST   | `/v0/regions/checkins`                     | Record check-in                                       |
| GET    | `/v0/regions/checkins`                     | Check-in history                                      |
| POST   | `/v0/concierge/next-question-v2`           | Next onboarding question                              |
| POST   | `/v0/concierge/generate-summary`           | Generate athlete profile summary                      |
| GET    | `/v0/chat/`                                | Message history                                       |
| POST   | `/v0/chat/stream`                          | Streaming chat                                        |
| GET    | `/v0/jobs/{id}`                            | Job status                                            |
| GET    | `/v0/config/`                              | App config (feature flags)                            |
| POST   | `/v0/access/validate`                      | Validate access code                                  |

### Key Data Models

**Program**

```
id, name, duration_in_weeks, sessions_per_week, session_duration_min,
sessions[], description, start_date, scheduled_days, regions[],
metadata, next_session_status, created_at, updated_at
```

**Session**

```
id, name, week, session_number, exercises[], description, reasoning,
feedback, target_date, created_at, started_at, completed_at
```

**ExercisePrescription**

```
exercise_id, sets, reps_value, reps_unit, rest_secs,
estimated_duration_min, RPE, reasoning, set_logs[],
completed_at, skipped_at
```

**SetLog**

```
reps_value, reps_unit (reps/seconds), weight_lbs (optional), RPE, notes
```

**RegionCheckIn**

```
region (BodyRegion enum), side (left/right/bilateral),
status (0-4 capacity/trust scale — NOT pain scale)
```

### Notable Design Decisions

- Sessions are **generated progressively** (`next_session_status`), not all upfront — keeps the program adaptive
- Sessions can be **regenerated with feedback** at any time
- On-demand sessions have objectives: `activation`, `mobility`, `recovery`
- Onboarding is **multi-turn conversational** with explicit phases: `clinical_assessment` → `training_background` → `complete`
- Check-in scale is **capacity/trust (0-4)**, not pain — smart UX reframe
- Set logs track `weight_lbs` but no visible progression logic in the API
- Program generation has both sync and async (job-based) variants

---

## Exercise Library

43 active exercises. Publicly accessible at `https://api.adapted.app/v0/exercises/`.

**By category:** Stability (20), Strength (17), Mobility (13) — skews bodyweight/banded, very few loaded exercises.

**Body regions covered:** foot_ankle, hip_groin, knee, low_back, mid_back, shoulder, elbow
**Gaps:** No neck or wrist exercises despite being listed in App Store description.

**Video structure:**

- Each exercise has a `demo.mp4` path (CDN base URL encrypted in binary)
- Most exercises also have a `video.mp4` (longer form)
- Thumbnails at `{slug}/thumbnail.png`
- YouTube fallback URLs available for 37 of 43 exercises

### Full Exercise List

| Name                                   | Category  | Regions                     | YouTube                                     |
| -------------------------------------- | --------- | --------------------------- | ------------------------------------------- |
| Banded Ankle Dorsiflexion Mobilization | mobility  | foot_ankle                  | https://www.youtube.com/watch?v=nx0reDZMcdE |
| Banded Ankle Eversion                  | strength  | foot_ankle                  | https://www.youtube.com/watch?v=QFgPY6oJWcA |
| Banded Ankle Inversion                 | strength  | foot_ankle                  | https://www.youtube.com/watch?v=v_zjz5mOvuY |
| Banded Lateral Walks                   | stability | hip_groin, knee             | https://www.youtube.com/watch?v=6eoK_yxY8Ak |
| Banded Wall Slides                     | strength  | shoulder                    | https://www.youtube.com/watch?v=C6n7JgS0DeM |
| Bird Dog                               | stability | low_back                    | https://www.youtube.com/watch?v=k2azbhhuKuM |
| Cat-Cow                                | mobility  | low_back, mid_back          | —                                           |
| Copenhagen Plank                       | strength  | hip_groin                   | https://www.youtube.com/watch?v=aDsaGBnvDQo |
| Cossack Squat                          | mobility  | hip_groin                   | https://www.youtube.com/watch?v=iPZNB5GsOnM |
| Couch Stretch                          | mobility  | knee, hip_groin             | https://www.youtube.com/watch?v=-zoCBsmnF8Y |
| Dead Bug                               | stability | low_back                    | https://www.youtube.com/watch?v=GbSC02oU3To |
| Double-Leg Heel Raise                  | strength  | foot_ankle                  | https://www.youtube.com/watch?v=pNM8Cgm5sbo |
| Figure Four Stretch                    | mobility  | hip_groin                   | —                                           |
| Forward Step-Down                      | stability | foot_ankle, knee            | https://www.youtube.com/watch?v=B3CjUyMouBA |
| Frog Stretch                           | mobility  | hip_groin                   | —                                           |
| Full Plank with Shoulder Taps          | strength  | shoulder                    | https://www.youtube.com/watch?v=8rgurWd-PB8 |
| Glute Bridge (Double-Leg)              | strength  | low_back                    | https://www.youtube.com/watch?v=Xp33YgPZgns |
| Glute Bridge (Single-Leg)              | strength  | low_back                    | https://www.youtube.com/watch?v=AVAXhy6pl7o |
| Hamstring Bridge (Double-Leg)          | strength  | knee, low_back              | https://www.youtube.com/watch?v=drr5pv1dQU0 |
| Hamstring Bridge (Single-Leg)          | strength  | knee, low_back              | https://www.youtube.com/watch?v=cWiHUKPNYHk |
| Hip Airplane                           | stability | foot_ankle, knee, hip_groin | https://www.youtube.com/watch?v=2hIL15iGuNA |
| Lat Stretch on Bench                   | mobility  | mid_back, shoulder          | —                                           |
| Lateral Step-Down                      | stability | foot_ankle, knee            | https://www.youtube.com/watch?v=_r_vsI64pyw |
| Open Books Stretch                     | mobility  | mid_back                    | https://www.youtube.com/watch?v=OW6YHlxY6JI |
| Prone T                                | strength  | shoulder, mid_back          | https://www.youtube.com/watch?v=3GJoiYUYwr0 |
| Prone Y                                | strength  | shoulder, mid_back          | https://www.youtube.com/watch?v=w1AWGKubE5U |
| Quadruped Rock-Back                    | mobility  | hip_groin, low_back         | https://www.youtube.com/watch?v=aKZGoeHtJ0o |
| Scapular Push-Ups                      | stability | shoulder                    | https://www.youtube.com/watch?v=NKekqeudgWs |
| Seated Quad Stretch                    | mobility  | knee, hip_groin             | —                                           |
| Side Plank                             | stability | low_back                    | https://youtu.be/0Rl5ZQwmS-o?t=8            |
| Side-Lying Adduction                   | strength  | hip_groin                   | https://www.youtube.com/watch?v=lhwT35sshrI |
| Single-Leg Balance with Head Turns     | stability | foot_ankle                  | https://www.youtube.com/watch?v=UCj55s-JHXI |
| Single-Leg Heel Raise                  | strength  | foot_ankle                  | https://www.youtube.com/watch?v=qPd73snQfUs |
| Single-Leg RDL                         | stability | foot_ankle, knee, hip_groin | https://www.youtube.com/watch?v=5BwyZ4Bva14 |
| Single-Leg Squat to Box                | stability | knee, hip_groin             | https://www.youtube.com/watch?v=c6aHletfv9c |
| Soleus Stretch                         | mobility  | foot_ankle                  | https://youtu.be/kOm1df9as6o?t=5            |
| Standing Banded Hip Adduction          | strength  | hip_groin                   | https://www.youtube.com/watch?v=BZKjlZQpx38 |
| Standing Banded Hip Flexion            | strength  | hip_groin                   | https://www.youtube.com/watch?v=U7KaLsN3uE8 |
| Star Excursion Reach                   | stability | foot_ankle, knee, hip_groin | https://www.youtube.com/watch?v=UoMSMdMKfBY |
| Suitcase Hold                          | stability | elbow, shoulder             | https://www.youtube.com/watch?v=cTBmNzZ_IwU |
| Supine Spinal Twist                    | mobility  | low_back, mid_back          | —                                           |
| Thoracic Extension                     | mobility  | mid_back                    | https://www.youtube.com/watch?v=9Y11Kc0E0og |
| Tibialis Raise                         | strength  | foot_ankle                  | https://www.youtube.com/watch?v=VzIcGAgBiaM |

---

## Features

### In App Store description (confirmed)

- AI-generated personalized programs
- Conversational onboarding (clinical assessment → training background phases)
- Adaptive sessions — regenerate with feedback after each session
- On-demand sessions (activation / mobility / recovery)
- Region + side check-ins (capacity/trust scale 0-4, not pain)
- Exercise video demos
- **Breathwork** — 4s inhale / 6s exhale, ambient audio, haptic guidance (separate from exercise sessions)

### Notable absence from API

- Breathwork is not in the OpenAPI spec — either client-side only or an undocumented endpoint
- No progressive overload / weight progression logic visible despite `weight_lbs` field in set logs

### Release note insight

- "Background music no longer interrupted when opening a session" — they were accidentally interrupting the user's music (Spotify etc.) when videos played. Fixed by muting video audio by default. This is NOT a background music feature — it's just not blocking the user's existing audio session.

---

## User Reviews (App Store, Apr 2026)

All 5★, very early. Key themes:

- "Fixed my ankle issues and sprains when going on runs" — personalization resonates
- "Need timers for stretches" — missing feature, users want it
- "Tried GoWod and Pliability, like the personalized programs" — they're competing directly with GoWod/Pliability
- "Good companion for PT" — PT-adjacent positioning working
- "Like how adapted has outstanding custom programs. The prehab stuff feels a lot more geared toward me"

**Explicit competitors mentioned in reviews:** GoWod, Pliability

---

## Gaps & Competitive Opportunities

| Gap                            | Detail                                                                     |
| ------------------------------ | -------------------------------------------------------------------------- |
| Small exercise library         | 43 exercises, heavy lower body bias, no neck/wrist despite listing them    |
| No stretch timers              | Multiple reviews request this                                              |
| No loaded exercise progression | `weight_lbs` in set logs but no progression tracking/suggestions           |
| Upper body thin                | Shoulder exercises exist but elbow/wrist/neck missing                      |
| iOS 26.1 minimum               | Locked out of anyone not on iOS 26 beta (not relevant for us, same target) |
| No coach/human layer           | Fully AI, no PT review or escalation path                                  |
| 17 ratings                     | Extremely early, low social proof                                          |
| Dark mode only                 | No light mode support (`UIUserInterfaceStyle: Dark`)                       |

---

## What to Replicate (Inspirations)

- **Capacity/trust framing** for check-ins instead of pain scale — smart clinical reframe
- **Progressive session generation** (not all at once) — feels more adaptive
- **Session regeneration with feedback** — key UX differentiator
- **Conversational onboarding phases** — clinical_assessment → training_background → complete
- **On-demand sessions** alongside scheduled programs
- **RevenueCat** for subscription management (same conclusion independently)
- **PostHog** for analytics + session recording
- **Sentry** for error tracking

# Onboarding v2 — Design Spec (PRE-81)

> **For Claude:** This is a design spec, not an implementation plan. Read end-to-end before scoping. Many implementation details are intentionally left to the implementer agent — see "Implementer notes" at the bottom for hard rules (especially around the Vercel AI SDK message format).

**Goal:** Replace the v1 placeholder onboarding (sports, 6-region capacity dot ratings, weekly volume) with a v2 intake that gives the AI a meaningfully richer prior for personalized session generation, while keeping mandatory flow short.

**Linear:** [PRE-81](https://linear.app/trainstackhq/issue/PRE-81/revisit-onboarding-questions-make-them-actually-useful-for-ai)

---

## 1. Why

The v1 intake (sport, 6-region 0–4 trust ratings, weekly volume) is a placeholder. Generated sessions are working from a thin prior. A real PT first-session intake captures injury history, current pain, goals, equipment, time budget, training context, and demographics. The current schema captures almost none of that, and the AI prompt reflects the gap.

This is also a perceived-legitimacy moment: F&F users open the app and judge whether this is a "real" prehab tool or a 60-second toy. The intake is the first signal.

## 2. Shape

A **hybrid** intake:

1. A short **structured upfront tier** (~10 screens, mostly skippable) that captures what the AI needs at minimum to generate a non-embarrassing session 1.
2. A **conversational layer** ("Coach", powered by a Mastra agent) the user is dropped into after the structured tier. Captures the messy unstructured details — when does your knee hurt, where exactly, what aggravates it, past surgeries, goal nuance.
3. Designed for persistence at the data layer — the chat thread is stored in generic `threads` / `messages` tables. v2 only surfaces the chat at intake; future iterations can add a "Coach" tab that reuses the same schema.

The chat is **skippable** with a top-right "Skip for now". A skipped intake leaves a `pending` thread which the user can resume from a home-screen banner or Settings.

## 3. Competitor reference

Three apps were analyzed:

- **Adapted** (closest peer, rehab + AI advisor) — 5 structured screens + AI chat as the centerpiece. Combined demographics on one screen. 9-item equipment list. Notification preview mockup. Hard paywall after intake. Chat-as-pain-intake validated as a pattern.
- **Pliability** (mobility/lifestyle, goal-driven) — single-select goal, 10-tile body-area icon grid (cap 1-3), no demographics, no injury detail, no equipment, no AI chat. "Review Program" calendar preview before commit (worth borrowing later).
- **Gowod** (CrossFit/mobility) — sport drag-to-rank, 10-test movement battery with phone-as-goniometer, 4-item equipment, paywall after first session is configured.

Patterns we adopt: **combined demographics screen** (Adapted), **body-area tile grid** (Pliability with our anatomy adjustments), **conversational pain intake** (Adapted), **per-sport breakdown for priority signal** (gowod-inspired but via time, not drag-to-rank).

Patterns we reject: hard paywall (n/a for F&F), 10-test movement battery (too heavy; revisit post-launch), broad-bucket body tiles like "Upper body" (chosen anatomy granularity instead), drag-to-rank sports (per-sport hours encodes priority natively).

## 4. Upfront tier — 10 screens

| #   | Screen                       | Required?                             | Notes                                                                                               |
| --- | ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Welcome / value prop         | n/a                                   | Single Continue. Sets expectation: "This takes about 3 minutes."                                    |
| 2   | Name + DOB + Gender          | Name required; DOB + Gender skippable | One screen, three fields. Adapted-style.                                                            |
| 3   | Sports played (multi-select) | Skippable                             | Continue active even with 0 selections.                                                             |
| 4   | Per-sport weekly time        | Required (only renders if ≥1 sport)   | One row per selected sport, 5 chips each: `<1 hr`, `1–3 hr`, `3–5 hr`, `5–10 hr`, `10+ hr`.         |
| 5   | Goals (multi-select, no cap) | Required (≥1)                         | 7 options.                                                                                          |
| 6   | Body-area focus (12 tiles)   | Skippable                             | "Tap regions you want to focus on or where you have issues." Continue active with 0 selections.     |
| 7   | Equipment (multi-select)     | Skippable                             | 8 items. No "None" option (empty selection = bodyweight only). No "Full gym access" option.         |
| 8   | Daily session time budget    | Required                              | Single-select chips: 5 / 10 / 15 / 20+ min. Drives prompt's `estimatedDurationMin` cap. No default. |
| 9   | Notifications opt-in         | Skippable                             | Push preview mockup (Adapted-style). Skip = OS permission declined.                                 |
| 10  | Disclaimer + see-provider    | Required                              | Existing screens, kept.                                                                             |
| →   | Drop into Coach chat         | Skippable, resumable                  | Top-right "Skip for now" — creates a `pending` thread.                                              |

### 4.1 Sports list (F&F v1, 30 items, alphabetical, multi-select)

```
American Football    Basketball       Bouldering / Climbing
Boxing               BJJ              Calisthenics
CrossFit             Cycling          Golf
Gymnastics           Hiking           Hockey
HYROX                MMA / Martial Arts
Pickleball           Pilates          Rowing
Rugby                Running          Skiing / Snowboarding
Soccer               Strength Training (lifting)
Surfing              Swimming         Tennis
Triathlon            Volleyball       Wrestling
Yoga                 Other
```

Bouldering/Climbing and MMA/Martial Arts are intentionally combined chips — users can specify in chat. "Other" as catch-all. Expansion is welcome post-F&F.

### 4.2 Goals (7 options, multi-select, no cap, required ≥1)

```
1. Recover from a current injury
2. Stay ahead of recurring issues
3. Prevent future injuries
4. Improve sport performance
5. Improve mobility & flexibility
6. Reduce daily pain or stiffness
7. Build long-term durability
```

All goals are equally weighted. The AI prompt receives them as an unranked list — no cap enforced (we'll revisit if signal-to-noise degrades in practice).

### 4.3 Body-area focus (12 tiles, 3×4 grid)

```
Neck            Shoulders      Upper back
Wrists+elbows   Core           Lower back
Glutes          Hips           Thighs
Knees           Ankles+calves  Feet
```

Below the grid: a small "**None of these — focus on full-body work**" text link (resets selection, advances). Selecting any tile flags that area for chat follow-up — Coach will ask about it during the conversation.

This **fully replaces** v1's 6-region 0–4 capacity dot rating. The `sport_profiles.capacityRatings` field is deprecated for new users (see Schema section).

### 4.4 Equipment (8 items, multi-select, optional)

```
Resistance bands       Foam roller        Yoga mat
Dumbbells              Kettlebell         Pull-up bar
Bench                  Massage / lacrosse ball
```

Empty selection = bodyweight only. The AI prompt receives the explicit list and is constrained to use only matching exercises.

### 4.5 Per-sport weekly time chips

For each selected sport, the user picks one of:

```
< 1 hr   |   1–3 hr   |   3–5 hr   |   5–10 hr   |   10+ hr
```

Each sport must have a chip selected (this screen is required, but only renders if sport screen 3 had ≥1 selection — if user skipped sports, this screen is skipped too).

Primary sport is derived as the sport with the highest time bucket (ties broken by selection order). Total weekly volume is derived as the sum of bucket midpoints.

### 4.6 Daily session time chips

```
5 min   |   10 min   |   15 min   |   20+ min
```

Single-select. Required. No default. Drives `sessionTimeBudget` in the prompt and the prompt's "≤N min total" rule (currently hardcoded to 15 min in `session-generator.ts`).

## 5. Conversational layer — Coach

### 5.1 Persona and behavior

- **Name:** Coach
- **Tone:** warm, brief, professional, never diagnoses
- **Turn count:** 5–8 turns typical, more if user is talkative, less if terse
- **Behavior:** free-form within bounds. The agent is given the structured data + a goal: gather enough context for high-quality session generation. Covers each tagged body area, drills into goal-specific follow-ups (e.g. if "Recover from a current injury" was selected, asks which injury), and ends with one open catch-all.
- **Termination:** the agent ends via an `endSession()` tool call once it has covered tagged regions and surfaced any current injury. A user-side "**Generate my first session**" button appears after turn 4 — gives the user a clean exit even if the agent isn't ready to wrap.
- **Skip:** top-right "Skip for now". Creates a `pending` thread. User can resume from a home-screen banner or Settings entry.
- **Safety:** system prompt enforces no-diagnose rule. A `flagRedFlag(reason)` tool exists for the agent to escalate severe symptoms — triggers a hardcoded "please see a provider" message and logs the thread for review.

### 5.2 Mastra agent setup

The Coach is a [Mastra](https://mastra.ai) agent with:

- **Model:** Gemini 3.1 Flash (via Vercel AI SDK abstraction; swappable). Already used for session generation, consistent.
- **Instructions:** include structured-data context block (sports, goals, focus areas, equipment, time budget, demographics) so the agent never re-asks what we already know.
- **Tools:**
  - `endSession()` — terminates the chat, triggers the extraction pass (see §5.4).
  - `flagRedFlag(reason: string)` — for severe symptom escalation. Server-side handler renders a fixed safety message and marks the thread for review.
  - Possibly: `recordSummary(summary: object)` — alternative to a separate extraction pass; agent emits the structured summary directly as part of `endSession`. Implementer's call.
- **Memory:** the thread's prior messages, fed in via the agent framework. No long-term cross-session memory in v2.

### 5.3 UI

React Native chat surface, Vercel AI SDK `useChat`-style streaming. Reference for patterns and styling: **https://github.com/EvanBacon/expo-ai**.

The chat is its own route in the `(onboarding)` group, e.g. `app/(onboarding)/coach.tsx`. After completion or skip, the user is routed to home and the first session generation is kicked off.

### 5.4 Extraction → `intake_summaries`

When the agent calls `endSession()` (or the user skips), an extraction pass runs:

- **Skipped:** no summary written. Generation proceeds without it.
- **Completed:** a one-shot LLM call (same model) reads the message thread + structured data and produces a compact JSONB summary like:

```jsonc
{
  "regions": {
    "knees": {
      "onset": "2 months ago",
      "aggravators": ["deep squats", "downhill running"],
      "type": "achy",
      "diagnosis": null,
    },
    "lower_back": {
      "onset": "ongoing",
      "aggravators": ["sitting"],
      "type": "tight",
    },
  },
  "currentInjuries": [
    {
      "area": "right knee",
      "diagnosis": "suspected meniscus, no imaging",
      "providerSeen": false,
    },
  ],
  "goalsContext": "Wants front split — has tried before, gets stuck at ~90% depth",
  "constraints": ["no overhead pressing — old shoulder"],
}
```

The exact JSONB shape is defined as a Zod schema in the contract package (mirrors structured field intent; expand as needed). Compact (~300–500 tokens), stable, reusable across all future generation calls.

## 6. Schema

Generic and version-agnostic — the chat is just one kind of agent thread today, but the schema doesn't bake that in.

```sql
threads (
  id            text primary key,
  user_id       text not null references user(id) on delete cascade,
  type          text not null,                -- 'intake' for v2; future kinds extend this
  status        text not null,                -- 'pending' | 'completed' | 'skipped'
  started_at    timestamp not null default now(),
  completed_at  timestamp,
  updated_at    timestamp not null default now()
);
create index threads_user_id_type_idx on threads(user_id, type);

messages (
  id          text primary key,
  thread_id   text not null references threads(id) on delete cascade,
  role        text not null,                  -- 'user' | 'assistant' | 'system' | 'tool'
  content     jsonb not null,                 -- shape per current Vercel AI SDK; SEE IMPLEMENTER NOTES
  created_at  timestamp not null default now()
);
create index messages_thread_id_created_at_idx on messages(thread_id, created_at);

intake_summaries (
  user_id     text primary key references user(id) on delete cascade,
  thread_id   text references threads(id) on delete set null,
  summary     jsonb not null,
  version     integer not null default 1,
  extracted_at timestamp not null default now()
);
```

### 6.1 Changes to `sport_profiles`

Augment with the v2 fields:

```sql
sport_profiles (
  ...existing columns,
  name                  text,            -- new
  date_of_birth         date,            -- new, nullable
  gender                text,            -- new, nullable
  goals                 text[] not null default '{}',           -- new
  focus_areas           text[] not null default '{}',           -- new (replaces dot ratings)
  equipment             text[] not null default '{}',           -- new
  daily_session_time_min integer not null,                      -- new (5 | 10 | 15 | 20)
  sport_time_breakdown  jsonb not null default '{}'             -- new: { running: '3-5', climbing: '1-3' }
  -- capacity_ratings retained for legacy v1 users; deprecated for new signups
);
```

Constants for the `goals`, `focus_areas`, `equipment`, sport time buckets, and daily session time chips live in the contract package as Zod enums.

### 6.2 Changes to `capacity_logs`

The daily check-in still asks for a quick rating. The shape needs to change since we no longer have 6 dot-ratings as a baseline — but that's PRE-36's territory, not this ticket. Out of scope here; flag it as a follow-up.

## 7. AI prompt v2

This is the leverage point. Sketch — implementer should refine based on eval results.

```
You are a sports physiologist generating a {sessionType} session for {name}.

ATHLETE
- Age: {age}                              (omit line if not provided)
- Gender: {gender}                        (omit line if not provided)
- Primary sport: {primarySport}           (or "no specific sport")
- Sport breakdown: {sport: hrs/wk, ...}

GOALS (treat as equally weighted)
- {goal1}
- {goal2}
- ...

FOCUS AREAS (user flagged these for attention or pain)
- {area1}, {area2}, ...
(or "User did not flag specific areas — work generally based on sport + goals")

INTAKE CONTEXT (from Coach chat — empty if skipped)
{regions, currentInjuries, goalsContext, constraints}

TODAY
- Readiness: {readiness}
- Session theme: {sessionTheme}
- Time budget: {sessionTimeBudget} min
- Available equipment: {equipment}        (or "bodyweight only")

[yesterdayFeedback]
[yesterdayCapacityAfter]

RULES
- Max 5 exercises, ≤{sessionTimeBudget} min total
- Use ONLY equipment in the available list
- {sessionType-specific guidance}

SAFETY
- Never load areas listed in `currentInjuries` until cleared
- If a focus area has aggravators in intake context, exclude exercises that match those patterns
- (existing safety instructions: capacity 0 = exclude region, etc.)

EXERCISE CATALOGUE
Use ONLY these exercise names (filtered by sport AND available equipment): {exerciseNames}

REASONING FIELDS
- reasoningShort: ≤140 chars, surface focus area + strongest input driving it
- reasoningLong: 2–4 sentences. Reference specific intake context — e.g. "you mentioned your knees ache during deep squats, so today we're working ankle and hip mobility instead."
```

### 7.1 Exercise catalogue change

Each exercise in `apps/server/src/services/constants/exercises` needs a `requiredEquipment: string[]` field. Generation filters the catalogue by `sport` AND `equipment` (intersection). Hardcoded "bodyweight/band only" rule in the v1 prompt is removed.

## 8. Out of scope (deferred)

- **Movement screen** (gowod-style 10 tests, phone-as-goniometer). Park as a post-launch "Mobility Check" feature. Track in a separate ticket.
- **Per-sport specifics** (climbing grade, running pace, lifting 1RMs). Coach chat surfaces these naturally; structured capture lives in a future "Sport profile" feature, not this ticket.
- **Daily check-in reshape** (PRE-36) — depends on this ticket's schema landing first.
- **Progress measurement / baselines** (PRE-39) — informed by this ticket's richer intake but separate work.
- **"Review Program" preview before generation commit** (Pliability pattern). Worth adding later.
- **Persistent Coach tab** in the app navigation. Schema supports it; UI deferred.
- **Sport drag-to-rank** — superseded by per-sport time.
- **Volume hours as standalone screen** — superseded by per-sport time breakdown.

## 9. Implementer notes (hard rules)

> **VERCEL AI SDK MESSAGE FORMAT:** The Vercel AI SDK had a major message-format refactor in late 2025 / early 2026. **Before implementing the `messages.content` shape or the chat UI**, verify the current `UIMessage` / `ModelMessage` shapes from the Vercel AI SDK docs and the Mastra integration guide. **Do NOT pattern-match from older Vercel AI SDK examples**, including those elsewhere in this repo if any exist. The agent's tool calls and tool results must be persisted in the canonical current shape.

> **MASTRA:** Use Mastra for the Coach agent. Set up the agent with structured-data context, the `endSession` and `flagRedFlag` tools, and gemini-3.1-flash. Verify Mastra's current API; do not rely on outdated patterns.

> **UI INSPIRATION:** Pattern the chat UI after https://github.com/EvanBacon/expo-ai (Expo + RN + Vercel AI SDK).

> **MIGRATION:** Existing v1 users with `sport_profiles.capacityRatings` should keep working. Either backfill `focus_areas` from non-zero capacityRatings (region with rating ≤ 2 → tagged as focus area) or leave as-is and let the chat collect new data over time. Implementer's call; backfill is preferred so v1 users don't lose information.

> **NATIVEWIND:** All new screens use NativeWind (`className`), per `CLAUDE.md`. No `StyleSheet.create` or inline `style={{}}` for new code.

> **SKIP STATE:** A skipped Coach thread MUST be `pending` (not `skipped`) so the resume entry is meaningful. `skipped` is reserved for the case where the user explicitly dismisses ever doing the chat — not the v2 default.

## 10. Open follow-ups (post-merge)

- Eval the AI prompt v2 against v1 — sample N generations per archetype and have a PT score them
- Build the home-screen banner for `pending` intake threads
- Build the Settings entry for resuming the chat
- Schema for `capacity_logs` reshape (PRE-36 territory)
- Decide whether to expand the sports list post-F&F based on user "Other" entries

## 11. Validation log (decisions made during brainstorm)

- **Goal cap:** none (all 7 selectable). Revisit if signal degrades.
- **Body-area tiles:** 12 anatomy-rich tiles, no broad "Upper Body / Lower Body" buckets, "Full body" as text link below grid.
- **Chat shape:** free-form within bounds via Mastra agent + tools, not scripted state machine.
- **Chat placement:** after disclaimer, mid-onboarding (not post-first-session).
- **Skip is recoverable:** thread persists as `pending`; resume from home banner + Settings.
- **Schema:** generic threads/messages with `type` discriminator; intake_summaries holds the structured extraction.
- **Equipment skippable, no escape hatches:** empty = bodyweight; no "None" or "Full gym" pseudo-options.
- **Daily session time required, no default:** every user picks a budget explicitly.
- **Per-sport time replaces aggregate volume:** richer signal, primary sport derived from time spent.

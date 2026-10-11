# TODOS

Items deferred from plan reviews on 2026-04-08. Pick up in future sessions.

---

## P1 — Before external TestFlight users

### [TODO-001] Strava / Recover Athletics competitive response

**What:** Document Pre's differentiation strategy explicitly, once Strava's integration path for Recover Athletics becomes clearer.

**Why:** Strava acquired Recover Athletics (runner-specific prehab app, 120M+ Strava users). If bundled into Strava's subscription, this is the single biggest distribution threat. Pre's answer is multi-sport breadth, standalone positioning, and AI-generated depth — but this should be a written strategy, not implicit.

**Pros:** Shapes timing decisions (go multi-sport faster?), onboarding copy, and marketing positioning.

**Cons:** Low urgency until Strava announces integration details — not blocking anything now.

**Context:** Recover Athletics was not in the original competitive analysis. The CEO review surfaced it. No decision needed now, but should be revisited quarterly.

**Effort:** S (human: ~2 hours / CC+gstack: ~15 min)
**Priority:** P1 — revisit when Strava/Recover Athletics integration is announced
**Depends on:** Strava product announcements

---

## P2 — Before external TestFlight users

### [TODO-002] Safety guardrail in AI prompt

**What:** Detect "all-low capacity" in the daily intake (e.g., all body region trust ratings at 0-1) and skip session generation. Instead: show a "Rest day recommended" screen with "See a healthcare provider" CTA. No session generated on acute-symptom inputs.

**Why:** The current plan has disclaimers but no runtime safety logic. Generating a prehab session when a user reports extreme pain across all body regions is both a liability and a trust failure. This is a prompt-level check + a new UI state.

**Pros:** Liability reduction, trust signal, closes a real safety gap for a health app.
**Cons:** Requires defining "all-low" threshold (e.g., 2+ body regions at 0) and adding a new screen.

**Context:** Flagged by Codex outside voice review. Not blocked by any implementation step — can be added to Step 1 (prompt logic) + Step 5 (UI) at any point.

**Effort:** S (human: ~2 hours / CC+gstack: ~15 min)
**Priority:** P2 — before external users, not blocking TestFlight internal testing
**Depends on:** Step 1 (session generation endpoint), Step 5 (session runner)

---

### [TODO-003] Integration test suite for session generation pipeline

**What:** Mock Claude client + minimum 3 integration tests for the session generation endpoint:

1. Happy path — valid Claude response → Zod validates → session persisted
2. Malformed response → retry (temperature 0.2) → fallback hardcoded session served
3. Catalogue validation failure (exercise name not in exercises.ts) → retry → fallback served

**Why:** The session generation pipeline is the highest-risk code path. The 2am Friday scenario: Claude hallucinates an exercise name, retry also fails, fallback is served — does the app show a session or a blank screen? Without tests, this goes unknown until a real user hits it.

**Pros:** Catches silent failures before external users do. Establishes test patterns for future AI integration work.
**Cons:** Requires a mock Claude client setup.

**Context:** The design doc has zero test specification. This is the minimum viable coverage for the AI integration layer.

**Effort:** S (human: ~4 hours / CC+gstack: ~20 min)
**Priority:** P2 — RESOLVED in eng review. Moved to Step 1 (build alongside session generation endpoint). See CEO plan updated build sequence.
**Depends on:** Step 1 complete (session generation endpoint exists)

---

## P1 — Before external TestFlight users (from eng review 2026-04-08)

### [TODO-004] Exercise skip / "can't do this" path in session runner

**What:** Add a "Skip this exercise" button to the session runner. Skipping increments `drop_off_exercise_index` without counting the exercise as done. Session still counts as completed if ≥ 4/5 exercises are done.

**Why:** The AI may prescribe an exercise that conflicts with a user's actual capacity on a given day (e.g., pistol squat when knee capacity is at 0). Without a skip path, the user's only options are to push through (injury risk, liability) or abandon the whole session (terrible first impression). One bad prescription on a first-time user = uninstall.

**Pros:** Prevents catastrophic first impression failures from AI prescription errors. Data on which exercises users skip is a training signal.
**Cons:** Minor session runner UX complexity. Requires clarifying: what counts as a "completed" session if exercises are skipped?

**Context:** Flagged by Codex outside voice review. The session runner (Step 5) is the right place to implement this — the skip button is a single UI addition to the exercise card, and the server-side logic is a threshold check on completed_count at session completion.

**Effort:** S (human: ~2 hours / CC+gstack: ~10 min)
**Priority:** P1 — before external TestFlight users
**Depends on:** Step 5 (session runner)

---

### [TODO-005] PT review and regulatory disclaimer as hard pre-submission gates

**What:** Convert PT review and regulatory disclaimer placement from "open questions" to explicit pre-App Store submission gates. Specific gates:

1. PT clinical review: 30-min call with a licensed sports physiologist or PT to review the AI-generated exercise catalogue and a sample output for runners. ~$200. Produces a sign-off doc.
2. Regulatory: "Consult your healthcare provider" disclaimer placed prominently in the app (not buried in Terms). Legal review of "you don't need a PT" positioning — ensure marketing copy doesn't make clinical claims.

**Why:** These aren't questions to answer someday — they're gating conditions for any real user. Shipping a health app with AI exercise prescription to the App Store without clinical review is a liability. The App Store health app guidelines (5.2) require a disclaimer of clinical authority. A rejection at submission costs 2-4 weeks.

**Pros:** Avoids App Store rejection, reduces liability, increases trust signal. "PT-reviewed programs" on paywall screen (already planned) requires this to be true.
**Cons:** ~$200 + scheduling time for PT review. Legal review is typically free for simple disclaimer copy.

**Context:** Flagged as "open questions" in the design doc and CEO plan. Codex correctly identified these as gating dependencies, not questions. The CEO plan already plans to use "PT-reviewed programs" as a trust signal on the paywall — this makes it true.

**Effort:** S (human: ~3 hours + scheduling / CC+gstack: ~30 min for disclaimer copy)
**Priority:** P1 — must complete before App Store submission. Not blocking TestFlight internal testing.
**Depends on:** Step 3 (exercise catalogue complete), Step 9 (paywall screen)

---

## P2 — Post-TestFlight (from eng review 2026-04-08)

### [TODO-006] Session regeneration path (readiness changes mid-day)

**What:** Add a "Regenerate session" option to the home screen session card, visible when a session has been generated but not yet started. Allows users whose readiness changes after generation (e.g., they logged "Low" in the morning, recovered by afternoon) to request a fresh session with updated inputs.

**Why:** `UNIQUE(user_id, session_date) ON CONFLICT DO NOTHING` locks in the session at first generation. If a user changes their readiness, they're stuck with the original session. For a personalization product, this is a trust failure: "the app didn't adjust when I told it I felt better."

**Pros:** Better perceived personalization. Trust recovery when morning intake was off.
**Cons:** Requires a "soft replace" — delete or update the existing sessions row, re-run generation. Adds a button to the home screen. Complicates the "streak" definition slightly (does regen count as a new session?).

**Context:** Flagged by Codex outside voice review. The UNIQUE constraint is correct for preventing race conditions — this TODO is about adding an explicit user-initiated override path, not changing the constraint. A "regenerate" endpoint runs the same generation logic with fresh readiness input and upserts the sessions row.

**Effort:** S (human: ~3 hours / CC+gstack: ~15 min)
**Priority:** P2 — post-TestFlight, after validating that users actually want this
**Depends on:** Step 7 (Home screen), Step 1b (session generation endpoint)

---

## P1 — Before waitlist launch (from design review 2026-04-08)

### [TODO-007] Commission classical sport illustration for trypre.app hero

**What:** Commission a fresco/mural-style sport illustration for the hero of the trypre.app waitlist page. Specific brief:

- **Style:** Classical mural / fresco aesthetic — reference Soviet-era sports poster meets Renaissance fresco. Multi-sport: show at least two sports in one composition (e.g. a runner and a climber). Warm, heroic, epic scale. NOT: flat illustration, minimal line art, cartoon, photography, or 3D render.
- **Palette:** Warm earth tones from DESIGN.md marketing palette — parchment (`#E8DCC8`), sand (`#D4B896`), terracotta (`#C9623F`), earth (`#8B6347`), sky blue (`#7BA3C0`), deep blue (`#3D6B8C`), shadow (`#2B3E52`), dark ground (`#1A2530`). Dark background so it reads on `#0C0C0F`.
- **Composition:** Portrait/square ratio preferred (fills right half of desktop hero). Athletic figure(s) in motion — confident, not straining.
- **Deliverable:** High-res SVG or PNG (2× for retina), transparent background preferred for placement flexibility.
- **Where to find:** Dribbble search "fresco illustration sport", Behance, Upwork (search "editorial illustration sport"). Budget: ~$300-800 for a professional one-off commission.

**Why:** The waitlist page brand differentiator is the classical mural aesthetic. Without the illustration, the page launches as text-only and loses its visual brand identity — every other prehab/wellness app uses photography or minimal flat design. This is the one thing that makes trypre.app unmistakably Pre.

**Pros:** Brand lands correctly from day one. Sets the visual standard for in-app assets (exercise illustration style). A commissioned illustration is evergreen — usable in App Store screenshots, social, press.
**Cons:** Requires budget (~$300-800) and lead time (~1-2 weeks for commissioning + revisions). Blocks waitlist page launch.

**Context:** Flagged as hard dependency in /plan-design-review 2026-04-08. The plan spec for Step 0 now requires this illustration — no placeholder launch.

**Effort:** M (human: ~1-2 weeks + budget / CC+gstack: ~0 — requires human artist)
**Priority:** P1 — blocks waitlist page launch (Step 0)
**Depends on:** Finding and briefing an illustrator

---

---

## P1 — Before TestFlight (exercise catalogue quality)

### [TODO-009] Expand exercise catalogue with evidence-based sources before TestFlight

**What:** The current catalogue (103 exercises, placeholder `youtube_id` fields) needs to be expanded to ~200+ exercises and grounded in clinical/evidence-based sources before showing to real users. Specifically:

1. **Seed from open datasets:**
   - [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db) — 800+ exercises in JSON, public domain. Map to our `Exercise` shape and add `sport_tags`.
   - [ExerciseDB API](https://www.exercisedb.dev/docs) / [GitHub](https://github.com/ExerciseDB/exercisedb-api) — 11,000+ exercises with body part, target muscle, equipment, GIFs. Open-source version free.
   - [wger REST API](https://wger.de/en/software/api) — ~700 exercises via OpenAPI, AGPL.

2. **Layer in sport-specific clinical protocols as source-of-truth for tagging:**
   - [FIFA 11+](https://kneesurgerysydney.com.au/wp-content/uploads/2017/05/11plus_workbook_e.pdf) — 15 validated exercises for lower-body injury prevention (directly applicable beyond soccer)
   - [OSTRC Skadefri / Get Set](https://fittoplay.org/about-skadefri/about-us/) — IOC-backed, free exercise protocols for multiple sports
   - [MGH ITB Syndrome Protocol](https://www.massgeneral.org/assets/mgh/pdf/orthopaedics/sports-medicine/physical-therapy/rehabilitation-protocol-for-iliotibial-band-syndrome.pdf) — runner-specific hip/ITB protocol PDF
   - [AAOS Hip Conditioning](https://orthoinfo.aaos.org/globalassets/pdfs/2017-rehab_hip.pdf) + [AAOS Knee Conditioning](https://orthoinfo.aaos.org/globalassets/pdfs/2017-rehab_knee.pdf) — free, diagrammed PT sheets
   - [Hooper's Beta A2 Pulley Manual](https://www.hoopersbeta.com/library/a2-pulley-manual-for-climbers) — phased finger pulley rehab for climbers
   - [Trail Running Injury Prevention (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8811510/) — open-access paper with extractable exercise tables

3. **Evidence backbone for specific injuries:**
   - [PEDro](https://pedro.org.au) — 67k+ RCTs and clinical guidelines, free. Use for highest-evidence protocol per injury type.
   - [PubMed/PMC](https://pmc.ncbi.nlm.nih.gov) — filter "free full text" for JOSPT/BJSM papers
   - [JOSPT ACL Prevention CPG](https://www.jospt.org/doi/10.2519/jospt.2023.0301) — 2023 clinical practice guideline with enumerated exercises
   - [Physiopedia Injury Prevention in Sport](https://www.physio-pedia.com/Injury_Prevention_in_Sport) — summarized sport-specific protocol lists with citations

4. **Curate `youtube_id` for each exercise** — one best-angle video per exercise. Required for TestFlight (server maps `youtube_id` → YouTube embed URL as `video_url`).

**Why:** The current 103-exercise catalogue was built from first principles. Clinical sources will catch omissions (e.g. the A2 pulley rehab protocol for climbers is phased and specific in ways our generic wrist exercises aren't), improve sport tagging accuracy, and give the AI better raw material. Also required for the PT review gate (TODO-005).

**Effort:** M (human: ~1-2 days / CC+gstack: ~1 hour for import scripting + tagging)
**Priority:** P1 — before TestFlight with external users. Internal TestFlight OK with current catalogue.
**Depends on:** TODO-005 (PT review should validate final exercise list)

---

## P2 — Post-TestFlight (from design review 2026-04-08)

### [TODO-008] Weekly capacity re-assessment flow

**What:** After session completion on the 7th consecutive session (or 7-day streak), trigger a post-session re-assessment of all 6 body-region capacity ratings to update the user's baseline in `sport_profiles.capacity_ratings`.

**Why:** The plan specifies "capacity ratings collected once + weekly re-assessment only" but has no implementation spec. Baseline capacity data becomes stale — if a user's knee trust improves over 3 weeks of prehab, the AI should know and adapt the program. Without this, personalization degrades over time.

**Pros:** Keeps AI-generated sessions accurate over time. Closes the core feedback loop. Shows users their capacity is changing (a direct value signal for retention).
**Cons:** Adds a post-session screen that appears weekly. Requires server-side trigger logic (session count check or streak check on session completion).

**Context:** The plan references "weekly re-assessment" in Step 4's description of capacity ratings, but the session runner (Step 5) only captures `capacity_ratings_after` per-session — which is stored in `capacity_logs`, not written back to `sport_profiles`. The weekly re-assessment updates the baseline directly.

**Effort:** S (human: ~3 hours / CC+gstack: ~15 min)
**Priority:** P2 — after TestFlight, once session cadence is validated
**Depends on:** Step 5 (session runner + completion screen), Step 1b (session generation uses baseline capacity)

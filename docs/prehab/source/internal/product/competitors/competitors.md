# Competitor Analysis — Summary

**Competitors analyzed:** Adapted, GOWOD, StretchIt, Pliability, Hinge Health
**Date:** 2026-04-08

Individual deep-dives: [Adapted](adapted-competitive-analysis.md) · [GOWOD](gowod-competitive-analysis.md) · [StretchIt](stretchit-competitive-analysis.md) · [Pliability](pliability-competitive-analysis.md) · [Hinge Health](hinge-health-competitive-analysis.md)

---

## Cross-Cutting Themes

### 1. Onboarding is the core activation moment — and most are doing it wrong

Every app uses a questionnaire/assessment as the entry point. The split in approaches is instructive:

- **Goal-oriented** (StretchIt, GOWOD): "What do you want to achieve?" → maps to a preset program. Fast but shallow.
- **Body-condition-oriented** (Adapted, Hinge Health): "What's wrong, where, and how bad?" → generates a personalized protocol. Slower but higher clinical value.
- **StretchIt's chatbot is actively hurting them** — multiple 1-star reviews asking to remove it. The lesson isn't "don't do conversational onboarding" — it's **don't make it slow**. Adapted does the same pattern but with explicit phases (`clinical_assessment → training_background → complete`) that feel purposeful.

**Opportunity:** Body-condition + training-background framing, done quickly (~3–5 questions), with a **capacity/trust scale** (Adapted's 0–4 "how much do you trust this region") instead of a pain scale.

---

### 2. The "AI" claim is mostly fake — and users are starting to notice

| App          | What "AI" actually means                                              |
| ------------ | --------------------------------------------------------------------- |
| GOWOD        | Server-side rule function (v5 model) — not LLM                        |
| StretchIt    | Questionnaire → preset program lookup (`ProgramQuize.plist`)          |
| Pliability   | Goal/sport quiz → preset program map                                  |
| Adapted      | LLM-generated programs with feedback loop (actual AI)                 |
| Hinge Health | AI motion tracking (camera form correction) — real AI, different type |

Adapted is the only direct competitor using actual LLM generation for prehab programs. Hinge Health uses real CV/ML but for a different purpose (form correction, not program design). The gap is real and closeable.

---

### 3. Adaptive programs (not static) are the differentiator users care about

Adapted's progressive session generation and session-level regeneration with feedback is called out positively in reviews by name. Static programs — day 1, day 2, etc. — are the norm for everyone else. The behavioral evidence: users specifically leave GOWOD and Pliability for apps that feel more personalized.

Three mechanisms worth building:

- **Progressive generation** — next session only generated after the previous is completed
- **Session regeneration with feedback** — explicit "this was too easy/hard/painful" after each session
- **On-demand sessions** alongside the scheduled program (Adapted has `activation / mobility / recovery` types)

---

### 4. Progress measurement = retention. Nobody's doing it well in prehab.

GOWOD's strongest retention hook is their "18% mobility improvement in 60 days" claim, backed by a mobility score. Hinge Health tracks pain scores longitudinally and it's praised in reviews. Pliability has a camera-based mobility test but uses it only at intake.

Nobody is closing the loop: **measure → program → remeasure → show delta**. For prehab (where the user's goal is "not get hurt" — hard to celebrate), this matters more than in flexibility apps.

---

### 5. Human layer = trust and retention at the high end

Hinge Health's dedicated PT + health coach model drives their exceptional 4.93 rating and long-term retention. Adapted explicitly has no human layer and it shows up as a gap. Pliability has no PT credibility at all.

The full Hinge Health model is B2B-gated and expensive. But **async PT review** — a PT checks your program weekly, messages you — is achievable and positions neatly between pure-AI (Adapted) and full-clinical (Hinge Health).

---

### 6. Billing practices are destroying trust for incumbents

Pliability and StretchIt both have **billing as their #1 negative review theme** — auto-renewal with no notice, impossible cancellation, "thieves." This is a brand risk they've accepted as a churn-reduction lever. It's a direct opening for a competitor to win on trust alone.

Table stakes to avoid their mistakes:

- Transparent renewal notifications
- Web cancellation (not app-only)
- Honest free tier

---

### 7. Pricing anchors and conversion patterns

| App          | Monthly    | Annual      | Free trial                   |
| ------------ | ---------- | ----------- | ---------------------------- |
| Adapted      | $8.99      | $39.99/yr   | Limited free tier            |
| GOWOD        | ~$14       | ~$125/yr    | Limited free (top complaint) |
| StretchIt    | ~$20       | ~$80–190/yr | 7-day (deceptive complaints) |
| Pliability   | ~$19       | ~$180/yr    | 7-day + 50% retention offer  |
| Hinge Health | Free (B2B) | —           | N/A                          |

Adapted's pricing is clearly positioned as the affordable, accessible option ($39.99/yr vs ~$180 for Pliability). There's room at both ends — the **$40–80/yr sweet spot is underserved with quality**.

---

### 8. Shared infrastructure consensus

Across all analyses, strong convergence on the right tools:

| Tool       | Used by                 | Notes                                                         |
| ---------- | ----------------------- | ------------------------------------------------------------- |
| RevenueCat | Adapted                 | StretchIt/GOWOD don't use it and it shows in UX               |
| PostHog    | Adapted                 | Session recording; valuable for early-stage product decisions |
| Sentry     | Adapted, Hinge Health   | Error tracking                                                |
| Firebase   | All except Hinge Health | Auth, Remote Config, A/B testing                              |
| Mux        | Pliability              | Notably better than self-hosting video to CloudFront          |
| Stream.io  | Hinge Health            | Best option if adding a human/chat layer                      |

---

## Gap Summary — Our Opportunity Space

| What incumbents lack                             | Severity |
| ------------------------------------------------ | -------- |
| Real adaptive AI (not rule-based)                | High     |
| Body-condition intake (not just goals)           | High     |
| Transparent billing practices                    | High     |
| Prehab/rehab positioning vs. flexibility/fitness | High     |
| Capacity/trust framing over pain scale           | Medium   |
| PT credibility without full B2B model            | Medium   |
| Progress measurement in prehab context           | Medium   |
| Complete body coverage (neck, wrist)             | Low      |

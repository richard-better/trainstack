# TrainerDay official public-source research

Verified 2026-10-13. Public documentation plus root live Chrome privacy observation UI-051. This worker made no account access, OAuth grants, payments, subscriptions, installations or data mutations.

Some blog pages appear generated or stale. Current releases and live UI should override old feature roadmaps. App ratings, library counts and efficacy statements are published vendor claims. Privacy is reconciled against root live Chrome evidence UI-051.

## Product and positioning

TrainerDay combines a structured cycling workout community, workout authoring, customizable plans, calendar, trainer-control apps, and integrations for indoor/outdoor use. Current homepage advertises 40,000+ workouts, 4.7/5 from 3,000+ reviews, fast startup, Today recommendations, and an AI workout editor. Its core positioning is inexpensive, flexible training using the rider's existing devices and platforms.

Source: [https://trainerday.com/](https://trainerday.com/)

Caveats: Library size, review aggregation, startup speed, and superlatives are vendor claims, not measured in this investigation.

## Pricing and free limits

Free: community workout/plan downloads, workout creator, mobile app with 20 included structured workouts, Strava sync, and three one-click external sends per month. Pro: $4.99 per month, or advertised $3.33/month billed annually, including Coach Jack, AI Plan Builder, unrestricted mobile library, plan sends to TrainingPeaks/Intervals/Garmin, and calendar with Zwift sync.

Source: [https://trainerday.com/pricing/](https://trainerday.com/pricing/)

Caveats: Annualized advertised rate does not establish exact annual checkout total, currency conversion, tax, or regional price. Historical forum pricing $3.99 is outdated.

## Subscription terms

Subscription page advertises cancel-anytime billing and a 30-day money-back guarantee. Payment logos include Authorize.net and PayPal. It says TrainerDay does not collect/store credit-card information. Marketing states 100K+ active users and a 4.8-star app rating.

Source: [https://trainerday.com/subscribe](https://trainerday.com/subscribe)

Caveats: No transaction or subscription action performed. Store subscription refunds may follow store processes; active-user count is unverified.

## Client downloads

Official download page offers Mac Apple Silicon, separate Intel Mac download, Windows 10/11, iPhone/iPad, and Android. It labels iOS as 15+.

Source: [https://trainerday.com/download](https://trainerday.com/download)

Caveats: Apple App Store separately lists iOS/iPadOS 13.3 minimum. Native desktop download is distinct from Apple Silicon running the iPad app. No binary downloaded or installed.

## Mobile workout execution

Quick Start begins riding before selecting a workout. Today recommends sessions by duration; Workouts includes favorites, custom workouts, lists and duration/intensity search; Planned shows own calendar, active plan or external WOD. Cards expose duration, stress, intensity and interval graph. During a ride: auto/manual start/pause, skip segment, extend, chart zoom, interval/total time displays, target/actual watts, cadence, HR, speed, distance and calories. Switch ERG/Slope/HR+ and merge another workout. Activities show charts and averages; configured connections export completed rides to TrainingPeaks, Dropbox or Strava.

Source: [https://trainerday.com/blog/our-mobile-app](https://trainerday.com/blog/our-mobile-app)

Caveats: Intro describes Strava via Garmin while later text describes configured Strava connection; exact path needs account/runtime verification.

## Desktop workout execution

Desktop mirrors Today/Workouts/Planned and flexible ride controls. Extras include mobile remote control, embedded YouTube, local video library with configured root folder, native Bluetooth and ANT+, and Echelon bike support without a bridge. Published protocol examples include FTMS, Tacx and Wahoo. Progress tracks load, fitness, trends and zone distributions. Activity details include zone breakdown and configured export to TrainingPeaks/Dropbox/Strava.

Source: [https://trainerday.com/blog/our-desktop-app](https://trainerday.com/blog/our-desktop-app)

Caveats: All-smart-trainer compatibility is broad marketing, not an exhaustive tested device matrix. Desktop features were not executed.

## Android current release and Health Connect

Developer listing updated October 12, 2026. Optional Health Connect writes sessions with heart rate, power, cadence, calories and distance and reads current body weight. Listing identifies standard HR sensors/power meters, Wahoo Core/Kickr/Snap, Tacx Neo/Flux/Flow/Vortex/Bushido, Elite Direto, Saris H2/H3, Stages SB20 and JetBlack Volt. ANT+ is stated to work on older Samsung devices; older non-FTMS Elite trainers need ANT+. Free bundle includes 20 workouts and ramp test. Latest notes mention power-zone workout colors, Classic blue option shared with web, improved contrast, and missing-zone search crash fix.

Source: [https://play.google.com/store/apps/details?id=trainerday.turbo](https://play.google.com/store/apps/details?id=trainerday.turbo)

Caveats: Store says 20K+ workouts vs site 40K+. It associates Strava auto-sync with Premium while pricing site lists free Strava sync. Device availability may depend on hardware/OS.

## iOS current release and Apple Watch

Version 10.1.8 dated September 21 shows Progress/Calendar from Today, local Strava/Garmin activity graphs, sport icons, calories/training stress, and running GAP with pace graph relative to 5K pace. July release added in-app workout editing; April release fixed interval comments appearing during rides. Apple Watch is advertised for HR/stats/session control. Listing says Bluetooth only, no ANT+. US in-app prices are $4.99 monthly and $44.99 annual. Store lists iOS 13.3, watchOS 9.6, 59 MB and ten languages; 4.8 from 742 ratings.

Source: [https://apps.apple.com/us/app/trainerday-indoor-cycling/id1500401973](https://apps.apple.com/us/app/trainerday-indoor-cycling/id1500401973)

Caveats: Year inferred from current release sequence. Publisher metadata not independent testing. 20K library, iOS minimum and annual price differ from website. Terms minimum age 16 differs from store age rating4+.

## Apple Health limits

Guide says basic Apple Health integration records cycling but omits detailed power/cadence/interval metrics; native integration needs Apple Watch, with FIT-to-HealthFit or RunGap workarounds described. HealthFit direct integration is described as absent.

Source: [https://trainerday.com/blog/guide-to-apple-health-integration-1](https://trainerday.com/blog/guide-to-apple-health-integration-1)

Caveats: Article promises improvements in late 2025/early 2026 and is stale as of October 2026. Current store says workouts auto-sync but does not establish metric completeness. Do not treat roadmap as delivered.

## Offline behavior

Mobile workouts can run offline after loading/caching them online, and completed data syncs after reconnection. Guidance recommends opening each intended workout in advance. Web planning needs internet. Casting preloaded workouts is suggested for larger displays.

Source: [https://trainerday.com/blog/guide-to-offline-training-1](https://trainerday.com/blog/guide-to-offline-training-1)

Caveats: No airplane-mode test performed. Cache lifetime and auth-expiration behavior are unspecified. Desktop offline support is not established by this page.

## Trainer setup and control

Devices are paired using Add devices, then sensor/control roles selected. ERG controls target watts, Slope simulates grade, Resistance fixes resistance. FTP settings calibrate workout targets. Guide warns of concurrent app connection conflicts and wheel-circumference effects on some wheel-on virtual-power setups.

Source: [https://trainerday.com/blog/guide-to-smart-trainer-setup-1](https://trainerday.com/blog/guide-to-smart-trainer-setup-1)

Caveats: Published generic troubleshooting, not model-specific confirmation. Broad 20-50% trainer-difficulty recommendation may be generic and is not a tested setting.

## Heart-rate power control

HR+ adjusts target power automatically to hold a selected heart-rate range, marketed for Zone2 using aerobic-threshold heart rate. Vendor suggests TrainerDay can control intensity alongside Zwift. Advertised as part of Pro ($3.33 annualized/$4.99 monthly).

Source: [https://trainerday.com/zone2/](https://trainerday.com/zone2/)

Caveats: HR physiological validity and device interoperability not independently tested. Requires appropriate sensors/trainer for automatic control.

## Plan creation options

Five published routes: Coach Jack questionnaire, conversational AI Plan Builder with training guardrails, premium prebuilt Coach Jack plans, community free plans, and manual plans/custom blocks. All converge on calendar and Today/Planned execution.

Source: [https://home.trainerday.com/blog/training-plan-options](https://home.trainerday.com/blog/training-plan-options)

Caveats: No AI model, prompt system, guardrail implementation, or output quality verified.

## Coach Jack methodology

Coach Jack is based on rules from European cycling coaches and plans by Andrea Morelli. Questionnaire/recommendations can use Strava. Plans allow hours/intensity/focus adjustment and send/export to external platforms or TrainerDay. Philosophy favors consistent aerobic training, a higher easy-work ratio, and targeted hard sessions over maximizing TSS or repeated suffering. Site prefers ramp-test FTP and acknowledges flatter TT riders/20-minute FTP estimates can make plans feel easier.

Source: [https://www.trainerday.com/coach-jack/](https://www.trainerday.com/coach-jack/)

Caveats: Claims about scientific proof and World Tour success are marketing statements, not a literature review. Historic Strava requirement may differ in newer builder.

## Coach Jack structure and scheduling

Rule-based generation uses goals, available days, fitness and time. Specific event plans support Foundation/Build/Sharpen/Race. Workouts use warmup/main work/secondary work/cooldown. Block durations progress from minimum to maximum times. Sending to calendar defaults to following Monday. Plans remain editable; outside completion can be reported.

Source: [https://trainerday.com/blog/guide-to-coach-jack-plan-builder-1](https://trainerday.com/blog/guide-to-coach-jack-plan-builder-1)

Caveats: Getting Started calls Coach Jack an AI builder, but this guide specifies rules. Founder December 2025 explicitly distinguished Coach Jack from newer AI features. Whether core algorithm changed is unknown.

## Ride Feel

Ride Feel adjusts secondary work/training stress while preserving the workout's main work, allowing harder/easier overall feel without rewriting the intended primary stimulus.

Source: [https://trainerday.com/blog/coach-jack-ride-feel](https://trainerday.com/blog/coach-jack-ride-feel)

Caveats: Published mechanism only; precise calculations/limits unknown.

## Reusable plans versus dates

My Plans saves reusable/shareable sequences. A plan can be active in mobile without dates; completing a session advances to the next workout after confirmation. Skipping ahead ignores earlier workouts. Calendar instead anchors planned/completed activities to dates.

Source: [https://trainerday.com/blog/my-plans-vs-calendar](https://trainerday.com/blog/my-plans-vs-calendar)

Caveats: Current UI labels may have changed.

## Simple calendar

Calendar supports adding/deleting weeks, library workouts, and Coach Jack/other plans. Coach Jack edits can automatically resync to Garmin/TrainingPeaks. Guide also links power-to-HR conversion.

Source: [https://trainerday.com/blog/simple-calendar](https://trainerday.com/blog/simple-calendar)

Caveats: Sync timing and conflict/error resolution not specified.

## External calendar direction

FAQ clarifies TrainerDay calendar sync sends its planned workouts to TrainingPeaks/Intervals. External calendars are not mirrored into TrainerDay web calendar by that mechanism; WOD makes upcoming external workouts available in TrainerDay training apps. Page indexes broadcast, target modes, route importing, sets/reps, testing and training concepts.

Source: [https://trainerday.com/blog/trainerday-learn-everything](https://trainerday.com/blog/trainerday-learn-everything)

Caveats: Current integration behavior still requires account-specific confirmation.

## TrainingPeaks workflow

TrainingPeaks can act as bridge to Rouvy, TrainerRoad, Zwift, Wahoo and others. Individual sends can use free TrainingPeaks. Article says sending an entire dated plan requires TrainingPeaks Premium or all workouts land on one day. WOD pulls upcoming external scheduled workouts into app Plan view; refresh may be needed.

Source: [https://trainerday.com/blog/trainerday-and-trainingpeaks](https://trainerday.com/blog/trainerday-and-trainingpeaks)

Caveats: External service behavior may change. Paid TrainerDay gating differs from historic prose; current pricing prevails.

## Import/export and sharing

Workout creator imports ZWO/ERG/MRC. Workout download exports MRC/ZWO/ERG; ZWO can be placed in Zwift user workout directory. Public workouts join community search; private sharing can use direct links. Published integration list includes bidirectional TrainingPeaks workout exchange, Garmin workouts/calendar/plans, Intervals.icu and Google Calendar sync.

Source: [https://trainerday.com/blog/enhancing-training-flexibility-with-import-export-and-sharing-features](https://trainerday.com/blog/enhancing-training-flexibility-with-import-export-and-sharing-features)

Caveats: Workout file imports are distinct from route/activity imports. Google Calendar direction/auth/mechanism not specified. Direct-link privacy must be checked in live settings.

## Library organization

Lists group workouts with chosen sort order/quick mobile access. Private/public tags support personal organization and community discovery; hash-tag autocomplete aids search. Wahoo MRC, Zwift ZWO and Garmin FIT export described. Coach Jack workouts can be saved into library via My Plans. Whole-list export workaround creates a plan and drags workouts onto days before exporting/sending.

Source: [https://trainerday.com/blog/efficient-workout-library-organization-in-trainerday](https://trainerday.com/blog/efficient-workout-library-organization-in-trainerday)

Caveats: FIT structured workout export claim is published but was not generated. Whole-list workaround may be obsolete.

## V2 workout editor

Second-generation table editor supports multirow sets/groups with Cmd+Shift+D; minute input accepts 1:30 or 1.5 and :30 or .5. Power can use start/end ramps such as 40-70. Control modes are ERG/Slope/HR+. Types include warm-up,active,rest,cooldown,interval,free-ride,open-ended,climb,sfr,lap and + main / - secondary work.

Source: [https://trainerday.com/blog/the-fastest-workout-editor](https://trainerday.com/blog/the-fastest-workout-editor)

Caveats: Guide labels slope in degrees despite grade language elsewhere. Interpret displayed units from UI.

## Ramp conversion constraints

Native ramp support is documented for MRC/ZWO/ERG and TrainerDay/Zwift. Garmin and TrainingPeaks exports convert ramps to discrete steps. Article identifies Garmin 50-step limit and recommends simplifying complex workouts/previewing conversions.

Source: [https://trainerday.com/blog/ramps-and-steps-in-trainerday](https://trainerday.com/blog/ramps-and-steps-in-trainerday)

Caveats: The exact device-specific limit and conversion algorithm not inspected. Approximation should not be treated as identical execution.

## Mixed control modes

TrainerDay workout execution can automatically switch ERG, Slope and HR+ within a session. Doc explicitly limits mixed-mode behavior to TrainerDay Training App; it positions ERG for steady targets, slope for gears/cadence/short intervals and HR+ for endurance.

Source: [https://trainerday.com/blog/enhancing-indoor-cycling-with-mixed-mode-workouts](https://trainerday.com/blog/enhancing-indoor-cycling-with-mixed-mode-workouts)

Caveats: External exports may lose mode semantics.

## Free ride/open-ended semantics

Garmin open-ended intervals continue until Lap; editor accepts fr/free-ride with estimated duration. For Garmin a 60% FTP free-ride target is described as expanding to 40-100%. Zwift free-ride means slope/resistance riding and doc says it needs ZWO download rather than TrainingPeaks.

Source: [https://trainerday.com/blog/free-ride-and-open-ended-intervals-garmin-zwift](https://trainerday.com/blog/free-ride-and-open-ended-intervals-garmin-zwift)

Caveats: New editor distinguishes open-ended type; terminology has evolved. Verify exporter details in current app.

## Interval comments

Editor supports interval instructions with an offset for display, historically via Zwift ZWO. Guide advises nonzero offset (e.g. 0.5s) and describes cadence/effort cues.

Source: [https://trainerday.com/blog/enhancing-workouts-with-interval-comments-in-trainerday](https://trainerday.com/blog/enhancing-workouts-with-interval-comments-in-trainerday)

Caveats: Blog says mobile support forthcoming, but April 2026 iOS changelog fixes interval comments during workouts, showing blog is stale. Offset rule untested.

## Route replay

GPX/TCX route import can replay recorded power in ERG or estimate targets when no power exists using terrain/other route data. Sources mentioned include Strava, Garmin, RideWithGPS and Google Maps.

Source: [https://trainerday.com/blog/enhancing-indoor-training-with-route-importing-in-trainerday](https://trainerday.com/blog/enhancing-indoor-training-with-route-importing-in-trainerday)

Caveats: Article says FIT route import forthcoming. API FIT activity upload is a different workflow and does not prove route replay FIT support. Estimates unvalidated.

## REST developer API

Personal bearer API keys and organization OAuth2 are documented. Endpoints read athlete FTP/zones, date-ranged calendar and activities; create/update/delete calendar events; upload TCX/GPX/FIT activities. Scope families athlete/workout/calendar/activities have read/write. OAuth application registration requires contacting TrainerDay; access tokens expire after6 hours; refresh,revoke,introspection endpoints documented. Swagger explorer linked.

Source: [https://api.trainerday.com/](https://api.trainerday.com/)

Caveats: No key generated, OAuth authorized or API mutation made. Explorer is JavaScript-only in web text, so full schema not inspected. Homepage does not enumerate workout REST endpoints despite scopes.

## MCP and AI access

Public MCP endpoint https://api.trainerday.com/mcp uses OAuth with chosen permissions. Documentation advertises athlete profile/FTP, calendar read/write/reschedule/delete, load metrics CTL/ATL/TSB/FitScore, history/trends and one-call training summary. ChatGPT documentation says free accounts work; main API page advertises Claude custom connector and says Gemini unverified.

Source: [https://api.trainerday.com/mcp/chatgpt.html](https://api.trainerday.com/mcp/chatgpt.html)

Caveats: Setup instructions concern external products and are vendor docs, not verified current OpenAI guidance. FitScore is visible in current UI, but live privacy policy says leaderboard testing never used rider data. No connector added or authorization performed.

## Corporate identity and support

TrainerDay Inc is the published entity, with office/contact address2531 Sahalee Drive West, Sammamish, WA 98074, USA. Contact form handles billing/general questions; active community forum is promoted as fastest response. Public API provides hello@trainerday.com; store provides support@trainerday.com.

Source: [https://trainerday.com/contact-us](https://trainerday.com/contact-us)

Caveats: No contact sent. Founder identity Alex is self-identified in Getting Started; surname/current ownership not established.

## History and technical public statements

Founder account states TrainerDay began as ERGdb, a free workout-sharing platform. Article cites a rider's 2022 season and transition to 2023.

Source: [https://home.trainerday.com/blog/a-cyclist-and-his-coach](https://home.trainerday.com/blog/a-cyclist-and-his-coach)

Caveats: Historical origin, not current ownership evidence.

## Progress and technology announcement

Founder April 13, 2026 announced desktop core metrics and intention to align web/mobile without matching depth of Intervals.icu. May 18 founder stated website uses Vue and desktop uses React.

Source: [https://forums.trainerday.com/t/try-our-desktop-new-progress-metrics-tab/72407](https://forums.trainerday.com/t/try-our-desktop-new-progress-metrics-tab/72407)

Caveats: Official forum statements only, not bundle analysis. Feature availability evolved after announcement.

## Terms scope

Terms minimum age 16; periodic vendor emails opt-out allowed. User content grants broad usage license; imported third-party workouts should remain private. Data mining/harvesting/extraction restricted except approved API community use or written permission. Governing law Washington State.

Source: [https://trainerday.com/terms-and-conditions/](https://trainerday.com/terms-and-conditions/)

Caveats: Research limited to ordinary docs/product reads, no bulk workout extraction. This summarizes policy, not legal advice.

## Current privacy policy and cache discrepancy

Root agent verified live October 9, 2026 policy. Mixpanel was removed; analytics are self-hosted. Vendors: DigitalOcean app servers and managed PostgreSQL/MongoDB, AWS SES/S3, Cloudflare CDN/security/map tiles, Sentry technical errors with numeric user ID, and Stripe/Authorize.Net/PayPal/Apple/Google payments. Anthropic/OpenAI receive AI job text without name/email/account ID; connected assistants receive approved day-level summaries, no original provider activity records, with no model training. FitScore leaderboard addendum was removed: the feature never passed testing and no rider data was used that way. Export/deletion requests remain documented.

Source: [https://trainerday.com/privacy-policy](https://trainerday.com/privacy-policy)

Live evidence: UI-051 (root Chrome observation).

Caveats: Live Chrome UI-051 supersedes old web-open cache mentioning Mixpanel and December 2025 FitScore use. UI still visibly offers FitScore as a testing/Progress feature; availability does not prove leaderboard/data use. Policy retains a generic third-party analytics cookie sentence and indefinite-retention language alongside deletion assurances.

## Public calculators

Ancillary public calculators cover power-to-speed, speed-to-power, GPX/TCX route-time prediction, VO2max from single efforts and gearing by speed/cadence.

Source: [https://cycling-calculators.trainerday.com/](https://cycling-calculators.trainerday.com/)

Caveats: Models/formula quality not reviewed.

## Unresolved

- FitScore calculation validity, analytics depth, and mobile/web parity.
- Current account entitlements, exact annual checkout, regional/tax prices.
- Trainer hardware compatibility beyond published matrices.
- New AI model/provider/guardrail internals.
- Actual route FIT parsing and third-party export fidelity.
- Google Calendar delivery and failure behavior.

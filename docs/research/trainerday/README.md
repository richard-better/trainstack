# TrainerDay product and technical reference

Verified on October 13, 2026. TrainerDay combines a workout community, structured workout editor, reusable plans, dated calendar, trainer-control apps, activity analysis, and external integrations. Its current web app also exposes AI creation and a public developer service.

This reference collects observations from signed-in Chrome, official documentation, the public OpenAPI schema, and bounded analysis of shipped JavaScript. It supports product comparison and future implementation work in TrainStack. It does not establish the behavior of untested hardware, backend services, or generated plans.

## Reference files

| File | Contents |
| --- | --- |
| [observations.json](observations.json) | Curated UI evidence, source pages, and coverage checklist. Personal activity values, identity, and calendar subscription links are omitted. |
| [public-sources.md](public-sources.md) | 36 topics covering pricing, native apps, training methods, integrations, support, and privacy. |
| [public-sources.json](public-sources.json) | The same published findings with sources and caveats. |
| [technical.md](technical.md) | Frontend architecture, route inventory, service boundaries, and workout model. |
| [technical.json](technical.json) | REA Evidence IDs, asset digests, static locations, and endpoint candidates. |
| [api-inventory.json](api-inventory.json) | Derived public API operations and schema field inventory without copied prose. |
| [overview.html](overview.html) | Searchable feature map with evidence type and links. |

## Workout discovery and authoring

The signed-in search page has a natural-language-style search box, popularity/date sorting, and ascending or descending duration, stress, and intensity. Advanced filters include the rider's library, text descriptions, author descriptions, cadence targets, interval comments, and minimum/maximum duration, stress, and intensity. Cards show category, title, graph, duration, stress, intensity, popularity, author, date, and Add to, Send To, and Share actions. [Search Workouts](https://app.trainerday.com/search?forceLoadData=true), UI-005 through UI-007.

A representative workout detail page displays sport, duration, stress, intensity, popularity, an interval chart, outdoor text instructions, author description, interval comments when available, and time in each of six power zones. Target watts reflect the athlete's FTP. Its menu exposes copying, link copying, and file download. Opening the download action did not expose a format dialog during this pass; calendar export and documentation separately establish supported formats. [Representative workout](https://app.trainerday.com/workouts/vo2-max-1-8x4min-120), UI-008 through UI-014.

The creator is a spreadsheet-style interval editor with cumulative time, interval minutes, target, and notes. Target display supports FTP percentage, watts, or zones. Optional columns include cadence, control mode, notes, and interval type. The page previews time in zones, stress, intensity, outdoor representation, and W' balance. Keyboard hints include Cmd+D duplication and Cmd+Shift+D repeat blocks. [Workout creator](https://app.trainerday.com/workouts/create), UI-015 through UI-017.

Its file workflow distinguishes routes from structured workouts. Route import accepts GPX, TCX, and FIT and advertises ERG/slope conversion. Structured workout import accepts ZWO, ERG, and MRC. The AI tab accepts a cycling description and offers eight sample prompts covering sweet spot, tempo, VO2max, Tabata, HIIT, endurance, recovery, and threshold. Custom prompts display Pro gating copy. No generation or save was submitted. [Workout creator](https://app.trainerday.com/workouts/create), UI-018 and UI-019.

My Workouts organizes the library into lists, including Favorites, with list-scoped search, sorting, and a List Manager. An empty list links to the TrainerDay Ramp Test. Today offers 30, 45, 60, 75, 90, or 120 minute recommendations and surfaces scheduled workouts. Recommendation cards distinguish a fun option, intensity, and endurance/recovery. [My Workouts](https://app.trainerday.com/library?forceLoadData=true), UI-020. [Today](https://app.trainerday.com/today), UI-021.

## Plans and scheduling

The current plan catalog separates premium and community plans. Premium plans credit Andrea Morelli and describe Foundation, Build, Sharpen, and Race phases. Visible families include Classic Base, Base Plus, Crunched Power, Fitness Cyclist, Big Climbs, and Big Days, with three, four, or five days per week. Community search filters days per week and daily minutes. It displayed 180 plans across 18 result pages at the observed time. That is a UI count, not an independently enumerated catalog. [Training Plans](https://app.trainerday.com/training-plans), UI-028 through UI-030.

Community plan cards show phase, author, date, days per week, weeks, average daily stress/minutes, composition, and example workouts. The catalog describes plans as convertible: changing weekly frequency rescales the plan length. Detail pages show daily workout cards, weekly duration/stress totals, composition, and Duration, Intensity, or Stress chart views. The Add to my plans action was visible but not submitted. [Plan detail](https://app.trainerday.com/plans/vo2max-booster), UI-052.

The builder chooser distinguishes Coach Jack from AI Plan Builder Beta. Coach Jack advertises nine plan types, daily hours and indoor/outdoor control, and recovery weeks. Named examples include Polarized, Sweet Spot, and Italian. AI creation advertises broader structures and later chat refinement. Both paths entered a 12-question questionnaire. Initial questions cover goal, event date, plan duration, and recovery from injury or illness. Duration choices are four, eight, twelve, or sixteen weeks, or six months. The pass stopped before health inputs or plan generation. Temporary example selections were reset. [Plan builders](https://app.trainerday.com/coach-jack), UI-032 through UI-042.

My Plans is a separate personal collection with search, filters, and a new-plan action. A reusable sequence and dated calendar are different product concepts. Public guidance describes active undated plans advancing after completion, while a calendar fixes workouts to dates. [My Plans](https://app.trainerday.com/plans?forceLoadData=true), UI-031. [Plans versus calendar](https://trainerday.com/blog/my-plans-vs-calendar).

The calendar displays weeks, planned workouts, completed activities, provider labels, and weekly totals. Export uses a date range and ERG, ZWO, MRC, or PLAN for Wahoo. The dialog describes a ZIP containing a CSV overview and workout files. It also exposes an ICS subscription for external calendars. The personal ICS address is deliberately absent from these files. A warning can identify when the TrainerDay calendar is not active in the mobile app. [Calendar](https://app.trainerday.com/calendar), UI-022 through UI-024.

## Activities and progress

My Activities displays a year of weekly cycling hours, ride count, current-week totals, activity search, and Strava re-sync. Cards contain sport, duration, power or running GAP, heart rate, speed or pace, distance, stress, intensity, and provider badges. The observed collection included cycling, running, and other sports. [Activities](https://app.trainerday.com/activities), UI-025.

Activity detail exposes rename and perceived exertion, sensor charts, W' balance, configurable Watts/RPM/HR series, ranges, and power/HR zones. The range table includes duration, average and maximum power, average HR, average cadence, and zone, plus download. Cmd+A is advertised for adding a 30-second range. No personal record was edited. Activity-specific identifiers and measurements are omitted from the saved evidence. UI-049 and UI-050 at the signed-in Activities detail screen.

Progress displays FitScore and Classic choices, easy/moderate/hard intensity distribution over four weeks, a year-long fitness display, Coggan time in power or HR zones, an eight-week stress balance, and a cycling power-duration curve with 90-day and one-year comparisons. FitScore UI includes aerobic, strength, consistency, and variety components. Selecting Classic did not yield a confirmed changed view before navigation, so this pass establishes the control's presence rather than its calculation. [Progress](https://app.trainerday.com/analytics), UI-026 and UI-027.

## Integrations

The table describes the current Connections screen, not successful end-to-end delivery. No connection or synchronization setting was changed. [Connections](https://app.trainerday.com/apps-and-devices), UI-043.

| Destination | Published on the current screen |
| --- | --- |
| Strava | Post completed activities. Imported Strava activities were also visible in calendar and activity screens. |
| Zwift | Send planned workouts and sync the TrainerDay calendar into its TrainerDay folder. |
| MyWhoosh | Calendar sync requires paid TrainerDay. Initiate the connection inside MyWhoosh profile settings. |
| TrainingPeaks | Post activities/workouts, obtain current calendar workouts, and sync the calendar. Separate WOD and calendar toggles. Calendar sync says only today and tomorrow. |
| Garmin | Planned workouts and calendar in power or HR. Sending an entire plan is power only. The screen says completed activities cannot sync because of Garmin policy. |
| Intervals.icu | Post workouts and calendar sync. Home-page copy also describes external WOD in the training app. |
| COROS | Upload activities, send planned workouts, and sync the calendar. |
| Dropbox | Post TCX or FIT activities to its TrainerDay folder. |
| Google Calendar | One-click training-plan sends require a paid membership. ICS subscription is separately available in calendar export. |
| Wahoo | Send planned workouts. |

Workout Send To offers My calendar, Zwift, COROS, Garmin, Intervals.icu, TrainingPeaks, and Wahoo. Unconnected destinations can be disabled. The dialog also exposes Power and Simplified choices; no final Send action was used. [Workout detail](https://app.trainerday.com/workouts/vo2-max-1-8x4min-120), UI-009 and UI-010.

## Athlete and display settings

Sports configuration offers Cycling, Swim-Erg, Row-Erg, and Running. Cycling has FTP history, threshold HR, optional global HR reuse, and editable power-zone boundaries. Profile settings include time zone, language, metric/imperial units, weight, bike weight, and drag coefficient for estimated indoor speed/distance. Display controls include zone-colored versus classic blue charts and an account-wide dark theme. No profile update was submitted. [Sports profile](https://app.trainerday.com/account/profile), UI-045 through UI-047. [Account](https://app.trainerday.com/account/settings), UI-048.

The Account screen displayed Pro while the AI workout tab displayed custom-prompt Pro gating text. That copy is insufficient to infer actual entitlement failure. Billing validation and an attempted generation were outside this pass.

## Native apps and business model

TrainerDay publishes iPhone/iPad, Android, native Mac for Apple Silicon and Intel, and Windows clients. Training apps document ERG, slope, HR+, quick start, interval adjustments, merged workouts, and provider exports. Desktop guidance adds ANT+, video, and mobile remote control. iOS uses Bluetooth; Android ANT+ depends on hardware. These are published capabilities, not native execution observations. [Downloads](https://trainerday.com/download), [mobile guide](https://trainerday.com/blog/our-mobile-app), [desktop guide](https://trainerday.com/blog/our-desktop-app).

Web pricing advertises $4.99 monthly or $3.33 per month billed annually. Free access includes community downloads, authoring, twenty bundled training-app workouts, and three external sends per month. Pro includes Coach Jack, AI plans, the app library, and calendar/integration capabilities. Regional checkout and taxes were not inspected. Public-sources.md records store-specific pricing and discrepancies. [Pricing](https://trainerday.com/pricing/).

## Public API and shipped architecture

The live explorer declares OpenAPI 3.0.1 and API version 2.0.0. Its current specification contains sixteen operations across fifteen path keys. It documents bearer authentication, a rate limit of 100 requests per fifteen minutes, V1 athlete/activity reads and activity uploads, plus V2 calendar CRUD, ZWO workout creation, and activity reads/uploads/downloads. The landing page still shows V1 calendar examples, which are absent from the inspected spec. [API explorer](https://api.trainerday.com/api-explorer/), [specification](https://api.trainerday.com/api/v1/spec).

V2 prefers typed workout blocks. Public schema fields corroborate segments, sets, repetitions, ranged primary/cadence/slope/HR targets, timed notes, time/distance duration, control modes, and lap-button behavior. ZWO creation is private and paid, with optional library-list assignment. V2 activity records use PostgreSQL UUIDs and retain legacy Mongo IDs; file downloads require UUIDs and exclude activities sourced from external providers. Those are documented contracts, not authenticated response tests. See api-inventory.json and technical.md for field-level detail.

MCP at `https://api.trainerday.com/mcp` documents OAuth access to approved training summaries and calendar actions. The developer service also documents personal API keys and organization OAuth. No key, connector, or OAuth grant was created. [API documentation](https://api.trainerday.com/).

The inspected entry bundle declares `trainerday-webapp@4.6.241`, uses Vue and code-split routes, and identifies separate services for main data, activities, Coach Jack, integrations, billing, and events. Vite is inferred from shipped preload/dependency machinery. Vendor headers identify Vue 3.5.28, Vue Router 4.6.4, Vuex 4.1.0, vue-i18n 10.0.8, and Axios 1.13.5. REA records forty-nine route nodes. A bundled running-plan route has a preview guard; its existence alone does not prove general product availability. [Entry asset](https://app.trainerday.com/assets/index-CjwVpe-L.js). Exact REA IDs and limits are in technical.md.

## Other surfaces

Event Finder combines a map, sport/date filters, saved events, home-city controls, week/month groupings, and missing-event/problem reports. Results visibly contained duplicate-looking titles and inconsistent location labels. Event accuracy and completeness were not validated. No event was saved. [Event Finder](https://trainerday.com/events), UI-055.

The home page advertises live viewing of a mobile workout on another screen. Clicking Live View did not expose a new viewer or tab during this pass. That establishes an advertised entry point, not a working broadcast. [Home](https://app.trainerday.com/), UI-053 and UI-054. Public calculators, forums, support, and company history are cataloged in public-sources.md.

## Conflicts and limits

| Topic | Evidence and interpretation |
| --- | --- |
| Library size | Website advertises 40K+, stores say 20K+. Neither count was independently enumerated. |
| Subscription | Website annualized rate and US iOS annual price differ. Do not derive a universal annual charge. |
| FitScore | Progress visibly displays it. The October privacy addendum says it never passed testing and no rider data was used that way. This does not establish a public leaderboard. |
| Route FIT | Live import explicitly accepts FIT. Older route guidance describes FIT as forthcoming. |
| Interval comments | Older guide describes mobile support as future work. iOS release notes report comments during workouts. |
| iOS minimum | Download page says iOS 15+ while store metadata says 13.3. |
| API versions | Landing page V1 calendar samples differ from the current V2-only calendar specification. |
| Garmin activities | Current Connections says no completed-activity sync. Other product descriptions refer to Garmin activity analysis; direction, source, and client may differ. |

Privacy findings are summarized once in public-sources.md. The live October 9 policy supersedes the stale web cache and names current infrastructure/AI providers. It also retains conflicting older analytics wording. UI visibility, vendor claims, and verified execution are different evidence types.

Coverage is broad across the visible web product, but partial within each subsystem. No workout/plan was saved, activity edited, integration changed, billing action taken, credential read, or device paired. Native binaries, offline behavior, trainer control, AI output quality, algorithm internals, integration delivery, and full backend authorization remain unverified. REA covered the entry and two focused chunks, with a manually inspected vendor file. Other chunks were not analyzed, and its semantic graph hit a node limit.

## Implications for TrainStack

These are design inferences from the collected evidence:

- Keep reusable workouts, personal lists, plans, dated events, and recorded activities as separate resources.
- Use a typed interval model for repeats, ranged targets, sport units, control modes, and notes. Flattening too early loses export semantics.
- Store synchronization direction, target representation, calendar windows, and delivery status per provider.
- Keep planner generation separate from editing, scheduling, and workout execution.
- Distinguish a metric's visible chart from a validated physiological model.
- Compare published compatibility with device tests and preserve export conversion losses explicitly.

The source checklist in observations.json marks each area as answered, partially answered, or unresolved. New investigation passes can target those gaps without repeating the inventory.

# TrainerDay public bundle findings

Static inspection only. These findings establish shipped syntax and client-side data expectations; they do not prove requests executed or the server accepted them. No authenticated API calls or browser credential storage were accessed.

## Evidence

- Entry analysis: `ev_00033c66594ee3226dc2d5c1df14ab774894227f434cc273a19860f75ad20f10`; root SHA-256 `70bac0855e4a48d05551b3f31588533b65952bd461112dfa7686487a1964bf8a`.
- Entry summary projection: `ev_82d697061d09e7fb42ec46c3d910aa4f4331f87d4c3b19379cdb319ab08eb2fd`.
- Focused workout editor/detail analysis: `ev_93b1a93692eb5d8306a23d3518c66b671a640ed25f266d2f45daaaace029050a`; root SHA-256 `45f1bd173d64816c564c88a15c1f7dfbaf19695cf4655cd72b6da7c66b83bcfd`.
- REA parsed the entry file and the two focused files without parse failures. Application graph coverage is complete within those three files. Semantic coverage is partial in both analyses because REA reached its 100,000-node semantic limit.
- Vendor library headers were manually inspected with the digest below; the vendor was not fed into REA.

## Frontend

- The entry declares release `trainerday-webapp@4.6.241`.
- Vite is inferred from its dependency map and module-preload machinery. The exact Vite version is unknown.
- Vendor headers identify Vue 3.5.28, Vue Router 4.6.4, Vuex 4.1.0, vue-i18n 10.0.8, and Axios 1.13.5. Vue components and shared Vuex stores are visible in shipped syntax.
- Page components are code split: Activities, ActivityDetail, AccountSettings/Profile/Subscription, FTP/LTHR history, workout Create/Search/Library/Details, MyCalendar, MyPlans/PlanDetails, TrainingPlans, RunningPlanBuilder, AppsAndDevices, Analytics, Today, CoachJack question/plan screens, LlmPlanCreator, HomePage.
- Account, calendar, library, personal plans, activities, analytics, devices, Coach Jack and LLM-builder routes carry client-side `requiresAuth` metadata. This is client intent, not proof of backend access control.
- Public-facing routes include workout detail, search, shared library, training/community plans and shared calendar. Many features also have `/embed/...` variants.

## Routes

The entry graph records 49 literal route nodes:

- `/`
- `/:pathMatch(.*)*`
- `/account/checkout`
- `/account/ftp-history`
- `/account/lthr-history`
- `/account/profile`
- `/account/settings`
- `/account/subscription`
- `/activities`
- `/activities/:id`
- `/activities/vo2max-test-page`
- `/analytics`
- `/apps-and-devices`
- `/calendar`
- `/calendar/share/:shareId`
- `/coach-jack`
- `/coach-jack/plan/:mode`
- `/coach-jack/questioning`
- `/coach-jack/strava-callback`
- `/community-plans`
- `/embed`
- `/embed/analytics`
- `/embed/apps-and-devices`
- `/embed/calendar`
- `/embed/coach-jack`
- `/embed/coach-jack/plan/:mode`
- `/embed/coach-jack/questioning`
- `/embed/llm-plan-creator`
- `/embed/workouts/:id`
- `/event-plans/:id`
- `/events/questionaire/:id`
- `/library`
- `/library/:listSlug`
- `/llm-plan-creator`
- `/login`
- `/plans`
- `/plans/:slug`
- `/pricing`
- `/register`
- `/running-plan-builder`
- `/search`
- `/today`
- `/training-plans`
- `/training-plans/:slug`
- `/turbo/workouts/:slug/:version?`
- `/workouts/:id/copy`
- `/workouts/:id/edit`
- `/workouts/:slug/:version?`
- `/workouts/create`

The running-plan-builder route has a static guard: query `preview=1` admits that route; other entries redirect to the LLM plan creator. Do not infer that the running builder is generally exposed merely from its bundled code.

## Service boundaries

| Client role | Production base URL |
| --- | --- |
| main | https://app.api.trainerday.com |
| activities | https://api.data.trainerday.com |
| coach jack | https://app.api.trainerday.com/api/v1/cj |
| intervals icu | https://intervals.api.trainerday.com |
| garmin | https://garmin.api.trainerday.com |
| training peaks | https://tp.api.trainerday.com |
| wahoo | https://wahoo.api.trainerday.com |
| billing | https://billing.prod.trainerday.com/api |
| strava dropbox google | https://sdg.prod.trainerday.com |
| events | https://events-tracker.trainerday.com/webhook |

- API-client syntax attaches bearer authorization when a token is available, along with locale, time zone and `appVersion=500`; a 401 branch routes to login. No token value was read.
- Login, registration, pricing and checkout navigate to the separate trainerday.com site.
- Main API families visible include workouts, users/lists, plans, calendars, activities, configuration, notifications, and LLM plan generation. Coach Jack uses profile/assessment/plan calls under its own base.
- Calendar syntax includes recurrence, event update/delete/push, bulk operations, week shifts, provider synchronization, sync progress and calendar file export. This indicates a richer scheduler than a display-only calendar.
- Service syntax names Strava, Dropbox, Google, Zwift, Coros, Garmin, Intervals.icu, TrainingPeaks and Wahoo. Their actual connection status, available plan and successful behavior require separate runtime evidence.

## Workout APIs and search

- Detail retrieval: GET `/api/workouts/bySlug/{slug}`, GET `/api/workouts/{id}` with `structure=blocks`; similar-workout retrieval is separate at `/api/workouts/bySlug/{slug}/similar`.
- Search: GET `/api/workout/search` with the following shipped parameter names: `s`, `pageNumber`, `pageSize`, `type`, `myLibrary`, `textDescriptions`, `authorDescriptions`, `hasCadence`, `hasIntervalComments`, `minutesBetween`, `metersBetween`, `stressBetween`, `intensityBetween`, `sortBy`, `sessionType`, `lengthUnit`, `structure`.
- Editor writes: POST `/api/workouts/create`, PUT `/api/workouts/update`, and a separately declared administrator update route. These were observed as code, never called.
- Builder calls include POST `/api/workout-builder/generate-cached?structure=blocks` and POST `/api/workout-builder/edit`.
- The frontend recalculates training stress, intensity factor, dominant zone and time in zones from block data and sport-specific thresholds/zones when possible; it also accepts legacy segments.
- Version-specific workout routes exist and the store merges selected historical versions. Details preloading can arrive through page globals before API retrieval.

## Workout shape

- Write payload fields: `author`, `title`, `description`, `durationMinutes`, `totalMeters`, `dominantZone`, `workoutStatus`, `timeType`, `workoutGroup`, `workoutType`, `bikeStress`, `intensity`, `timeInZones`, `workoutBlocks`, `intensityUnit`, `lengthUnit`, `hasTextDescription`, `tags`, `sessionType`, `targetDistance`, `anchorMode`, `id`, `originalWorkoutId`. Some are conditionally included.
- A workout contains blocks; a block has `start`, `end`, `type`, `reps` and `segments`. Block types are `segment`, `set`, and `repetition`.
- Segments have `name`, `controlMode`, `segmentType`, `durationType`, `durationValue`, `pressLapButton`, `targets`, and `notes`.
- A target has `type`, `min`, and `max`; primary, cadence, slope and heart-rate target types appear. This supports ranged targets as well as single values.
- Duration can be seconds or meters; workout length can be duration or distance.
- Intensity units include watts, percent of FTP, percent of max HR, percent of threshold HR, threshold pace/speed, race pace and VDOT zone.
- Editor control modes include ERG, slope, HR and resistance. Sport builder selectors include bike, swim, rowing and several running modes.
- The editor supports grouped sets, repetitions, flattening blocks, duplication, row/range selection, notes/cadence/control columns and bounded undo/redo history. These operations were inspected statically and were not exercised.
- Race-based running supports target distances and current/goal anchors; names include mile, 3K, 5K, 10K, 15K, half marathon, marathon and Ironman marathon.

## Reconstruction implications

- Keep workout structure separate from display: blocks and repeats need a typed model, and target units depend on sport and athlete settings.
- Separate workout catalog, personal lists, plans, calendar events and recorded activities; shipped API families treat these as distinct resources.
- Model provider-specific synchronization settings instead of a single connected/disconnected flag. Calendar operations and device export settings have their own state.
- Treat Coach Jack and LLM creation as separate flows until runtime evidence establishes how they relate.
- Preserve uncertainty: these are client expectations and useful reconstruction seams, not verified backend contracts.

## Bounded coverage and unknowns

- Entry REA analysis reports 973 findings and 136 literal endpoint nodes (49 routes and 87 network candidates). Some network candidates are cookie helper calls rather than HTTP; this is not a count of real APIs.
- Focused editor/detail REA analysis reports 229 findings across 152,667 bytes.
- Most code split assets, all mobile binaries, server code, API responses and provider services remain unexamined.
- Exact backend authorization, schemas, workout generator logic, billing rules and integration success remain unknown.

## Public asset digests

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| index-CjwVpe-L.js | 205810 | `9848669ecc29dadf01f17c6371c56ae142413d4a8707ccbc743f6b230570145f` |
| vendor-BvdN2VcP.js | 2796056 | `73c46f6d61907bfe8fbe4da9569850e99059ed0b8f7c049c6c9bcae855615377` |
| Details-DBrnA6r9.js | 28979 | `89d5efd07abb53fb0cfef2935ffeece159e1482bce1d41ba03ea6fbc138424df` |
| Create-rXv4vTwY.js | 123688 | `44efec572b6d7ed625dbb36d627f44e22bf908fbc3f1372c57696bcddedb581b` |

Primary assets were discovered from the live page and its literal imports: [entry](https://app.trainerday.com/assets/index-CjwVpe-L.js), [vendor](https://app.trainerday.com/assets/vendor-BvdN2VcP.js), [workout detail](https://app.trainerday.com/assets/Details-DBrnA6r9.js), [creator](https://app.trainerday.com/assets/Create-rXv4vTwY.js).

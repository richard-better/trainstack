---
name: verify-ride-protocols
description: Check Ride's TLA+ protocol models whenever workout handoff, Health saving, library sync, or trainer pause behaviour changes.
---

# Verify Ride protocols

Run `apps/ride/Specs/check.sh` from the repository root. It requires Java 17+, curl,
and sha256sum or shasum. It downloads SHA-256-verified TLA+ tools v1.7.4 into
`${XDG_CACHE_HOME:-$HOME/.cache}/ride-tla`, checks every `.tla` with its same-name
`.cfg`, and keeps temporary TLC state outside the repository. CI runs the same
script in the Ride workflow. Terminal stuttering is legal; configs turn off
TLC's deadlock diagnostic. Safety and temporal properties remain enabled.

## Model boundaries and code mapping

All source paths below are relative to `apps/ride/RideKit/Sources`. These are
bounded executable abstractions, not proofs of all Swift or Apple framework
behaviour. Health authorization, valid recordings, successful eventual storage,
and a single Apple Account are assumptions. Permanent denial, corruption, and
unbounded crashes cannot guarantee eventual delivery. No symmetry reduction is
used with temporal checking. Each model explores all schedules in its bounds.

- `HealthHandoff`: one ride, with `Phone`, `Mac`, and `PhoneOnly` initial modes.
  `RideUI/Watch/WatchLink.swift` sends the claim (`LinkMessage.rideRecorded`)
  through `claimRideForHealth`: with every glance while the phone records a ride
  (`sendGlance`), and with every heart rate from the watch while it relays a ride
  the Mac records (`relay.onRideRecorded` sets `isRelayingARideTheMacRecords`).
  `Claim` is therefore repeatable while the ride is on. `RideBluetooth/WatchRelayReceiver.swift`
  and `HeartRateRelay.swift` abstract to an authenticated Mac claim relayed by the
  phone. These use HealthKit mirroring, not WatchConnectivity. Messages are an
  unordered set: delivery retains a message, allowing duplicates; `Drop` removes
  it. Connection changes gate delivery. `RideWatchUI/WorkoutRelay.swift` maps to
  `DeliverClaim`, `FinishWatch`, `WatchCrash`, `WatchRecover` and
  `WatchGivesUpOnASilentPhone`. `WatchWorkout.savesToHealthItself` is
  `WatchSavesItself`: a workout the phone started (`origin = "Phone"`) is never
  saved by the watch, since the phone saves its recording, and one the rider
  started on the watch is saved unless claimed. Whether the phone started it
  survives a watch crash (`workoutStartedOnPhone` in the watch's defaults); the
  claim does not, but is resent. `WatchWorkout.hasLostThePhone` is
  `WatchGivesUpOnASilentPhone`: after five minutes without a glance, the watch ends
  a workout the phone started. `RideUI/Health/PhoneWorkout.swift` collects nothing
  and never saves a workout. `Record` collapses file persistence and Health
  enqueue; `HealthQueue` checks that boundary. `SyncMac` represents eventual
  CloudKit arrival. Query and save are separate transitions from
  `HealthRides.savePending`, with immediate Health visibility, a stronger
  assumption than cross-device propagation.
  Checked: `NoDuplicatesForPhoneRides`, `RecordedEventuallySaved` and
  `WatchEventuallyEndsAfterAPhoneRide`. A Mac ride can still end up with two
  workouts if the watch never receives a single claim before the rider ends it
  on the watch, and the rider ends a watch-started workout themselves, so
  neither is checked for `Mac` rides.
- `HealthDedupe`: two Health-capable devices with the same immutable file hash
  already queued by `RideSync.receive` through `beforeStoringRideFromAnotherDevice`. Models
  `HealthRides.savePending` with separate query/save steps, per-device serialization,
  durable pending work, and interrupted queries. `RideUI/Health/HealthWorkout.swift`
  sets `HKMetadataKeySyncIdentifier = ride.id` and version 1. Save therefore inserts
  the same `RideHash`, regardless of which device saves it. The set represents
  logical Health objects after HealthKit identity reconciliation, not raw objects
  in isolated unsynchronized stores. No duplicate logical workout, eventual save,
  and eventual queue drainage are checked under strong query/save fairness.
  The platform contract is documented by Apple in
  [HKMetadataKeySyncIdentifier](https://developer.apple.com/documentation/healthkit/hkmetadatakeysyncidentifier)
  and [Synchronize health data with HealthKit](https://developer.apple.com/videos/play/wwdc2020/10184/).
  Do not replace identifier-based insertion with device-based insertion: that
  would invent a duplicate bug absent from the current metadata.
- `HealthQueue`: `RideUI/Player/RideLauncher.keep` and `RideSync.receive` queue a
  ride for Health (`HealthRides.queue`) in `RideLibrary`'s `beforeStoring`, before
  its file is written (`QueueBeforeStoring`, then `StoreFile`, which run in one
  main-actor call that only termination can split). `SavePending` drops a queued
  ride whose file never got written. Checked: a stored ride is always queued or
  saved, and a stored ride eventually reaches Health.
- `LibrarySync`: one immutable SHA-256 record, two devices initially holding it,
  one removal, and at most one bootstrap per device. `RideUI/Sync/RideSync.swift`
  maps `everythingToSend` to `Bootstrap`, `changes(toSendFor:)` and the next batch
  to `Send`, and `receive` and fetched deletions to `FetchDeleted`, `FetchRide`
  and `FetchRideGone`. Removing a ride saves a permanent `DeletedRide` record
  (`deleted-<id>`) and remembers the id in `DeletedRides.json`. A device that
  knows a ride was deleted never sends it, drops it locally, and deletes its
  record again if a stale device sends it back. Checked: a device that knows of
  the deletion never holds the ride, every device converges with the cloud, and
  a deleted ride is eventually gone everywhere for good. A stale device can still
  re-upload the record for a moment before it fetches the deletion. Recreating a lost zone sends
  every ride and deletion record again (`handleFailedSaves`), and a deleted ride imported again
  stays on that device: neither a refetched deletion record nor the record's deletion removes it.
- `TrainerPause`: `RideCore/RideEngine.swift` maps `.togglePause` to `Toggle`,
  and `pauseIfTrainerDropped` plus `session.advance` in `.tick` to atomic `Tick`.
  Connection changes, manual toggles and ticks interleave arbitrarily.
  `previouslyConnected` is the previous sampled state. Checked: a trainer pause
  implies the ride is paused, and ticks never resume a ride. A rider may resume
  while the trainer is still away and the ride then carries on, as
  `doesNotPauseAgainWhenResumedBeforeTheTrainerIsBack` pins.

## Known failing properties

None. When TLC finds a bug that is not fixed in the same change, keep the
property in a dotted config (`<System>.<Problem>.cfg`), which `check.sh` skips,
and list it here with TLC's action sequence and the matching Swift path.

## Updating the models

Read the mapped methods and their callers before editing. Keep network delivery,
persistence, and awaits as distinct actions wherever another device or termination
can intervene. State which Apple contracts are assumptions. Preserve passing
properties; add the new transition and a property that distinguishes correct from
incorrect behaviour. Keep specs free of comments and explain mapping changes here.
Do not weaken fairness or invariants just to make TLC pass. For a corrected bug,
run its dotted config, then move the property into the default config and remove
the obsolete reproduction config. For a newly exposed bug, preserve the faithful
model, isolate the failing property in a dotted config, and report TLC's action
sequence with the corresponding Swift path. Do not fix Swift as part of a
model-only assignment.

Run all defaults and all relevant reproductions after edits. Record runtimes and
state counts. Keep each default below about two minutes on CI by reducing bounds
without excluding the failure schedule. Do not claim a universal distributed
systems proof from these finite checks.

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
  `RideUI/Watch/WatchLink.swift` sends claims through `claimRide` and
  `relay.onRideRecorded`, and ends through `endRide`.
  `RideBluetooth/WatchRelayReceiver.swift` and `HeartRateRelay.swift` abstract to
  an authenticated Mac claim relayed by the phone. Cryptography and heart rate
  payloads are outside the state machine. `RideLink/LinkMessage.swift` defines
  the two control messages. These use HealthKit mirroring, not WatchConnectivity;
  WatchConnectivity only supplies pairing availability. Messages are an unordered
  set: delivery retains a message, allowing arbitrary duplicates; `Drop` removes
  it. Connection changes gate delivery. This deliberately overapproximates
  transport reordering and loss. `RideWatchUI/WorkoutRelay.swift` maps to
  `DeliverClaim`, `FinishWatch`, `WatchCrash`, and `WatchRecover`. Recovery loses
  the in-memory `isRecordedElsewhere` flag. Ending snapshots that flag; asynchronous
  builder completion is collapsed into the end transition. This does not cover
  a kill during builder completion. `RideUI/Health/PhoneWorkout.swift` collects
  nothing and never saves a workout, so phone-only sessions contribute no Health
  object. Its start/end and leftover-session recovery are abstracted away.
  `Record` collapses file persistence and Health enqueue; `HealthQueue` separately
  checks that non-atomic boundary. `SyncMac` represents eventual CloudKit arrival
  and `SyncSupport.onReceive`. Query and save are separate transitions from
  `HealthRides.savePending`. Health visibility is immediate here, a stronger
  assumption than cross-device propagation. A watch save and a recording save
  have different identities. Pending implies recorded; recorded rides eventually
  reach Health under strong fairness of sync/query/save and weak fairness of
  relaunch. No fairness is imposed on user termination or message delivery after
  a message has been lost. This exposes leftover sessions rather than assuming
  they end. Claims are bounded to one send, enough to expose failure even when
  no reconnect retry occurs. Repeated sessions and stale cross-session messages
  are outside this bound.
- `HealthDedupe`: two Health-capable devices with the same immutable file hash
  already queued by `RideSync.receive` and `SyncSupport.onReceive`. Models
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
- `HealthQueue`: `RideUI/Player/RideLauncher.keep` persists through
  `RideUI/History/RideLibrary.save` before `HealthRides.save` persists the pending
  ID. Termination can split those two synchronous operations. Relaunch restores
  the file and pending defaults, but cannot restore the lost continuation.
  `RideLibrary.receive` returns nil for a file already present, so another fetch
  cannot repair this window through `RideSync.onReceive`. Queued work eventually
  saves under strong enqueue/save fairness and weak launch fairness. Recovery
  through a rider manually resuming a journal is optional, not assumed.
- `LibrarySync`: one immutable SHA-256 record, two devices initially holding it,
  one removal, and at most one bootstrap per device. `RideUI/Sync/RideSync.swift`
  maps `sendEverything` to `Bootstrap`, `send` and the next batch to `Send`, and
  fetched modifications/deletions to `Fetch`. `RideLibrary.receive` and
  `removeReceived` update the local presence bit without echoing a local change.
  Server conflict on an existing immutable record leaves its value unchanged.
  Bootstrap represents absent serialized state or sign-in while a stale local
  file remains. The cloud bit abstracts successful latest-state delivery and
  deletion processing, not CKSyncEngine internals or its complete change history.
  No permanent tombstone exists in this model because the app has none. Finite
  mutations and weakly fair bootstrap/send/fetch imply eventual stable convergence.
  This does not imply deletion wins: stale bootstrap can recreate the record.
  Account changes, zone resets, and arbitrary failed state-file writes need an
  expanded model when those behaviours change.
- `TrainerPause`: `RideUI/Player/RideController.swift` maps `togglePause` to
  `Toggle`, and `pauseIfTrainerDropped` plus `session.advance` to atomic `Tick`.
  Initially a paired trainer is connected; connection changes, manual toggles,
  and ticks can interleave arbitrarily. `previouslyConnected` is the previous
  sampled state, not an ever-connected latch. `unsafeAdvance` remembers an
  advancing disconnected tick; elapsed time is otherwise omitted. Trainer pauses
  imply paused state and ticks never resume automatically. These are behavioural
  contracts to retain through any pure-engine refactor.

## Known failing properties

The script uses only `<System>.cfg`; dotted configs are intentional reproductions
and must fail until the matching protocol changes. Run one explicitly, for example:

```sh
java -cp "${XDG_CACHE_HOME:-$HOME/.cache}/ride-tla/tla2tools-1.7.4.jar" tlc2.TLC \
  -cleanup -metadir /tmp/ride-protocol-counterexample \
  -config apps/ride/Specs/LibrarySync.Resurrection.cfg \
  apps/ride/Specs/LibrarySync.tla
```

- `HealthHandoff.Duplicates.cfg`: `NoDuplicates` fails when the recording is saved
  before the watch finishes without receiving the claim. Recovery can also lose
  an already received claim. The watch builder has no matching sync identifier.
- `HealthHandoff.Leftover.cfg`: `WatchEventuallyEnds` fails when the end message
  is lost, or a Mac ride finishes without a watch-end path. Fair processing cannot
  deliver a message that no longer exists, and recovery resumes the watch session.
- `HealthQueue.Lost.cfg`: `RecordedEventuallySaved` fails if termination occurs
  after file persistence and before persisting the pending Health ID.
- `LibrarySync.Resurrection.cfg`: `NoResurrection` fails when a stale device
  bootstraps and uploads after the server deletion.

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

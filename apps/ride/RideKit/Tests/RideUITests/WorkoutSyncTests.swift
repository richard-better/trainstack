import Foundation
import RideData
import RideStrava
import Testing

@testable import RideBluetooth
@testable import RideUI

@MainActor
struct WorkoutSyncTests {
  private final class Scratch {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "WorkoutSyncTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    deinit { try? FileManager.default.removeItem(at: directory) }
  }

  private struct Device {
    let workouts: AccountWorkouts
    let sync: WorkoutSync
    let directory: URL
    let server: FakeWorkoutServer

    static func launched(server: FakeWorkoutServer, directory: URL) -> Device {
      let workouts = AccountWorkouts(directory: directory, now: { WorkoutSyncTests.now })
      return Device(
        workouts: workouts, sync: WorkoutSync(workouts: workouts, server: server),
        directory: directory, server: server)
    }

    func relaunched() -> Device { .launched(server: server, directory: directory) }

    func sync() async throws { try await sync.sync() }

    func syncIgnoringFailure() async {
      do { try await sync.sync() } catch {}
    }

    var names: [String] { workouts.workouts.map(\.name).sorted() }
  }

  nonisolated static let now = Date(timeIntervalSince1970: 1_793_520_000)

  private let scratch = Scratch()

  private func device(_ name: String = "phone", server: FakeWorkoutServer) -> Device {
    .launched(server: server, directory: scratch.directory.appending(path: name))
  }

  private static func workout(
    _ name: String, id: String = UUID().uuidString.lowercased(), minutes: Double = 10,
    updatedAt: Date = now
  ) throws -> LibraryWorkout {
    try LibraryWorkout(
      id: id,
      workout: TrainStackWorkout(
        name: name, sport: .cycling,
        blocks: [
          .step(
            .init(
              duration: .seconds(minutes * 60),
              target: .power(unit: "ftp", level: .ramp(from: 0.5, to: 0.9))))
        ]), copiedFromBuiltin: nil, updatedAt: updatedAt)
  }

  @Test func keepsTheAccountsWorkoutsAndListsOnTheDevice() async throws {
    let server = FakeWorkoutServer()
    let tempo = try Self.workout("Tempo")
    await server.put(tempo)
    await server.put(try Self.workout("Sprints"))
    await server.putList(
      LibraryWorkoutList(id: "list", name: "Base", workoutIDs: [tempo.id], updatedAt: Self.now))
    let phone = device(server: server)
    try await phone.sync()
    #expect(phone.names == ["Sprints", "Tempo"])
    #expect(phone.workouts.lists.map(\.name) == ["Base"])
    #expect(phone.workouts.workouts(in: phone.workouts.lists[0]).map(\.name) == ["Tempo"])
    #expect(phone.workouts[tempo.id]?.planned?.steps.count == 1)

    await server.goOffline()
    let relaunched = phone.relaunched()
    await relaunched.syncIgnoringFailure()
    #expect(relaunched.names == ["Sprints", "Tempo"])
    #expect(relaunched.workouts.lists.map(\.name) == ["Base"])
  }

  @Test func aWorkoutMadeOrChangedOnTheWebArrivesWithTheNextPassAfterTheCursor() async throws {
    let server = FakeWorkoutServer()
    let tempo = try Self.workout("Tempo")
    await server.put(tempo)
    let phone = device(server: server)
    try await phone.sync()
    await server.put(try Self.workout("Tempo, longer", id: tempo.id, updatedAt: Self.now + 60))
    await server.put(try Self.workout("Made on the web"))
    try await phone.sync()
    #expect(phone.names == ["Made on the web", "Tempo, longer"])
    let reads = await server.calls.filter {
      if case .changes = $0 { true } else { false }
    }
    #expect(reads == [.changes(since: nil, account: "ada"), .changes(since: "1", account: "ada")])
  }

  @Test func aRideKeepsTheWorkoutItStartedWithWhenTheWebEditsIt() async throws {
    let server = FakeWorkoutServer()
    let tempo = try Self.workout("Tempo", minutes: 10)
    await server.put(tempo)
    let phone = device(server: server)
    try await phone.sync()
    let defaults = try #require(UserDefaults(suiteName: "WorkoutSyncTests.\(UUID().uuidString)"))
    let launcher = RideLauncher(
      simulated: true,
      devices: BluetoothDevices(transport: CyclingTestTransport(), defaults: defaults),
      journalDirectory: scratch.directory.appending(path: "journal"))
    let planned = try #require(phone.workouts[tempo.id]?.planned)
    launcher.start(planned, ftp: 200, heartRateZones: nil, riderWeight: 75)
    defer { launcher.end() }
    await server.put(try Self.workout("Tempo", id: tempo.id, minutes: 40, updatedAt: Self.now + 60))
    try await phone.sync()
    #expect(phone.workouts[tempo.id]?.duration == TimeInterval(40 * 60))
    #expect(launcher.ride?.workout == planned)
    #expect(launcher.ride?.session.duration == TimeInterval(10 * 60))
  }

  @Test func aWorkoutDeletedOnTheWebWhileOfflineGoesWhenBackAndLeavesItsLists() async throws {
    let server = FakeWorkoutServer()
    let tempo = try Self.workout("Tempo")
    await server.put(tempo)
    await server.putList(
      LibraryWorkoutList(id: "list", name: "Base", workoutIDs: [tempo.id], updatedAt: Self.now))
    let phone = device(server: server)
    try await phone.sync()
    await server.goOffline()
    await server.deleteOnTheWeb(tempo.id)
    await phone.syncIgnoringFailure()
    #expect(phone.names == ["Tempo"])
    await server.goOffline(false)
    try await phone.sync()
    #expect(phone.names.isEmpty)
    #expect(phone.workouts.lists.first?.workoutIDs == [])
  }

  @Test func aReplayedChangeChangesNothing() async throws {
    let server = FakeWorkoutServer()
    let tempo = try Self.workout("Tempo")
    await server.put(tempo)
    let phone = device(server: server)
    let changes = try await server.workoutChanges(
      since: nil, for: ActivityAccount(id: "ada", token: "token-ada"))
    try await phone.sync()
    let before = phone.workouts.state
    phone.workouts.receive(changes)
    phone.workouts.receive(changes)
    #expect(phone.workouts.state?.workouts == before?.workouts)
    #expect(phone.names == ["Tempo"])
  }

  @Test func savesACopyOfABuiltInWhileOfflineAndSendsItOnce() async throws {
    let server = FakeWorkoutServer()
    let phone = device(server: server)
    try await phone.sync()
    let template = try #require(WorkoutTemplate.named("Zone 3 · 3×10"))
    await server.goOffline()
    let id = try #require(phone.workouts.saveCopy(of: template))
    #expect(phone.names == ["Zone 3 · 3×10"])
    #expect(phone.workouts[id]?.planned?.workout(ftp: 250) == template.workout(ftp: 250))
    await phone.syncIgnoringFailure()
    await server.goOffline(false)
    await server.loseTheNextAnswer()
    await phone.syncIgnoringFailure()
    #expect(phone.workouts.state?.copiesToSend.count == 1)
    try await phone.sync()
    #expect(phone.workouts.state?.copiesToSend.isEmpty == true)
    #expect(await server.liveWorkouts().map(\.id) == [id])
    #expect(await server.workout(id)?.copiedFromBuiltin == "zone-3-3x10")
    #expect(phone.names == ["Zone 3 · 3×10"])
  }

  @Test func deletesOneOfItsOwnByTheRuleThatADeletedWorkoutStaysDeleted() async throws {
    let server = FakeWorkoutServer()
    let tempo = try Self.workout("Tempo")
    await server.put(tempo)
    let phone = device(server: server)
    let laptop = device("laptop", server: server)
    try await phone.sync()
    try await laptop.sync()
    await server.goOffline()
    phone.workouts.delete(tempo.id)
    #expect(phone.names.isEmpty)
    await phone.syncIgnoringFailure()
    await server.goOffline(false)
    try await phone.sync()
    #expect(await server.isDeleted(tempo.id))
    #expect(
      await server.put(try Self.workout("Stale", id: tempo.id, updatedAt: Self.now + 600)) == nil)
    try await laptop.sync()
    #expect(laptop.names.isEmpty)
    try await phone.sync()
    #expect(phone.names.isEmpty)
  }

  @Test func aCopyDeletedWhileItIsBeingSentStaysDeleted() async throws {
    let server = FakeWorkoutServer()
    let phone = device(server: server)
    try await phone.sync()
    let id = try #require(phone.workouts.saveCopy(of: WorkoutTemplate.library[0]))
    await server.holdCopies()
    let pass = Task { try await phone.sync() }
    while !(await server.isHoldingACopy) { await Task.yield() }
    phone.workouts.delete(id)
    await server.releaseCopies()
    try await pass.value
    #expect(phone.workouts[id] == nil)
    try await phone.sync()
    #expect(await server.isDeleted(id))
    #expect(phone.names.isEmpty)
  }

  @Test func signingOutHidesTheWorkoutsAndSigningBackInShowsThem() async throws {
    let server = FakeWorkoutServer()
    await server.put(try Self.workout("Tempo"))
    let phone = device(server: server)
    try await phone.sync()
    await server.signIn(as: nil)
    await phone.syncIgnoringFailure()
    #expect(phone.workouts.state == nil)
    #expect(phone.names.isEmpty)
    await server.signIn(as: "ada")
    await server.goOffline()
    await phone.syncIgnoringFailure()
    #expect(phone.names == ["Tempo"])
  }

  @Test func anotherAccountSeesOnlyItsOwnWorkouts() async throws {
    let server = FakeWorkoutServer()
    await server.put(try Self.workout("Ada's"), for: "ada")
    await server.put(try Self.workout("Grace's"), for: "grace")
    let phone = device(server: server)
    try await phone.sync()
    let template = WorkoutTemplate.library[0]
    await server.goOffline()
    phone.workouts.saveCopy(of: template)
    await server.goOffline(false)
    await server.signIn(as: "grace")
    try await phone.sync()
    #expect(phone.names == ["Grace's"])
    #expect(await server.liveWorkouts(of: "grace").map(\.name) == ["Grace's"])
    await server.signIn(as: "ada")
    try await phone.sync()
    #expect(phone.names == ["Ada's", template.name])
    #expect(await server.liveWorkouts(of: "ada").count == 2)
  }

  @Test func aDeletedAccountLeavesNoWorkoutsBehind() async throws {
    let server = FakeWorkoutServer()
    await server.put(try Self.workout("Tempo"))
    let phone = device(server: server)
    try await phone.sync()
    await server.signIn(as: nil)
    phone.sync.accountDeleted("ada")
    #expect(phone.workouts.state == nil)
    await server.signIn(as: "ada")
    await server.goOffline()
    await phone.relaunched().syncIgnoringFailure()
    let relaunched = phone.relaunched()
    await relaunched.syncIgnoringFailure()
    #expect(relaunched.names.isEmpty)
  }

  @Test func aPassThatOutlivesItsAccountChangesNothingForTheNext() async throws {
    let server = FakeWorkoutServer()
    let phone = device(server: server)
    try await phone.sync()
    phone.workouts.saveCopy(of: WorkoutTemplate.library[0])
    await server.holdCopies()
    let pass = Task { try await phone.sync() }
    while !(await server.isHoldingACopy) { await Task.yield() }
    phone.workouts.show("grace")
    await server.releaseCopies()
    await #expect(throws: CancellationError.self) { try await pass.value }
    #expect(phone.workouts.account == "grace")
    #expect(phone.names.isEmpty)
  }

  @Test func aSessionTheServerNoLongerKnowsHidesTheWorkoutsButKeepsThem() async throws {
    let server = FakeWorkoutServer()
    await server.put(try Self.workout("Tempo"))
    let phone = device(server: server)
    try await phone.sync()
    await server.expireTheSession()
    await #expect(throws: StravaError.signedOut) { try await phone.sync() }
    #expect(phone.workouts.state == nil)
    await server.goOffline()
    let relaunched = phone.relaunched()
    relaunched.workouts.show("ada")
    #expect(relaunched.names == ["Tempo"])
  }

  @Test func aCancelledPassThatHearsItsOldSessionEndedLeavesTheNewPassAlone() async throws {
    let server = FakeWorkoutServer()
    await server.put(try Self.workout("Tempo"))
    let phone = device(server: server)
    try await phone.sync()
    await server.holdChanges()
    let old = Task { try await phone.sync() }
    while !(await server.isHoldingChanges) { await Task.yield() }
    old.cancel()
    await server.signIn(as: "ada", token: "fresh")
    try await phone.sync()
    await server.releaseChanges()
    _ = await old.result
    #expect(phone.names == ["Tempo"])
    try await phone.sync()
    #expect(phone.names == ["Tempo"])
  }
}

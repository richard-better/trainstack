import CryptoKit
import Foundation
import RideData
import RideStrava
import Testing

@testable import RideUI

struct HealthImportTests {
  private static let now = Date(timeIntervalSince1970: 1_800_000_000)

  private struct Device {
    let health: HealthImport
    let store: FakeHealthWorkouts
    let server: FakeActivityServer
  }

  private func withDevice(
    on: Bool = true, server: FakeActivityServer = FakeActivityServer(),
    _ body: (Device) async throws -> Void
  ) async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "HealthImportTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let suite = "HealthImportTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.set(on, forKey: HealthImport.onKey)
    let store = FakeHealthWorkouts()
    let health = HealthImport(
      store: store, server: server, directory: directory, defaults: defaults, now: { Self.now })
    try await body(Device(health: health, store: store, server: server))
  }

  private func id(of data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  @Test func importsEveryWorkoutAsAFileNamedByItsHealthWorkoutNewestFirst() async throws {
    try await withDevice { device in
      device.store.add("run", endingAt: Self.now.addingTimeInterval(-86_400 * 400))
      device.store.add("ride", sport: .cycling, endingAt: Self.now.addingTimeInterval(-3600))
      try await device.health.sync()
      let files = await device.server.files
      #expect(files.map(\.sourceID) == ["ride", "run"])
      #expect(files.allSatisfy { $0.source == "apple_health" })
      #expect(files.map(\.data) == [device.store.file(of: "ride"), device.store.file(of: "run")])
    }
  }

  @Test func neverImportsAWorkoutRideWroteToHealthItself() async throws {
    try await withDevice { device in
      device.store.add(
        "ride-saved-by-ride", sport: .indoorCycling, endingAt: Self.now.addingTimeInterval(-3600),
        writtenByRide: true)
      device.store.add("garmin-ride", sport: .cycling, endingAt: Self.now.addingTimeInterval(-7200))
      try await device.health.sync()
      #expect(await device.server.files.map(\.sourceID) == ["garmin-ride"])
      #expect(device.store.read == ["garmin-ride"], "Ride's own workouts are not even read")
    }
  }

  @Test func ridesOwnWorkoutsAreThoseFromItsAppOrItsWatchApp() {
    let ride = "com.trainstackhq.ride"
    #expect(HealthWorkoutEntry.isRide(ride, appBundleIdentifier: ride))
    #expect(
      HealthWorkoutEntry.isRide("com.trainstackhq.ride.watchkitapp", appBundleIdentifier: ride))
    #expect(!HealthWorkoutEntry.isRide("com.trainstackhq.rider", appBundleIdentifier: ride))
    #expect(!HealthWorkoutEntry.isRide("com.apple.health", appBundleIdentifier: ride))
    #expect(!HealthWorkoutEntry.isRide("com.garmin.connect.mobile", appBundleIdentifier: ride))
  }

  @Test func importsAWorkoutOnceAcrossPassesAndRelaunches() async throws {
    try await withDevice { device in
      device.store.add("run", endingAt: Self.now.addingTimeInterval(-3600))
      try await device.health.sync()
      try await device.health.sync()
      #expect(await device.server.uploads.count == 1)
    }
  }

  @Test func waitsForAWorkoutThatJustEndedToSettle() async throws {
    try await withDevice { device in
      device.store.add("just-ended", endingAt: Self.now.addingTimeInterval(-60))
      try await device.health.sync()
      #expect(await device.server.uploads.isEmpty)
      #expect(device.store.read.isEmpty)
    }
  }

  @Test func aWorkoutDeletedOnTheAccountStaysDeleted() async throws {
    let server = FakeActivityServer()
    try await withDevice(server: server) { device in
      device.store.add("run", endingAt: Self.now.addingTimeInterval(-3600))
      let file = try #require(device.store.file(of: "run"))
      await server.deleteElsewhere(id(of: file), for: "ada")
      try await device.health.sync()
      try await device.health.sync()
      #expect(await server.uploads.count == 1, "the refusal is remembered, so it is not sent again")
      #expect(device.health.state(of: "ada").deleted == ["run"])
      #expect(await server.activities(of: "ada").isEmpty)
    }
  }

  @Test func readsNothingWhileOff() async throws {
    try await withDevice(on: false) { device in
      device.store.add("run", endingAt: Self.now.addingTimeInterval(-3600))
      try await device.health.sync()
      #expect(await device.server.calls.isEmpty)
      #expect(device.store.read.isEmpty)
    }
  }

  @Test func turningItOffKeepsWhatWasImportedAndStopsTheRest() async throws {
    try await withDevice { device in
      device.store.add("run", endingAt: Self.now.addingTimeInterval(-3600))
      try await device.health.sync()
      device.health.isOn = false
      device.store.add("later-run", endingAt: Self.now.addingTimeInterval(-1800))
      try await device.health.sync()
      #expect(await device.server.files.map(\.sourceID) == ["run"])
      #expect(await device.server.deletions.isEmpty)
    }
  }

  @Test func eachAccountGetsEveryWorkout() async throws {
    let server = FakeActivityServer(signedInAs: "ada")
    try await withDevice(server: server) { device in
      device.store.add("run", endingAt: Self.now.addingTimeInterval(-3600))
      try await device.health.sync()
      await server.signIn(as: "grace")
      try await device.health.sync()
      #expect(
        await server.calls == [
          .upload(id(of: try #require(device.store.file(of: "run"))), account: "ada"),
          .upload(id(of: try #require(device.store.file(of: "run"))), account: "grace"),
        ])
    }
  }

  private static func night(_ text: String, sleepHours: Double = 7.5, hrv: Double? = 62)
    -> MeasuredDay
  {
    MeasuredDay(
      day: SettingDay(text)!, sleepSeconds: Int(sleepHours * 3600), restingHeartRateBpm: 50,
      hrvMs: hrv)
  }

  @Test func sendsEachMeasuredDayOnceAndADayAgainOnlyWhenHealthChangedIt() async throws {
    try await withDevice { device in
      let calendar = Calendar.current
      let today = SettingDay(Self.now, calendar: calendar)
      let yesterday = SettingDay(Self.now.addingTimeInterval(-86_400), calendar: calendar)
      device.store.measured = [
        today: Self.night(today.text), yesterday: Self.night(yesterday.text),
      ]
      try await device.health.sync()
      try await device.health.sync()
      var writes = await device.server.healthDayWrites
      #expect(writes.count == 1, "empty days and unchanged days are not sent")
      #expect(writes[0].days.map(\.day) == [yesterday, today])

      device.store.measured[today] = Self.night(today.text, sleepHours: 4.3, hrv: 31)
      try await device.health.sync()
      writes = await device.server.healthDayWrites
      #expect(writes.count == 2)
      #expect(writes[1].days == [Self.night(today.text, sleepHours: 4.3, hrv: 31)])
      #expect(writes[1].stamp > writes[0].stamp, "a later read always carries a later stamp")
    }
  }

  @Test func aDayHealthNoLongerHasIsSentEmptySoTheAccountForgetsIt() async throws {
    try await withDevice { device in
      let today = SettingDay(Self.now, calendar: .current)
      device.store.measured = [today: Self.night(today.text)]
      try await device.health.sync()
      device.store.measured = [:]
      try await device.health.sync()
      let writes = await device.server.healthDayWrites
      #expect(writes.last?.days.map(\.isEmpty) == [true])
    }
  }

  @Test func sendsNoMeasuredDayWhileOff() async throws {
    try await withDevice(on: false) { device in
      let today = SettingDay(Self.now, calendar: .current)
      device.store.measured = [today: Self.night(today.text)]
      try await device.health.sync()
      #expect(await device.server.healthDayWrites.isEmpty)
    }
  }
}

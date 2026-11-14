import Foundation
import RideData
import RideStrava
import Testing

@testable import RideUI

@MainActor
struct SettingsSyncTests {
  private final class Clock {
    var now: Date
    init(_ now: Date) { self.now = now }
    func advance(minutes: Double = 1) { now.addTimeInterval(minutes * 60) }
  }

  private struct Device {
    let store: RiderSettingsStore
    let sync: SettingsSync
    let server: FakeSettingsServer
    let defaults: UserDefaults
    let state: URL
    let clock: Clock

    static func launched(
      server: FakeSettingsServer, defaults: UserDefaults, state: URL, clock: Clock
    ) -> Device {
      let store = RiderSettingsStore(defaults: defaults, now: { clock.now })
      let sync = SettingsSync(store: store, server: server, directory: state)
      return Device(
        store: store, sync: sync, server: server, defaults: defaults, state: state, clock: clock)
    }

    func relaunched() -> Device {
      .launched(server: server, defaults: defaults, state: state, clock: clock)
    }

    var live: [SettingAddress: SettingChange] {
      Dictionary(uniqueKeysWithValues: store.settings.ledger.live.map { ($0.address, $0.change) })
    }

    func syncIgnoringSignOut() async throws {
      do {
        try await sync.sync()
      } catch StravaError.signedOut {}
    }
  }

  private static let start = Date(timeIntervalSince1970: 1_793_520_000)

  private final class Scratch {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "SettingsSyncTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    var suites: [String] = []

    func device(
      _ name: String, server: FakeSettingsServer, clock: Clock, legacy: Data? = nil
    ) throws -> Device {
      let suite = "SettingsSyncTests-\(UUID().uuidString)"
      suites.append(suite)
      let defaults = try #require(UserDefaults(suiteName: suite))
      if let legacy { defaults.set(legacy, forKey: "riderSettings") }
      return .launched(
        server: server, defaults: defaults, state: directory.appending(path: name), clock: clock)
    }

    deinit {
      try? FileManager.default.removeItem(at: directory)
      for suite in suites { UserDefaults().removePersistentDomain(forName: suite) }
    }
  }

  private let scratch = Scratch()
  private let clock = Clock(start)

  private func device(
    _ name: String = "phone", server: FakeSettingsServer, legacy: Data? = nil
  ) throws -> Device {
    try scratch.device(name, server: server, clock: clock, legacy: legacy)
  }

  private func day(_ date: Date) -> SettingDay { SettingDay(date) }

  private func waitUntil(_ condition: () async -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(10)
    while !(await condition()) {
      try #require(ContinuousClock.now < deadline, "waited ten seconds")
      await Task.yield()
    }
  }

  private func ftp(_ value: Int) -> SettingChange {
    .threshold(sport: nil, threshold: "ftp", value: value)
  }

  private func ftpAddress(on date: Date) -> SettingAddress {
    SettingAddress(.threshold(sport: nil, threshold: "ftp"), on: day(date))
  }

  private func webWrite(
    _ change: SettingChange, on date: Date, at stamp: Date, to server: FakeSettingsServer,
    account: String = "ada"
  ) async {
    await server.apply(
      [SettingWrite(SettingAddress(change.key, on: day(date)), change, at: SettingStamp(stamp))],
      for: account)
  }

  @Test func aRiderWhoNeverSignedInKeepsTheirSettingsAndNothingReachesTheServer() async throws {
    let server = FakeSettingsServer(signedInAs: nil)
    let phone = try device(server: server)
    phone.store[.ftp, .all] = 250
    phone.store.weight = 68
    await #expect(throws: StravaError.signedOut) { try await phone.sync.sync() }
    let relaunched = phone.relaunched()
    #expect(relaunched.store.ftp == 250)
    #expect(relaunched.store.weight == 68)
    #expect(relaunched.store.settings.ledger.account == nil)
    #expect(await server.calls.isEmpty)
  }

  @Test func sendsAnEditWithTheMomentItWasMade() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    phone.store[.ftp, .all] = 250
    clock.advance(minutes: 30)
    try await phone.sync.sync()
    #expect(
      await server.row(ftpAddress(on: Self.start), of: "ada")
        == SettingWrite(ftpAddress(on: Self.start), ftp(250), at: SettingStamp(Self.start)))
    #expect(phone.store.settings.ledger.unsent.isEmpty)
    #expect(phone.store.settings.ledger.account == "ada")
  }

  @Test func takesInWhatTheWebWrote() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    try await phone.sync.sync()
    await webWrite(ftp(270), on: Self.start, at: Self.start, to: server)
    await webWrite(.weight(kg: 66), on: Self.start, at: Self.start, to: server)
    try await phone.sync.sync()
    #expect(phone.store.ftp == 270)
    #expect(phone.store.weight == 66)
    #expect(await server.calls.last == .history(since: "0", account: "ada"))
  }

  private func legacySettings(
    ftp: Int, on date: Date, weight: Double, test: FTPTest? = nil
  ) throws -> Data {
    var history = ZoneHistory()
    history.record(
      [.threshold(.ftp, scope: .all, value: ftp), .listed(.running, true)], on: date)
    return try JSONSerialization.data(withJSONObject: [
      "history": try JSONSerialization.jsonObject(with: JSONEncoder().encode(history)),
      "ftpTests": try JSONSerialization.jsonObject(
        with: JSONEncoder().encode(test.map { [$0] } ?? [])),
      "weight": weight,
    ])
  }

  @Test func theFirstSignInMergesTheDevicesSettingsWithTheAccountsAndLosesNone() async throws {
    let server = FakeSettingsServer()
    let earlier = Self.start.addingTimeInterval(-30 * 86_400)
    let test = FTPTest(date: earlier, kind: .ramp, ftp: 240, scope: .all)
    let phone = try device(
      server: server, legacy: try legacySettings(ftp: 230, on: earlier, weight: 70, test: test))
    phone.store[.maxHeartRate, .all] = 188
    await webWrite(ftp(260), on: earlier, at: earlier, to: server)
    await webWrite(ftp(280), on: Self.start, at: Self.start, to: server)
    await webWrite(.sport("swimming", listed: true), on: Self.start, at: Self.start, to: server)

    try await phone.sync.sync()

    #expect(phone.store.settings.history.profile(on: earlier).value(of: .ftp, in: .all) == 260)
    #expect(phone.store.ftp == 280)
    #expect(phone.store.current.value(of: .maxHeartRate, in: .all) == 188)
    #expect(phone.store.current.listedSports == [.running, .swimming])
    #expect(phone.store.ftpTests(in: .all).map(\.id) == [test.id])
    #expect(phone.store.weight == 70)
    #expect(phone.store.settings.ledger.unsent.isEmpty)
    #expect(await server.live(of: "ada") == phone.live)
  }

  @Test func aMigratedValueLosesToAnEditTheWebMadeLaterOrEarlier() async throws {
    let server = FakeSettingsServer()
    let earlier = Self.start.addingTimeInterval(-30 * 86_400)
    let phone = try device(
      server: server, legacy: try legacySettings(ftp: 230, on: earlier, weight: 75))
    await webWrite(ftp(255), on: earlier, at: earlier.addingTimeInterval(-86_400 * 300), to: server)
    try await phone.sync.sync()
    #expect(phone.store.settings.history.profile(on: earlier).value(of: .ftp, in: .all) == 255)
    #expect(await server.live(of: "ada")[ftpAddress(on: earlier)] == ftp(255))
  }

  @Test func twoDevicesMigratingDifferentValuesForOneDayEndOnTheServersChoiceInEitherOrder()
    async throws
  {
    let earlier = Self.start.addingTimeInterval(-30 * 86_400)
    var winners: [SettingChange?] = []
    for phoneFirst in [true, false] {
      let server = FakeSettingsServer()
      let phone = try device(
        "phone-\(phoneFirst)", server: server,
        legacy: try legacySettings(ftp: 230, on: earlier, weight: 75))
      let mac = try device(
        "mac-\(phoneFirst)", server: server,
        legacy: try legacySettings(ftp: 240, on: earlier, weight: 75))
      let order = phoneFirst ? [phone, mac, phone] : [mac, phone, mac]
      for device in order { try await device.sync.sync() }
      let onServer = await server.live(of: "ada")
      #expect(phone.live == onServer)
      #expect(mac.live == onServer)
      winners.append(onServer[ftpAddress(on: earlier)])
    }
    #expect(winners == [ftp(240), ftp(240)])
  }

  @Test func twoDevicesAndTheWebEndOnTheSameHistoryWhateverOrderTheySyncIn() async throws {
    let orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    var outcomes: [[SettingAddress: SettingChange]] = []
    for order in orders {
      let server = FakeSettingsServer()
      clock.now = Self.start
      let phone = try device("phone-\(order)", server: server)
      let mac = try device("mac-\(order)", server: server)
      try await phone.sync.sync()
      try await mac.sync.sync()

      phone.store[.ftp, .all] = 250
      phone.store.weight = 70
      clock.advance()
      mac.store[.ftp, .all] = 255
      mac.store[.maxHeartRate, .all] = 190
      clock.advance()
      await webWrite(ftp(260), on: clock.now, at: clock.now.addingTimeInterval(-90), to: server)
      await webWrite(
        .threshold(sport: nil, threshold: "resting_heart_rate", value: 48), on: clock.now,
        at: clock.now, to: server)
      clock.advance()
      phone.store[.maxHeartRate, .all] = 186

      let devices = [phone, mac]
      let steps: [() async throws -> Void] = [
        { try await phone.sync.sync() }, { try await mac.sync.sync() }, {},
      ]
      for index in order { try await steps[index]() }
      for device in devices { try await device.sync.sync() }
      for device in devices { try await device.sync.sync() }

      let onServer = await server.live(of: "ada")
      #expect(phone.live == onServer, "order \(order)")
      #expect(mac.live == onServer, "order \(order)")
      #expect(phone.store.ftp == 255, "order \(order)")
      #expect(phone.store.current.value(of: .maxHeartRate, in: .all) == 186, "order \(order)")
      #expect(mac.store.current.value(of: .restingHeartRate, in: .all) == 48, "order \(order)")
      #expect(mac.store.weight == 70, "order \(order)")
      outcomes.append(onServer)
    }
    #expect(Set(outcomes.map { $0.count }).count == 1)
    #expect(outcomes.allSatisfy { $0 == outcomes[0] })
  }

  @Test func aRemovalOnOneDeviceStaysRemovedWhenAStaleDeviceSyncs() async throws {
    let server = FakeSettingsServer()
    let phone = try device("phone", server: server)
    let mac = try device("mac", server: server)
    phone.store[.ftp, .all] = 250
    try await phone.sync.sync()
    try await mac.sync.sync()
    clock.advance()
    let entry = try #require(phone.store.historyEntries.first?.id)
    phone.store.removeHistoryEntry(entry)
    try await phone.sync.sync()
    try await mac.sync.sync()
    try await phone.sync.sync()
    #expect(phone.store.ftp == nil)
    #expect(mac.store.ftp == nil)
    #expect(await server.live(of: "ada").isEmpty)
  }

  @Test func aStaleWriteGetsTheWinningValueBack() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    try await phone.sync.sync()
    phone.store[.ftp, .all] = 250
    await server.landBeforeTheNextWrite([
      SettingWrite(
        ftpAddress(on: Self.start), ftp(265), at: SettingStamp(Self.start.addingTimeInterval(5)))
    ])
    try await phone.sync.sync()
    #expect(phone.store.ftp == 265)
    #expect(phone.store.settings.ledger.unsent.isEmpty)
    #expect(await server.live(of: "ada")[ftpAddress(on: Self.start)] == ftp(265))
  }

  @Test func replayingAWriteChangesNothing() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    phone.store[.ftp, .all] = 250
    let sent = phone.store.settings.ledger.unsent
    try await phone.sync.sync()
    clock.advance()
    phone.store[.ftp, .all] = 260
    try await phone.sync.sync()
    let account = ActivityAccount(id: "ada", token: "token-ada")
    #expect(
      try await server.writeSettings(sent, for: account)
        == .stored([
          SettingWrite(ftpAddress(on: Self.start), ftp(260), at: SettingStamp(clock.now))
        ]))
    try await phone.sync.sync()
    #expect(phone.store.ftp == 260)
  }

  @Test func anEditMadeWhileItsEarlierValueIsOnTheWayIsSentNext() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    phone.store[.ftp, .all] = 250
    await server.holdWrites()
    let sending = Task { try await phone.sync.sync() }
    try await waitUntil { (await server.isHoldingAWrite) }
    clock.advance()
    phone.store[.ftp, .all] = 252
    await server.releaseWrites()
    try await sending.value
    #expect(phone.store.ftp == 252)
    try await phone.sync.sync()
    #expect(await server.live(of: "ada")[ftpAddress(on: Self.start)] == ftp(252))
    #expect(phone.store.settings.ledger.unsent.isEmpty)
  }

  @Test func editsMadeOfflineGoUpOnceBackEvenAfterARelaunch() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    try await phone.sync.sync()
    await server.goOffline()
    phone.store[.ftp, .all] = 250
    await #expect(throws: StravaError.unavailable) { try await phone.sync.sync() }
    let relaunched = phone.relaunched()
    await server.goOffline(false)
    try await relaunched.sync.sync()
    #expect(await server.live(of: "ada")[ftpAddress(on: Self.start)] == ftp(250))
    #expect(relaunched.store.settings.ledger.unsent.isEmpty)
  }

  @Test func signingOutStopsSendingAndTheEditsGoUpWhenTheSameAccountSignsIn() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    try await phone.sync.sync()
    await server.signIn(as: nil)
    phone.store[.ftp, .all] = 250
    try await phone.syncIgnoringSignOut()
    #expect(await server.writes.isEmpty)
    await server.signIn(as: "ada")
    try await phone.sync.sync()
    #expect(await server.live(of: "ada")[ftpAddress(on: Self.start)] == ftp(250))
  }

  @Test func signingInToAnotherAccountNeverSendsTheFirstAthletesSettings() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    phone.store[.ftp, .all] = 250
    try await phone.sync.sync()
    await server.signIn(as: nil)
    clock.advance()
    phone.store[.maxHeartRate, .all] = 190
    await webWrite(ftp(310), on: Self.start, at: Self.start, to: server, account: "bob")

    await server.signIn(as: "bob")
    try await phone.sync.sync()
    #expect(phone.store.ftp == 310)
    #expect(phone.store.current.value(of: .maxHeartRate, in: .all) == nil)
    #expect(await server.live(of: "bob") == [ftpAddress(on: Self.start): ftp(310)])
    clock.advance()
    phone.store.weight = 90
    try await phone.sync.sync()

    await server.signIn(as: "ada")
    try await phone.sync.sync()
    #expect(phone.store.ftp == 250)
    #expect(phone.store.current.value(of: .maxHeartRate, in: .all) == 190)
    #expect(phone.store.weight == 75)
    let ada = await server.live(of: "ada")
    #expect(ada.count == 2)
    #expect(ada.values.contains(.threshold(sport: nil, threshold: "max_heart_rate", value: 190)))
    #expect(await server.live(of: "bob").count == 2)
  }

  @Test func afterTheAccountIsDeletedTheSettingsStayAndGoToTheNextAccount() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    phone.store[.ftp, .all] = 250
    try await phone.sync.sync()
    phone.sync.accountDeleted("ada")
    await server.signIn(as: "cy")
    try await phone.sync.sync()
    #expect(phone.store.ftp == 250)
    #expect(await server.live(of: "cy")[ftpAddress(on: Self.start)] == ftp(250))
  }

  @Test func aRefusedSettingDoesNotHoldBackTheOthers() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    phone.store[.ftp, .all] = 250
    phone.store[.maxHeartRate, .all] = 190
    await server.refuse(ftp(250))
    phone.sync.start()
    try await waitUntil { phone.store.settings.ledger.unsent.map(\.change) == [ftp(250)] }
    #expect(
      await server.live(of: "ada").values.elementsEqual([
        .threshold(sport: nil, threshold: "max_heart_rate", value: 190)
      ]))
    #expect(phone.store.settings.ledger.unsent.map(\.change) == [ftp(250)])
  }

  @Test func sendsALongHistoryInWritesTheServerTakes() async throws {
    let server = FakeSettingsServer()
    var history = ZoneHistory()
    for offset in 0..<150 {
      history.record(
        [.threshold(.ftp, scope: .all, value: 200 + offset)],
        on: Self.start.addingTimeInterval(Double(-offset) * 86_400))
    }
    let legacy = try JSONSerialization.data(withJSONObject: [
      "history": try JSONSerialization.jsonObject(with: JSONEncoder().encode(history)),
      "ftpTests": [Any](),
    ])
    let phone = try device(server: server, legacy: legacy)
    try await phone.sync.sync()
    #expect(
      await server.writes == [
        .write(count: 100, account: "ada"), .write(count: 50, account: "ada"),
      ])
    #expect(await server.live(of: "ada").count == 150)
  }

  @Test func editingSettingsStartsAPass() async throws {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    phone.sync.start()
    try await waitUntil { !(await server.calls.isEmpty) }
    phone.store[.ftp, .all] = 250
    try await waitUntil { phone.store.settings.ledger.unsent.isEmpty }
    #expect(await server.live(of: "ada")[ftpAddress(on: Self.start)] == ftp(250))
  }

  @Test func settingsKeptForAnotherAccountThatCannotBeReadAreNeitherReplacedNorLost()
    async throws
  {
    let server = FakeSettingsServer()
    let phone = try device(server: server)
    phone.store[.ftp, .all] = 250
    try await phone.sync.sync()
    await server.signIn(as: "bob")
    try await phone.sync.sync()
    await server.signIn(as: "ada")
    let kept = try #require(
      FileManager.default.contentsOfDirectory(at: phone.state, includingPropertiesForKeys: nil)
        .first)
    try Data("not a ledger".utf8).write(to: kept)
    await #expect(throws: DecodingError.self) { try await phone.sync.sync() }
    #expect(phone.store.settings.ledger.account == "bob")
    #expect(FileManager.default.fileExists(atPath: kept.path))
  }
}

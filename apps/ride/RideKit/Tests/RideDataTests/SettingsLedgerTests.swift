import Foundation
import Testing

@testable import RideData

struct SettingsLedgerTests {
  private let address = SettingAddress(
    .threshold(sport: nil, threshold: "ftp"), on: SettingDay("2026-05-01")!)

  private func ftp(_ value: Int) -> SettingChange {
    .threshold(sport: nil, threshold: "ftp", value: value)
  }

  private func at(_ milliseconds: Int64) -> SettingStamp {
    SettingStamp(milliseconds: milliseconds)
  }

  private func time(_ milliseconds: Int64) -> Date { at(milliseconds).date }

  @Test func aLaterWriteFromTheServerReplacesAnUnsentEdit() {
    var ledger = SettingsLedger()
    ledger.edit(address, to: ftp(250), at: time(1_000))
    let changed = ledger.receive(SettingWrite(address, ftp(260), at: at(2_000)))
    #expect(changed)
    #expect(ledger.live.map(\.change) == [ftp(260)])
    #expect(ledger.unsent.isEmpty)
  }

  @Test func anEarlierWriteFromTheServerLeavesANewerEditToBeSent() {
    var ledger = SettingsLedger()
    ledger.edit(address, to: ftp(250), at: time(3_000))
    let changed = ledger.receive(SettingWrite(address, ftp(260), at: at(2_000)))
    #expect(!changed)
    #expect(ledger.unsent == [SettingWrite(address, ftp(250), at: at(3_000))])
  }

  @Test func anotherDevicesEditAtTheSameStampLeavesTheServerToChoose() {
    var ledger = SettingsLedger()
    ledger.edit(address, to: ftp(250), at: time(3_000))
    ledger.receive(SettingWrite(address, ftp(270), at: at(3_000)))
    #expect(ledger.unsent == [SettingWrite(address, ftp(250), at: at(3_000))])
    ledger.settle(SettingWrite(address, ftp(270), at: at(3_000)))
    #expect(ledger.unsent.isEmpty)
    #expect(ledger.live.map(\.change) == [ftp(270)])
  }

  @Test func theServersAnswerAtTheSameStampSettlesAnEdit() {
    var ledger = SettingsLedger()
    ledger.edit(address, to: ftp(250), at: time(3_000))
    ledger.settle(SettingWrite(address, ftp(250), at: at(3_000)))
    #expect(ledger.unsent.isEmpty)
    #expect(ledger.live.map(\.change) == [ftp(250)])
  }

  @Test func anAnswerToAnEditMadeAgainWhileItWasSentLeavesTheNewerEditUnsent() {
    var ledger = SettingsLedger()
    ledger.edit(address, to: ftp(250), at: time(3_000))
    let sent = ledger.unsent
    ledger.edit(address, to: ftp(255), at: time(4_000))
    for write in sent { ledger.settle(write) }
    #expect(ledger.unsent == [SettingWrite(address, ftp(255), at: at(4_000))])
  }

  @Test func aRemovalFromTheServerLeavesATombstoneAnOlderWriteCannotUndo() {
    var ledger = SettingsLedger()
    ledger.receive(SettingWrite(address, ftp(250), at: at(1_000)))
    ledger.receive(SettingWrite(address, nil, at: at(2_000)))
    ledger.receive(SettingWrite(address, ftp(250), at: at(1_000)))
    #expect(ledger.live.isEmpty)
    #expect(ledger.write(at: address) == SettingWrite(address, nil, at: at(2_000)))
  }

  @Test func anEditComesAfterTheValueItReplacesEvenWhenTheClockIsBehind() {
    var ledger = SettingsLedger()
    ledger.receive(SettingWrite(address, ftp(250), at: at(9_000)))
    ledger.edit(address, to: ftp(240), at: time(5_000))
    #expect(ledger.unsent == [SettingWrite(address, ftp(240), at: at(9_001))])
  }

  @Test func aMigratedValueLosesToAnyRealEdit() {
    var ledger = SettingsLedger()
    ledger.migrate(address, to: ftp(200))
    ledger.receive(SettingWrite(address, ftp(260), at: at(1)))
    #expect(ledger.live.map(\.change) == [ftp(260)])
    #expect(ledger.unsent.isEmpty)
  }

  @Test func claimsOnlyAnUnclaimedLedger() {
    var ledger = SettingsLedger()
    ledger.claim(for: "ada")
    ledger.claim(for: "bob")
    #expect(ledger.account == "ada")
  }

  @Test func roundTripsThroughCoding() throws {
    var ledger = SettingsLedger()
    ledger.claim(for: "ada")
    ledger.edit(address, to: ftp(250), at: time(3_000))
    ledger.receive(SettingWrite(SettingAddress(.weight, on: address.day), nil, at: at(2_000)))
    ledger.received(through: "12")
    let decoded = try JSONDecoder().decode(
      SettingsLedger.self, from: JSONEncoder().encode(ledger))
    #expect(decoded == ledger)
  }
}

import Foundation
import Testing

@testable import RideData

struct SettingWireTests {
  private func json(_ value: some Encodable) throws -> NSDictionary {
    try #require(
      JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? NSDictionary)
  }

  @Test func encodesChangesAsTheContractNamesThem() throws {
    #expect(
      try json(SettingChange.threshold(sport: nil, threshold: "ftp", value: 250))
        == ["kind": "threshold", "sport": NSNull(), "threshold": "ftp", "value": 250])
    #expect(
      try json(
        SettingChange.zones(
          sport: "running", metric: "pace", model: "friel_running_pace", customLimits: nil))
        == [
          "kind": "zones", "sport": "running", "metric": "pace", "model": "friel_running_pace",
          "customLimits": NSNull(),
        ])
    #expect(
      try json(
        SettingChange.thresholdTest(
          id: "a", sport: nil, threshold: "ftp", protocol: "ramp", value: 250, activityID: nil))
        == [
          "kind": "threshold_test", "id": "a", "sport": NSNull(), "threshold": "ftp",
          "protocol": "ramp", "value": 250, "activityId": NSNull(),
        ])
    #expect(
      try json(SettingKey.ownZones(sport: "running", metric: "power")) == [
        "kind": "own_zones", "sport": "running", "metric": "power",
      ])
  }

  @Test func everyChangeTheAppMakesRoundTripsThroughTheContract() throws {
    let changes: [ZoneChange] = [
      .threshold(.lactateThresholdHeartRate, scope: .all, value: 170),
      .threshold(.thresholdPace, scope: .sport(.swimming), value: 95),
      .threshold(.ftp, scope: .all, value: nil),
      .choice(
        .power, scope: .sport(.running),
        ZoneChoice(model: .coggan7, customLimits: [1, 2, 3, 4, 5, 6])),
      .choice(.heartRate, scope: .all, ZoneChoice(model: .seilerHeartRate)),
      .ownZones(.heartRate, sport: .rowing, true),
      .listed(.strength, false),
    ]
    for change in changes {
      let decoded = try JSONDecoder().decode(
        SettingChange.self, from: JSONEncoder().encode(change.setting))
      #expect(ZoneChange(decoded) == change)
    }
    let test = FTPTest(date: .now, kind: .eightMinute, ftp: 280, scope: .sport(.cycling))
    let day = SettingDay(test.date)
    #expect(FTPTest(test.setting, on: day)?.id == test.id)
    #expect(FTPTest(test.setting, on: day)?.kind == .eightMinute)
  }

  @Test func namesEveryThresholdAndModelAsTheServerDoes() {
    #expect(Threshold.allCases.map(\.wireName).allSatisfy { Threshold(wireName: $0) != nil })
    #expect(ZoneModel.allCases.map(\.wireName).allSatisfy { ZoneModel(wireName: $0) != nil })
    #expect(ZoneModel.coggan6.wireName == "coggan_6")
    #expect(Threshold.lactateThresholdHeartRate.wireName == "lactate_threshold_heart_rate")
  }

  @Test func writesStampsToTheMillisecondAsTheServerDoes() throws {
    let stamp = SettingStamp(milliseconds: 1_794_562_800_123)
    #expect(stamp.iso8601 == "2026-11-13T09:40:00.123Z")
    #expect(SettingStamp(iso8601: "2026-11-13T09:40:00.123Z") == stamp)
    #expect(
      SettingStamp(iso8601: "2026-11-13T09:40:00Z") == SettingStamp(milliseconds: 1_794_562_800_000)
    )
    #expect(SettingStamp.beforeAnyEdit.iso8601 == "1970-01-01T00:00:00.000Z")
    #expect(SettingStamp(iso8601: "yesterday") == nil)
  }

  @Test func readsDaysAsTheAthletesCalendarDays() throws {
    #expect(SettingDay("2026-11-13")?.text == "2026-11-13")
    #expect(SettingDay("2026-13-01") == nil)
    #expect(SettingDay("26-11-13") == nil)
    var tokyo = Calendar(identifier: .gregorian)
    tokyo.timeZone = TimeZone(identifier: "Asia/Tokyo")!
    let lateEveningInLondon = Date(timeIntervalSince1970: 1_794_610_800)
    #expect(SettingDay(lateEveningInLondon, calendar: tokyo).text == "2026-11-14")
    #expect(SettingDay("2026-11-14")!.date(in: tokyo) == tokyo.startOfDay(for: lateEveningInLondon))
  }
}

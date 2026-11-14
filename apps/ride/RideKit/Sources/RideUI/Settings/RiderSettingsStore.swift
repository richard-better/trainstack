import Foundation
import Observation
import RideData

@Observable
final class RiderSettingsStore {
  private(set) var settings: RiderSettings
  var powerDisplay: PowerDisplay {
    didSet { if let defaults { powerDisplay.save(to: defaults) } }
  }
  @ObservationIgnored private let defaults: UserDefaults?
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored var onEdit: (() -> Void)?

  init(defaults: UserDefaults = .standard, now: @escaping () -> Date = { .now }) {
    self.defaults = defaults
    self.now = now
    settings = RiderSettings.load(from: defaults)
    powerDisplay = PowerDisplay.load(from: defaults)
  }

  init(settings: RiderSettings, now: @escaping () -> Date = { .now }) {
    self.defaults = nil
    self.now = now
    self.settings = settings
    powerDisplay = .standard
  }

  var isStored: Bool { defaults != nil }

  var current: ZoneProfile { settings.history.current }

  var ftp: Int? { current.value(of: .ftp, in: .sport(.cycling)) }

  var heartRateZones: ZoneSet? { current.zones(for: .heartRate, in: .cycling) }

  var weight: Double {
    get { settings.weight }
    set {
      settings.setWeight(newValue, at: now())
      edited()
    }
  }

  var historyEntries: [ZoneHistory.Entry] { settings.history.entries }

  func zones(for metric: ZoneMetric, of recording: RideRecording) -> ZoneSet? {
    settings.history.profile(on: recording.startDate).zones(for: metric, in: recording.sport)
  }

  func settings(for metric: ZoneMetric, of recording: RideRecording) -> MetricZones? {
    settings.history.profile(on: recording.startDate)
      .settings(for: metric, in: recording.sport.map(ZoneScope.sport) ?? .all)
  }

  func timeInZones(of recording: RideRecording, for metric: ZoneMetric) -> [ZoneShare] {
    zones(for: metric, of: recording).map { recording.timeInZones($0, of: metric) } ?? []
  }

  func ftp(for recording: RideRecording) -> Int? {
    settings(for: .power, of: recording)?.thresholds[.ftp]
  }

  subscript(threshold: Threshold, scope: ZoneScope) -> Int? {
    get { current.value(of: threshold, in: scope) }
    set {
      guard newValue.map(threshold.range.contains) ?? true else { return }
      record(.threshold(threshold, scope: scope, value: newValue))
    }
  }

  subscript(modelFor metric: ZoneMetric, in scope: ZoneScope) -> ZoneModel? {
    get {
      guard let choice = current.settings(for: metric, in: scope)?.choice else { return nil }
      return choice.isCustom ? nil : choice.model
    }
    set {
      if let newValue { choose(newValue, in: scope) }
    }
  }

  subscript(endOfZone index: Int, for metric: ZoneMetric, in scope: ZoneScope) -> Int? {
    get { current.settings(for: metric, in: scope)?.zones?.zones.first { $0.index == index }?.end }
    set {
      if let newValue { setLimit(newValue, ofZone: index, for: metric, in: scope) }
    }
  }

  subscript(usesDefault metric: ZoneMetric, in sport: Sport) -> Bool {
    get { current.usesDefault(metric, in: sport) }
    set { setUsesDefault(newValue, for: metric, in: sport) }
  }

  func choose(_ model: ZoneModel, in scope: ZoneScope) {
    record(.choice(model.metric, scope: scope, ZoneChoice(model: model)))
  }

  func setLimit(_ limit: Int, ofZone index: Int, for metric: ZoneMetric, in scope: ZoneScope) {
    guard let own = current.settings(for: metric, in: scope),
      let limits = own.zones?.limits(settingZone: index, endTo: limit)
    else { return }
    record(
      .choice(metric, scope: scope, ZoneChoice(model: own.choice.model, customLimits: limits)))
  }

  func setUsesDefault(_ usesDefault: Bool, for metric: ZoneMetric, in sport: Sport) {
    record(.ownZones(metric, sport: sport, !usesDefault))
  }

  func setListed(_ isListed: Bool, _ sport: Sport) {
    record(.listed(sport, isListed))
  }

  func moveHistoryEntry(_ id: ZoneHistory.Entry.ID, to date: Date) {
    settings.moveHistoryEntry(id, to: date, at: now())
    edited()
  }

  func removeHistoryEntry(_ id: ZoneHistory.Entry.ID) {
    settings.removeHistoryEntry(id, at: now())
    edited()
  }

  func ftpTests(in scope: ZoneScope) -> [FTPTest] { settings.ftpTests(in: scope) }

  func add(_ test: FTPTest, updatesFTP: Bool) {
    settings.add(test, updatesFTP: updatesFTP, at: now())
    edited()
  }

  func removeFTPTest(_ id: FTPTest.ID) {
    settings.removeFTPTest(id, at: now())
    edited()
  }

  private func record(_ change: ZoneChange) {
    let now = now()
    settings.record([change], on: now, at: now)
    edited()
  }

  private func edited() {
    save()
    onEdit?()
  }

  func receive(_ writes: [SettingWrite], through cursor: String?) {
    settings.receive(writes, through: cursor)
    save()
  }

  func settle(_ writes: [SettingWrite]) {
    settings.settle(writes)
    save()
  }

  func claim(for account: String) {
    settings.claim(for: account)
    save()
  }

  func forgetAccount() {
    settings.forgetAccount()
    save()
  }

  func replaceLedger(with ledger: SettingsLedger) {
    settings = RiderSettings(ledger: ledger)
    save()
  }

  private func save() {
    if let defaults { settings.save(to: defaults) }
  }

  static var sample: RiderSettingsStore {
    var settings = RiderSettings()
    let start = Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 1)) ?? .now
    settings.record(
      [
        .threshold(.maxHeartRate, scope: .all, value: 186),
        .threshold(.ftp, scope: .all, value: 200),
      ], on: start)
    return RiderSettingsStore(settings: settings)
  }
}

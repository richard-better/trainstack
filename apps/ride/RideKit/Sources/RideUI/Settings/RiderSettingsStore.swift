import Foundation
import Observation
import RideData

/// The rider's zone settings as the app reads and edits them. Edits take effect today, are saved
/// as they are made, and a threshold outside its allowed range is ignored.
@Observable
final class RiderSettingsStore {
  private(set) var settings: RiderSettings
  @ObservationIgnored private let defaults: UserDefaults?

  /// Loads from `defaults` and saves back to it.
  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    settings = RiderSettings.load(from: defaults)
  }

  /// Holds `settings` in memory only, for previews and sample rides.
  init(settings: RiderSettings) {
    self.defaults = nil
    self.settings = settings
  }

  /// The zones in effect today.
  var current: ZoneProfile { settings.history.current }

  /// The FTP an indoor ride's targets are set from today: cycling's own, or else Default's.
  var ftp: Int? { current.value(of: .ftp, in: .sport(.cycling)) }

  var historyEntries: [ZoneHistory.Entry] { settings.history.entries }

  // MARK: Activities

  /// The zones `recording` is analysed with: those of its sport on the day it was recorded.
  func zones(for metric: ZoneMetric, of recording: RideRecording) -> ZoneSet? {
    settings.history.profile(on: recording.startDate).zones(for: metric, in: recording.sport)
  }

  /// The settings behind `zones(for:of:)`.
  func settings(for metric: ZoneMetric, of recording: RideRecording) -> MetricZones? {
    settings.history.profile(on: recording.startDate)
      .settings(for: metric, in: recording.sport.map(ZoneScope.sport) ?? .all)
  }

  /// Time in each of the zones `recording` is analysed with, or none without zones.
  func timeInZones(of recording: RideRecording, for metric: ZoneMetric) -> [ZoneShare] {
    zones(for: metric, of: recording).map { recording.timeInZones($0, of: metric) } ?? []
  }

  func ftp(for recording: RideRecording) -> Int? {
    settings(for: .power, of: recording)?.thresholds[.ftp]
  }

  // MARK: Editing

  subscript(threshold: Threshold, scope: ZoneScope) -> Int? {
    get { current.value(of: threshold, in: scope) }
    set {
      guard newValue.map(threshold.range.contains) ?? true else { return }
      record(.threshold(threshold, scope: scope, value: newValue))
    }
  }

  /// The model a scope's zones for `metric` follow, or nil when they are custom. Setting nil
  /// leaves them as they are, since custom zones come from editing them.
  subscript(modelFor metric: ZoneMetric, in scope: ZoneScope) -> ZoneModel? {
    get {
      guard let choice = current.settings(for: metric, in: scope)?.choice else { return nil }
      return choice.isCustom ? nil : choice.model
    }
    set {
      if let newValue { choose(newValue, in: scope) }
    }
  }

  /// Where a zone ends, which moves where the next starts. See `setLimit(_:ofZone:for:in:)`.
  subscript(endOfZone index: Int, for metric: ZoneMetric, in scope: ZoneScope) -> Int? {
    get { current.settings(for: metric, in: scope)?.zones?.zones.first { $0.index == index }?.end }
    set {
      if let newValue { setLimit(newValue, ofZone: index, for: metric, in: scope) }
    }
  }

  /// Whether `sport` uses Default's zones for `metric` rather than its own.
  subscript(usesDefault metric: ZoneMetric, in sport: Sport) -> Bool {
    get { current.usesDefault(metric, in: sport) }
    set { setUsesDefault(newValue, for: metric, in: sport) }
  }

  /// Follows `model`, dropping any custom limits.
  func choose(_ model: ZoneModel, in scope: ZoneScope) {
    record(.choice(model.metric, scope: scope, ZoneChoice(model: model)))
  }

  /// Moves the end of a zone, which makes the zones custom. Ignored when it would empty a zone.
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
    settings.history.move(id, to: date)
    save()
  }

  func removeHistoryEntry(_ id: ZoneHistory.Entry.ID) {
    settings.history.remove(id)
    save()
  }

  func ftpTests(in scope: ZoneScope) -> [FTPTest] { settings.ftpTests(in: scope) }

  func add(_ test: FTPTest, updatesFTP: Bool) {
    settings.add(test, updatesFTP: updatesFTP)
    save()
  }

  func removeFTPTest(_ id: FTPTest.ID) {
    settings.removeFTPTest(id)
    save()
  }

  private func record(_ change: ZoneChange) {
    settings.history.record([change], on: .now)
    save()
  }

  private func save() {
    if let defaults { settings.save(to: defaults) }
  }

  /// The settings the design's sample ride was shown with.
  static var sample: RiderSettingsStore {
    var settings = RiderSettings()
    let start = Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 1)) ?? .now
    settings.history.record(
      [
        .threshold(.maxHeartRate, scope: .all, value: 186),
        .threshold(.ftp, scope: .all, value: 200),
      ], on: start)
    return RiderSettingsStore(settings: settings)
  }
}

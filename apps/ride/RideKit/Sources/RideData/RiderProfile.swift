import Foundation

/// How a rider's zones for one metric are set: by a model, optionally with hand-edited limits.
public struct ZoneChoice: Codable, Equatable, Sendable {
  public var model: ZoneModel
  /// Hand-edited zone tops that replace the model's, or nil to follow the model. They stay put
  /// when thresholds change.
  public var customUpperLimits: [Int]?

  public init(model: ZoneModel, customUpperLimits: [Int]? = nil) {
    self.model = model
    self.customUpperLimits = customUpperLimits
  }

  public var isCustom: Bool { customUpperLimits != nil }
}

/// What a rider's zones and training stress are measured against.
public struct RiderProfile: Equatable, Sendable {
  /// Beats per minute.
  public var lactateThresholdHeartRate: Int?
  /// Beats per minute.
  public var maxHeartRate: Int?
  /// Beats per minute.
  public var restingHeartRate: Int?
  /// Functional threshold power, in watts.
  public var ftp: Int?
  public var heartRateZoneChoice: ZoneChoice
  public var powerZoneChoice: ZoneChoice

  public init(
    lactateThresholdHeartRate: Int? = nil, maxHeartRate: Int? = nil,
    restingHeartRate: Int? = nil, ftp: Int? = nil,
    heartRateZoneChoice: ZoneChoice = ZoneChoice(model: .standard(for: .heartRate)),
    powerZoneChoice: ZoneChoice = ZoneChoice(model: .standard(for: .power))
  ) {
    self.lactateThresholdHeartRate = lactateThresholdHeartRate
    self.maxHeartRate = maxHeartRate
    self.restingHeartRate = restingHeartRate
    self.ftp = ftp
    self.heartRateZoneChoice = heartRateZoneChoice
    self.powerZoneChoice = powerZoneChoice
  }

  /// The values a threshold may take.
  public static func range(of threshold: Threshold) -> ClosedRange<Int> {
    switch threshold {
    case .lactateThresholdHeartRate: 80...220
    case .maxHeartRate: 100...230
    case .restingHeartRate: 25...99
    case .ftp: 50...600
    }
  }

  /// The threshold's value. Setting one outside its range is ignored.
  public subscript(threshold: Threshold) -> Int? {
    get {
      switch threshold {
      case .lactateThresholdHeartRate: lactateThresholdHeartRate
      case .maxHeartRate: maxHeartRate
      case .restingHeartRate: restingHeartRate
      case .ftp: ftp
      }
    }
    set {
      guard newValue.map(Self.range(of: threshold).contains) ?? true else { return }
      switch threshold {
      case .lactateThresholdHeartRate: lactateThresholdHeartRate = newValue
      case .maxHeartRate: maxHeartRate = newValue
      case .restingHeartRate: restingHeartRate = newValue
      case .ftp: ftp = newValue
      }
    }
  }

  public func zoneChoice(for metric: ZoneMetric) -> ZoneChoice {
    switch metric {
    case .heartRate: heartRateZoneChoice
    case .power: powerZoneChoice
    }
  }

  public mutating func setZoneChoice(_ choice: ZoneChoice, for metric: ZoneMetric) {
    switch metric {
    case .heartRate: heartRateZoneChoice = choice
    case .power: powerZoneChoice = choice
    }
  }

  /// The rider's zones for `metric`, or nil when the chosen model needs a missing threshold.
  public func zones(for metric: ZoneMetric) -> ZoneSet? {
    let choice = zoneChoice(for: metric)
    if let custom = choice.customUpperLimits {
      return ZoneSet(model: choice.model, upperLimits: custom)
    }
    return choice.model.upperLimits(for: self).flatMap {
      ZoneSet(model: choice.model, upperLimits: $0)
    }
  }

  /// The thresholds the chosen model for `metric` needs and the rider has not set.
  public func missingThresholds(for metric: ZoneMetric) -> [Threshold] {
    let choice = zoneChoice(for: metric)
    guard !choice.isCustom else { return [] }
    return choice.model.basis.thresholds.filter { self[$0] == nil }
  }

  private static func key(for threshold: Threshold) -> String {
    switch threshold {
    case .lactateThresholdHeartRate: "riderProfile.lactateThresholdHeartRate"
    case .maxHeartRate: "riderProfile.maxHeartRate"
    case .restingHeartRate: "riderProfile.restingHeartRate"
    case .ftp: "riderProfile.ftp"
    }
  }

  private static func key(for metric: ZoneMetric) -> String {
    switch metric {
    case .heartRate: "riderProfile.heartRateZoneChoice"
    case .power: "riderProfile.powerZoneChoice"
    }
  }

  /// The saved profile. A saved value outside its range, or custom limits that no longer fit
  /// their model, are dropped as if never set.
  public static func load(from defaults: UserDefaults) -> RiderProfile {
    var profile = RiderProfile()
    for threshold in Threshold.allCases {
      profile[threshold] = defaults.object(forKey: key(for: threshold)) as? Int
    }
    for metric in ZoneMetric.allCases {
      let stored = defaults.data(forKey: key(for: metric)).flatMap {
        try? JSONDecoder().decode(ZoneChoice.self, from: $0)
      }
      guard var choice = stored, choice.model.metric == metric else { continue }
      if let custom = choice.customUpperLimits,
        ZoneSet(model: choice.model, upperLimits: custom) == nil
      {
        choice.customUpperLimits = nil
      }
      profile.setZoneChoice(choice, for: metric)
    }
    return profile
  }

  public func save(to defaults: UserDefaults) {
    for threshold in Threshold.allCases {
      let key = Self.key(for: threshold)
      if let value = self[threshold] {
        defaults.set(value, forKey: key)
      } else {
        defaults.removeObject(forKey: key)
      }
    }
    for metric in ZoneMetric.allCases {
      defaults.set(
        try? JSONEncoder().encode(zoneChoice(for: metric)), forKey: Self.key(for: metric))
    }
  }
}

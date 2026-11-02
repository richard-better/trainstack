import Foundation

public struct ZoneSet: Equatable, Sendable {
  public let zones: [Zone]
  public let isDescending: Bool

  public init?(model: ZoneModel, limits: [Int]) {
    let isDescending = model.metric.isDescending
    guard limits.count == model.zoneCount - 1, Self.isValid(limits, descending: isDescending)
    else { return nil }
    let step = isDescending ? -1 : 1
    self.isDescending = isDescending
    zones = model.zoneNames.indices.map { index in
      Zone(
        index: index, label: model.zoneLabels[index], name: model.zoneNames[index],
        start: index == 0 ? nil : limits[index - 1] + step,
        end: index < limits.count ? limits[index] : nil,
        intensity: model.intensities[index], zoneCount: model.zoneCount)
    }
  }

  public var limits: [Int] { zones.compactMap(\.end) }

  public func zone(containing value: Int) -> Zone {
    zones.last { zone in
      guard let start = zone.start else { return true }
      return isDescending ? value <= start : value >= start
    } ?? zones[0]
  }

  public func limits(settingZone index: Int, endTo limit: Int) -> [Int]? {
    var limits = limits
    guard limits.indices.contains(index) else { return nil }
    limits[index] = limit
    return Self.isValid(limits, descending: isDescending) ? limits : nil
  }

  private static func isValid(_ limits: [Int], descending: Bool) -> Bool {
    descending
      ? zip(limits, limits.dropFirst() + [1]).allSatisfy { $0 > $1 }
      : zip([-1] + limits, limits).allSatisfy { $0 < $1 }
  }
}

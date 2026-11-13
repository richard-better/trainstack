import Foundation
import Testing

@testable import RideData

struct ZoneParityTests {
  static let expected = URL(filePath: #filePath).deletingLastPathComponent().appending(
    path: "Zones/zones.json")

  @Test func computesTheZonesTheServerComputes() throws {
    let document = Self.document()
    if ProcessInfo.processInfo.environment["RIDE_RECORD_ZONES"] == "1" {
      try document.write(to: Self.expected, atomically: true, encoding: .utf8)
    }
    let recorded = try String(contentsOf: Self.expected, encoding: .utf8)
    #expect(
      recorded == document,
      "Ride's zones no longer match Zones/zones.json, which tests/ride-zones.test.mjs holds @trainstack/zones to. Change both, then record with RIDE_RECORD_ZONES=1."
    )
  }

  private static func document() -> String {
    var lines = ["{"]
    lines.append(#"  "thresholds": {"#)
    lines.append(
      Threshold.allCases.map { threshold in
        "    \(json(threshold.wireName)): "
          + object([
            ("metric", json(threshold.metric.wireName)), ("min", "\(threshold.range.lowerBound)"),
            ("max", "\(threshold.range.upperBound)"),
          ])
      }.joined(separator: ",\n"))
    lines.append("  },")
    lines.append(#"  "models": {"#)
    lines.append(
      ZoneModel.allCases.map { "    \(json($0.wireName)): \(definition(of: $0))" }.joined(
        separator: ",\n"))
    lines.append("  },")
    lines.append(#"  "sports": {"#)
    lines.append(
      Sport.allCases.map { sport in
        "    \(json(sport.rawValue)): "
          + object([
            ("metrics", array(sport.metrics.map { json($0.wireName) })),
            ("paceDistanceMetres", sport.paceDistanceMetres.map { "\(Int($0))" } ?? "null"),
          ])
      }.joined(separator: ",\n"))
    lines.append("  },")
    lines.append(#"  "choices": ["#)
    lines.append(choices().joined(separator: ",\n"))
    lines.append("  ],")
    lines.append(#"  "zones": ["#)
    lines.append(zoneCases().joined(separator: ",\n"))
    lines.append("  ],")
    lines.append(#"  "customLimits": ["#)
    lines.append(customLimitCases().joined(separator: ",\n"))
    lines.append("  ]")
    lines.append("}")
    return lines.joined(separator: "\n") + "\n"
  }

  private static func definition(of model: ZoneModel) -> String {
    object([
      ("metric", json(model.metric.wireName)), ("name", json(model.name)),
      ("thresholds", array(model.basis.thresholds.map { json($0.wireName) })),
      ("zoneNames", array(model.zoneNames.map(json))),
      ("zoneLabels", array(model.zoneLabels.map(json))),
      ("intensities", array(model.intensities.map { json($0.name.lowercased()) })),
    ])
  }

  private static func choices() -> [String] {
    ZoneMetric.allCases.flatMap { metric in
      ([nil] + Sport.allCases).map { sport in
        "    "
          + object([
            ("metric", json(metric.wireName)), ("sport", sport.map { json($0.rawValue) } ?? "null"),
            (
              "standard",
              ZoneModel.standard(for: metric, in: sport).map { json($0.wireName) } ?? "null"
            ),
            (
              "groups",
              array(
                ZoneModel.groups(for: metric, in: sport).map { group in
                  object([
                    ("title", json(group.title)),
                    ("models", array(group.models.map { json($0.wireName) })),
                  ])
                })
            ),
          ])
      }
    }
  }

  private static func values(of threshold: Threshold, count: Int) -> [Int] {
    let range = threshold.range
    let step = max(1, (range.upperBound - range.lowerBound) / (count - 1))
    return Array(
      Set(
        Array(stride(from: range.lowerBound, through: range.upperBound, by: step)) + [
          range.upperBound
        ])
    ).sorted()
  }

  private static func zoneCases() -> [String] {
    ZoneModel.allCases.flatMap { model -> [String] in
      let thresholds = model.basis.thresholds
      var combinations: [[Threshold: Int]] = [[:]]
      for threshold in thresholds {
        let count = thresholds.count == 1 ? 80 : 12
        combinations = combinations.flatMap { partial in
          values(of: threshold, count: count).map { partial.merging([threshold: $0]) { $1 } }
        }
      }
      return ([[:]] + combinations).map { values in
        let limits = model.limits(from: values)
        return "    "
          + object([
            ("model", json(model.wireName)),
            (
              "thresholds",
              object(
                thresholds.compactMap { threshold in
                  values[threshold].map { (threshold.wireName, "\($0)") }
                })
            ),
            ("limits", limits.map { array($0.map(String.init)) } ?? "null"),
            ("zones", zones(model, limits)),
          ])
      }
    }
  }

  private static func customLimitCases() -> [String] {
    ZoneModel.allCases.flatMap { model -> [String] in
      let middle = Dictionary(
        uniqueKeysWithValues: model.basis.thresholds.map { threshold in
          (threshold, (threshold.range.lowerBound + threshold.range.upperBound) / 2)
        })
      let sensible = model.limits(from: middle) ?? []
      var candidates = [
        sensible, sensible.reversed(), Array(sensible.dropLast()), sensible + [sensible.last ?? 0],
      ]
      for index in sensible.indices {
        var equal = sensible
        equal[index] = sensible[max(index - 1, 0)]
        candidates.append(equal)
      }
      candidates += [
        sensible.map { _ in 0 }, [-1] + sensible.dropFirst(), sensible.dropLast() + [1],
        sensible.dropLast() + [2],
      ]
      return candidates.map { limits in
        "    "
          + object([
            ("model", json(model.wireName)), ("limits", array(limits.map(String.init))),
            ("zones", zones(model, limits)),
          ])
      }
    }
  }

  private static func zones(_ model: ZoneModel, _ limits: [Int]?) -> String {
    guard let set = limits.flatMap({ ZoneSet(model: model, limits: $0) }) else { return "null" }
    return array(
      set.zones.map {
        array([$0.start.map(String.init) ?? "null", $0.end.map(String.init) ?? "null"])
      })
  }

  private static func json(_ string: String) -> String {
    String(decoding: try! JSONEncoder().encode(string), as: UTF8.self)
  }

  private static func array(_ items: [String]) -> String {
    "[" + items.joined(separator: ",") + "]"
  }

  private static func object(_ fields: [(String, String)]) -> String {
    "{" + fields.map { "\(json($0.0)):\($0.1)" }.joined(separator: ",") + "}"
  }
}

import Foundation
import RideData

extension UntilLap {
  var hint: String? {
    if let seconds = expectedSeconds { return "about \(Int((seconds / 60).rounded())) min" }
    if let meters = expectedMeters {
      return meters >= 1000
        ? "about \((meters / 1000).formatted(.oneDecimal)) km" : "about \(Int(meters)) m"
    }
    return nil
  }
}

import RideData
import SwiftUI

/// A threshold of a scope, such as FTP, with Default's value beside a sport's own.
struct ThresholdField: View {
  let threshold: Threshold
  let scope: ZoneScope
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    LabeledContent {
      HStack(spacing: 6) {
        if let hint = defaultHint {
          Text(hint).foregroundStyle(.tertiary)
        }
        field
          .labelsHidden()
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: 80)
        Text(threshold.metric.unit(in: scope.sport)).foregroundStyle(.secondary)
      }
    } label: {
      Text(threshold.title)
      Text(threshold.help(in: scope.sport))
    }
  }

  @ViewBuilder private var field: some View {
    @Bindable var store = store
    let value = $store[threshold, scope]
    if threshold.metric == .pace {
      TextField(threshold.title, value: value, format: .pace, prompt: Text("Not set"))
    } else {
      TextField(
        threshold.title, value: value, format: .number.grouping(.never), prompt: Text("Not set")
      )
      #if os(iOS)
        .keyboardType(.numberPad)
      #endif
    }
  }

  /// Default's value, shown beside a sport's own when they differ.
  private var defaultHint: String? {
    guard scope != .all, let value = store[threshold, .all], value != store[threshold, scope]
    else { return nil }
    return "Default \(threshold.metric.format(value))"
  }
}

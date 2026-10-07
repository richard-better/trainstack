import RideData
import SwiftUI

/// The model a scope's zones follow, with what it uses, as a menu where they can be edited.
struct ZoneModelRow: View {
  let scope: ZoneScope
  let metric: ZoneMetric
  let choice: ZoneChoice
  let isEditable: Bool
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    @Bindable var store = store
    let caption =
      choice.isCustom
      ? "Custom limits, based on \(choice.model.menuTitle)"
      : "Uses your \(choice.model.basis.thresholds.map(\.name).formatted(.list(type: .and)))"
    if isEditable {
      // Nil, shown as Custom, while the zones are custom.
      Picker(selection: $store[modelFor: metric, in: scope]) {
        ForEach(ZoneModel.groups(for: metric, in: scope.sport), id: \.title) { group in
          Section(group.title) {
            ForEach(group.models, id: \.self) { Text($0.menuTitle).tag(Optional($0)) }
          }
        }
        if choice.isCustom {
          Text("Custom").tag(ZoneModel?.none)
        }
      } label: {
        Text("Zone model")
        Text(caption)
      }
    } else {
      LabeledContent {
        Text(choice.isCustom ? "Custom" : choice.model.menuTitle)
      } label: {
        Text("Zone model")
        Text(caption)
      }
    }
  }
}

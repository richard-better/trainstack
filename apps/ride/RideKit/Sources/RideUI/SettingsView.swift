import RideData
import SwiftUI

/// The rider's zones: Default for every sport, and sports that keep their own.
struct SettingsView: View {
  @State private var scope = ZoneScope.all
  @State private var metric = ZoneMetric.heartRate
  @Environment(RiderSettingsStore.self) private var store
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  /// A scope that is no longer listed falls back to Default.
  private var shownScope: ZoneScope {
    guard let sport = scope.sport, store.current.sports[sport] == nil else { return scope }
    return .all
  }

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  var body: some View {
    Group {
      if isWide {
        HStack(spacing: 0) {
          ScopeList(selection: $scope)
            .frame(width: 230)
          Divider()
          ScopeForm(scope: shownScope, selection: $scope, metric: $metric, showsScopePicker: false)
        }
      } else {
        ScopeForm(scope: shownScope, selection: $scope, metric: $metric, showsScopePicker: true)
      }
    }
    .navigationTitle("Settings")
  }
}

/// Default and the listed sports, with buttons to add and remove sports.
private struct ScopeList: View {
  @Binding var selection: ZoneScope
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    VStack(spacing: 0) {
      List(selection: optionalSelection) {
        Section("Zones for") {
          ScopeRow(scope: .all).tag(ZoneScope.all)
          ForEach(store.current.listedSports, id: \.self) { sport in
            ScopeRow(scope: .sport(sport)).tag(ZoneScope.sport(sport))
          }
        }
      }
      Divider()
      HStack(spacing: 4) {
        AddSportMenu { selection = .sport($0) }
          .labelStyle(.iconOnly)
          .menuStyle(.button)
          .buttonStyle(.borderless)
        Button("Remove", systemImage: "minus") {
          if let sport = selection.sport { remove(sport) }
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .disabled(selection.sport == nil)
        Spacer()
      }
      .padding(8)
    }
  }

  /// The selection as a list takes it. Deselecting keeps the current scope.
  private var optionalSelection: Binding<ZoneScope?> {
    Binding(get: { selection }, set: { if let scope = $0 { selection = scope } })
  }

  private func remove(_ sport: Sport) {
    store.setListed(false, sport)
    selection = .all
  }
}

private struct ScopeRow: View {
  let scope: ZoneScope
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(scope.title)
      Text(summary).font(.caption).foregroundStyle(.secondary)
    }
    .padding(.vertical, 2)
  }

  private var summary: String {
    guard let sport = scope.sport else { return "Any sport without its own" }
    let own = sport.metrics.filter { !store.current.usesDefault($0, in: sport) }
    if own.isEmpty { return "Uses Default" }
    return "Own \(own.map(\.name).formatted(.list(type: .and))) zones"
  }
}

/// A menu of the sports not listed yet.
private struct AddSportMenu: View {
  let added: (Sport) -> Void
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    let unlisted = Sport.allCases.filter { store.current.sports[$0] == nil }
    Menu("Add Sport", systemImage: "plus") {
      Section("Add zones for") {
        ForEach(unlisted, id: \.self) { sport in
          Button(sport.name) {
            store.setListed(true, sport)
            added(sport)
          }
        }
      }
    }
    .disabled(unlisted.isEmpty)
  }
}

/// A scope's thresholds and zones for the chosen metric.
private struct ScopeForm: View {
  let scope: ZoneScope
  @Binding var selection: ZoneScope
  @Binding var metric: ZoneMetric
  let showsScopePicker: Bool
  @Environment(RiderSettingsStore.self) private var store

  private var metrics: [ZoneMetric] { store.current.metrics(in: scope) }

  /// The chosen metric, or the scope's first when it has no zones for that one.
  private var shownMetric: ZoneMetric {
    metrics.contains(metric) ? metric : metrics[0]
  }

  var body: some View {
    let metric = shownMetric
    Form {
      if showsScopePicker {
        ScopePickerSection(selection: $selection)
      }
      if let sport = scope.sport, metric != .pace {
        Section {
          Toggle("Use Default \(metric.name) zones", isOn: usesDefault(metric, in: sport))
        } footer: {
          Text(
            "Turn off to give \(sport.name.lowercased()) its own \(metric.name) zones, starting from a copy of Default's."
          )
        }
      }
      if isOwn(metric) {
        Section("Thresholds") {
          ForEach(Threshold.allCases.filter { $0.metric == metric }, id: \.self) {
            ThresholdField(threshold: $0, scope: scope)
          }
        }
      }
      ZonesSection(scope: scope, metric: metric)
    }
    .formStyle(.grouped)
    .toolbar {
      ToolbarItem(placement: .principal) {
        Picker("Metric", selection: $metric) {
          ForEach(metrics, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .fixedSize()
      }
    }
    .onChange(of: scope) { self.metric = shownMetric }
  }

  private func isOwn(_ metric: ZoneMetric) -> Bool {
    guard let sport = scope.sport else { return true }
    return !store.current.usesDefault(metric, in: sport)
  }

  private func usesDefault(_ metric: ZoneMetric, in sport: Sport) -> Binding<Bool> {
    Binding(
      get: { store.current.usesDefault(metric, in: sport) },
      set: { store.setUsesDefault($0, for: metric, in: sport) })
  }
}

/// On narrow screens, the choice between Default and the listed sports.
private struct ScopePickerSection: View {
  @Binding var selection: ZoneScope
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    Section {
      Picker("Zones for", selection: $selection) {
        Text("Default").tag(ZoneScope.all)
        ForEach(store.current.listedSports, id: \.self) { Text($0.name).tag(ZoneScope.sport($0)) }
      }
      AddSportMenu { selection = .sport($0) }
        .labelStyle(.titleAndIcon)
      if let sport = selection.sport {
        Button("Remove \(sport.name)", role: .destructive) {
          store.setListed(false, sport)
          selection = .all
        }
      }
    } footer: {
      Text("Default zones apply to every sport without its own.")
    }
  }
}

private struct ThresholdField: View {
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

  private var value: Binding<Int?> {
    Binding(get: { store[threshold, scope] }, set: { store[threshold, scope] = $0 })
  }

  /// Default's value, shown beside a sport's own when they differ.
  private var defaultHint: String? {
    guard scope != .all, let value = store[threshold, .all], value != store[threshold, scope]
    else { return nil }
    return "Default \(threshold.metric.format(value))"
  }
}

#Preview {
  NavigationStack {
    SettingsView()
  }
  .environment(RiderSettingsStore.sample)
}

import RideBluetooth
import RideData
import SwiftUI

/// A page of Settings.
enum SettingsPage: Hashable {
  case zones(ZoneScope)
  /// Reached from a zones page rather than the sidebar.
  case ftpTests(ZoneScope)
  case devices
}

/// Settings in its own sidebar, which takes over from the app's until Back to app. On macOS and
/// iPad; iPhone uses `SettingsList` in a tab instead.
struct SettingsSplitView: View {
  @Binding var page: SettingsPage
  let discovery: BluetoothDiscovery
  let back: () -> Void

  var body: some View {
    NavigationSplitView {
      SettingsSidebar(page: $page, back: back)
        .navigationSplitViewColumnWidth(min: 200, ideal: 220)
    } detail: {
      NavigationStack {
        SettingsPageView(page: page, discovery: discovery)
          .navigationDestination(for: SettingsPage.self) { page in
            SettingsPageView(page: page, discovery: discovery)
          }
      }
    }
  }
}

private struct SettingsSidebar: View {
  @Binding var page: SettingsPage
  let back: () -> Void
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    List(selection: optionalPage) {
      Button(action: back) {
        Label("Back to app", systemImage: "chevron.left")
      }
      .buttonStyle(.borderless)
      .foregroundStyle(.secondary)
      Section {
        Label("Zones", systemImage: "chart.bar")
        Group {
          Text("Default").tag(SettingsPage.zones(.all))
          ForEach(store.current.listedSports, id: \.self) { sport in
            SportRow(sport: sport)
              .tag(SettingsPage.zones(.sport(sport)))
              .contextMenu {
                Button("Remove \(sport.name)", role: .destructive) { remove(sport) }
              }
          }
          AddSportMenu { page = .zones(.sport($0)) }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .foregroundStyle(.secondary)
        }
        .padding(.leading, 24)
        Label("Devices", systemImage: "antenna.radiowaves.left.and.right")
          .tag(SettingsPage.devices)
      } header: {
        Text("Settings").font(.title3.weight(.semibold)).foregroundStyle(.primary)
      }
    }
  }

  /// The page as a list takes it. Deselecting keeps the current page.
  private var optionalPage: Binding<SettingsPage?> {
    Binding(get: { page }, set: { if let page = $0 { self.page = page } })
  }

  private func remove(_ sport: Sport) {
    store.setListed(false, sport)
    if page == .zones(.sport(sport)) { page = .zones(.all) }
  }
}

/// Settings as a list that drills into each page, for iPhone.
struct SettingsList: View {
  let discovery: BluetoothDiscovery
  @Binding var path: [SettingsPage]
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section("Zones") {
          NavigationLink("Default", value: SettingsPage.zones(.all))
          ForEach(store.current.listedSports, id: \.self) { sport in
            NavigationLink(value: SettingsPage.zones(.sport(sport))) { SportRow(sport: sport) }
          }
          .onDelete { offsets in
            let sports = store.current.listedSports
            for offset in offsets { store.setListed(false, sports[offset]) }
          }
          AddSportMenu { path.append(.zones(.sport($0))) }
        }
        Section {
          NavigationLink(value: SettingsPage.devices) {
            Label("Devices", systemImage: "antenna.radiowaves.left.and.right")
          }
        }
      }
      .navigationTitle("Settings")
      .navigationDestination(for: SettingsPage.self) { page in
        SettingsPageView(page: page, discovery: discovery)
      }
    }
  }
}

/// A sport in the list of zones, noting when it has none of its own.
private struct SportRow: View {
  let sport: Sport
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    HStack {
      Text(sport.name)
      Spacer()
      if sport.metrics.allSatisfy({ store.current.usesDefault($0, in: sport) }) {
        Text("Default").foregroundStyle(.tertiary)
      }
    }
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

private struct SettingsPageView: View {
  let page: SettingsPage
  let discovery: BluetoothDiscovery

  var body: some View {
    switch page {
    case .zones(let scope): ZonesPage(scope: scope)
    case .ftpTests(let scope): FTPTestsView(scope: scope)
    case .devices: DevicesView(discovery: discovery)
    }
  }
}

/// A scope's thresholds and zones for one metric at a time, chosen in the toolbar.
private struct ZonesPage: View {
  let scope: ZoneScope
  @State private var metric = ZoneMetric.heartRate
  @State private var isShowingHistory = false
  @Environment(RiderSettingsStore.self) private var store

  private var metrics: [ZoneMetric] { store.current.metrics(in: scope) }

  /// The chosen metric, or the scope's first when it has no zones for that one.
  private var shownMetric: ZoneMetric {
    metrics.contains(metric) ? metric : metrics[0]
  }

  var body: some View {
    let metric = shownMetric
    Form {
      if let sport = scope.sport, metric != .pace {
        Section {
          Toggle(isOn: usesDefault(metric, in: sport)) {
            Text("Use Default \(metric.name) zones")
            Text(
              "Turn off if your \(sport.name.lowercased()) \(metric.name) differs from your other sports"
            )
          }
        }
      }
      if isOwn(metric) {
        Section("Thresholds") {
          ForEach(Threshold.allCases.filter { $0.metric == metric }, id: \.self) {
            ThresholdField(threshold: $0, scope: scope)
          }
          if metric == .power {
            NavigationLink(value: SettingsPage.ftpTests(scope)) {
              LabeledContent("Last FTP test", value: lastFTPTest)
            }
          }
        }
      }
      ZonesSection(scope: scope, metric: metric)
    }
    .formStyle(.grouped)
    .frame(maxWidth: 700)
    .frame(maxWidth: .infinity)
    .navigationTitle(scope == .all ? "Default zones" : "\(scope.title) zones")
    .toolbar {
      ToolbarItem(placement: .principal) {
        Picker("Metric", selection: $metric) {
          ForEach(metrics, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .fixedSize()
      }
      ToolbarItem(placement: .primaryAction) {
        Button("Zone History…") { isShowingHistory = true }
      }
    }
    .sheet(isPresented: $isShowingHistory) {
      ZoneHistoryView()
    }
    .onChange(of: scope) { self.metric = shownMetric }
  }

  private var lastFTPTest: String {
    guard let test = store.ftpTests(in: scope).last else { return "None" }
    return "\(test.date.formatted(.dateTime.day().month(.wide))) · \(test.kind.name)"
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
  @Previewable @State var page = SettingsPage.zones(.all)
  SettingsSplitView(page: $page, discovery: BluetoothDiscovery()) {}
    .environment(RiderSettingsStore.sample)
}

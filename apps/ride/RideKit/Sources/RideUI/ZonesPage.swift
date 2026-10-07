import RideData
import SwiftUI

/// A scope's thresholds and zones for one metric at a time, chosen in the toolbar.
struct ZonesPage: View {
  let scope: ZoneScope
  @State private var metric = ZoneMetric.heartRate
  @State private var isShowingHistory = false
  /// Side margins that keep the rows no wider than is comfortable to read, or nil for the
  /// system's own.
  @State private var margins: EdgeInsets?
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
    // Limiting the form's own width would leave its background short of the column's edges.
    .contentMargins(.leading, margins?.leading, for: .scrollContent)
    .contentMargins(.trailing, margins?.trailing, for: .scrollContent)
    .onGeometryChange(for: EdgeInsets?.self, of: readableMargins) { margins = $0 }
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
        Button("Zone History…", systemImage: "clock.arrow.circlepath", action: showHistory)
      }
    }
    .sheet(isPresented: $isShowingHistory) {
      ZoneHistoryView()
    }
    .onChange(of: scope) { self.metric = shownMetric }
  }

  /// Margins that centre 700 points of rows. They include the safe area, such as under the
  /// sidebar on iPad, which content margins otherwise only overlap.
  nonisolated private func readableMargins(of proxy: GeometryProxy) -> EdgeInsets? {
    let extra = (proxy.size.width - 700) / 2
    guard extra > 30 else { return nil }
    let safeArea = proxy.safeAreaInsets
    return EdgeInsets(
      top: 0, leading: safeArea.leading + extra, bottom: 0, trailing: safeArea.trailing + extra)
  }

  private func showHistory() { isShowingHistory = true }

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

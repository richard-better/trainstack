import Charts
import RideData
import SwiftUI

/// How training is going: fitness, fatigue and form as numbers first, then the trend, then
/// where the time went.
struct TrainingProgressView: View {
  let library: RideLibrary
  let openSettings: () -> Void
  @Environment(RiderSettingsStore.self) private var settings
  @State private var span = Span.sixMonths
  @State private var zoneBasis: ZoneBasis?
  @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor

  private var calendar: Calendar { .current }
  private var rides: [RideRecording] { library.rides.map(\.recording) }

  var body: some View {
    Group {
      if rides.isEmpty {
        ContentUnavailableView(
          "No rides yet", systemImage: "chart.line.uptrend.xyaxis",
          description: Text("Fitness, fatigue and form build up here as you ride."))
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 22) {
            if settings.ftp != nil {
              let load = load()
              headline(load: load)
              trend(load: load)
            } else {
              headlineWithoutFTP
            }
            HStack(alignment: .top, spacing: 32) {
              timeInZone
              intensity
            }
          }
          .monospacedDigit()
          .padding(.horizontal, 32)
          .padding(.vertical, 24)
          .frame(maxWidth: 1100, alignment: .leading)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    .navigationTitle("Progress")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Picker("Period", selection: $span) {
          ForEach(Span.allCases, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .disabled(rides.isEmpty || settings.ftp == nil)
      }
    }
  }

  // MARK: Load

  private enum Span: CaseIterable {
    case sixWeeks, sixMonths, oneYear

    var title: String {
      switch self {
      case .sixWeeks: "6 weeks"
      case .sixMonths: "6 months"
      case .oneYear: "1 year"
      }
    }

    var days: Int {
      switch self {
      case .sixWeeks: 42
      case .sixMonths: 182
      case .oneYear: 365
      }
    }
  }

  /// Daily load for the longest span, starting early enough that fitness has built up by the
  /// first day shown.
  /// Each ride is scored against the FTP in effect on its day.
  private func load() -> [TrainingLoad] {
    let today = Date.now
    let lead = Int(TrainingLoad.fitnessDays) * 3
    let start = calendar.date(byAdding: .day, value: -(Span.oneYear.days + lead), to: today)!
    return TrainingLoad.daily(
      stress: rides.stressByDay(calendar: calendar) { settings.ftp(for: $0) }, from: start,
      through: today,
      calendar: calendar)
  }

  private func headline(load: [TrainingLoad]) -> some View {
    let now = load.last
    let monthAgo = load.dropLast(28).last
    let change = Int(((now?.fitness ?? 0) - (monthAgo?.fitness ?? 0)).rounded())
    return HStack(spacing: 0) {
      HeadlineStat(label: "Fitness", swatch: .primary, isFirst: true) {
        Text(rounded(now?.fitness))
        Text("\(signed(change)) in 4 weeks").font(.subheadline).foregroundStyle(.secondary)
      }
      HeadlineStat(label: "Fatigue") {
        Text(rounded(now?.fatigue))
      }
      HeadlineStat(label: "Form") {
        Text(signed(Int((now?.form ?? 0).rounded())))
        FormBadge(form: now?.form ?? 0)
      }
      thisWeek
    }
    .overlay(alignment: .top) { Divider() }
    .overlay(alignment: .bottom) { Divider() }
  }

  private var headlineWithoutFTP: some View {
    HStack(spacing: 0) {
      HeadlineStat(label: "Fitness", isFirst: true) {
        HStack(spacing: 4) {
          Text("Fitness and form are worked out from power.")
          Button("Add your FTP in Settings", action: openSettings).inlineLinkStyle()
        }
        .font(.callout.weight(.regular))
        .foregroundStyle(.secondary)
      }
      thisWeek
        .frame(maxWidth: 260, alignment: .leading)
    }
    .overlay(alignment: .top) { Divider() }
    .overlay(alignment: .bottom) { Divider() }
  }

  private var thisWeek: some View {
    let week = calendar.dateInterval(of: .weekOfYear, for: .now)
    let ridden = rides.filter { week?.contains($0.startDate) ?? false }
    let seconds = ridden.reduce(0) { $0 + $1.summary.duration }
    let stress = settings.ftp.map { _ in
      ridden.compactMap { ride in settings.ftp(for: ride).flatMap(ride.trainingStressScore) }
        .reduce(0, +)
    }
    let hours = "\(Int(seconds) / 3600):\(String(format: "%02d", Int(seconds) / 60 % 60))"
    return HeadlineStat(label: "This week") {
      Text(hours)
      Text(stress.map { "h · \($0) TSS" } ?? "h").font(.subheadline).foregroundStyle(.secondary)
    }
  }

  private func rounded(_ value: Double?) -> String {
    value.map { "\(Int($0.rounded()))" } ?? "—"
  }

  private func signed(_ value: Int) -> String {
    value > 0 ? "+\(value)" : value < 0 ? "−\(-value)" : "0"
  }

  // MARK: Trend

  private struct Week: Identifiable {
    let start: Date
    /// Average stress per day across the week, on the same scale as fitness.
    let dailyStress: Double
    var id: Date { start }
  }

  private func trend(load: [TrainingLoad]) -> some View {
    let shown = Array(load.suffix(span.days))
    let weeks = Dictionary(grouping: shown) {
      calendar.dateInterval(of: .weekOfYear, for: $0.date)?.start ?? $0.date
    }
    .map { Week(start: $0.key, dailyStress: $0.value.reduce(0) { $0 + $1.stress } / 7) }
    return VStack(alignment: .leading, spacing: 8) {
      HStack {
        HStack(spacing: 16) {
          LegendSwatch(title: "Fitness", color: .primary, height: 2)
          LegendSwatch(title: "Stress per day, by week", color: .primary.opacity(0.25), height: 10)
        }
        Spacer()
        Text("Fitness is your load over 6 weeks. Fatigue is the last 7 days.")
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      Chart {
        ForEach(weeks) { week in
          BarMark(
            x: .value("Week", week.start, unit: .weekOfYear),
            y: .value("Stress", week.dailyStress)
          )
          .foregroundStyle(Color.primary.opacity(0.25))
        }
        ForEach(shown, id: \.date) { day in
          LineMark(x: .value("Day", day.date, unit: .day), y: .value("Fitness", day.fitness))
            .foregroundStyle(Color.primary)
            .lineStyle(StrokeStyle(lineWidth: 2, lineJoin: .round))
        }
      }
      .chartYAxis {
        AxisMarks(values: .automatic(desiredCount: 4)) { _ in
          AxisGridLine().foregroundStyle(.quaternary)
          AxisValueLabel()
        }
      }
      .chartXAxis {
        AxisMarks(values: .stride(by: span == .sixWeeks ? .weekOfYear : .month)) { _ in
          AxisValueLabel(
            format: span == .sixWeeks ? .dateTime.day().month(.abbreviated) : .dateTime.month())
        }
      }
      .frame(height: 190)
    }
  }

  // MARK: Breakdown

  private enum ZoneBasis: String, CaseIterable {
    case power = "Power"
    case heartRate = "Heart rate"
  }

  private var zoneBases: [ZoneBasis] {
    var result: [ZoneBasis] = []
    if settings.current.zones(for: .power, in: nil) != nil { result.append(.power) }
    if settings.current.zones(for: .heartRate, in: nil) != nil { result.append(.heartRate) }
    return result
  }

  private var shownZoneBasis: Binding<ZoneBasis> {
    Binding(
      get: {
        if let zoneBasis, zoneBases.contains(zoneBasis) { return zoneBasis }
        return zoneBases.first ?? .power
      },
      set: { zoneBasis = $0 })
  }

  private var timeInZone: some View {
    let start = calendar.date(byAdding: .day, value: -28, to: .now) ?? .now
    let recent = rides.filter { $0.startDate >= start }
    return VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("Time in zone · last 4 weeks").font(.headline)
        Spacer()
        if zoneBases.count > 1 {
          Picker("Zones", selection: shownZoneBasis) {
            ForEach(zoneBases, id: \.self) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
        }
      }
      if zoneBases.isEmpty {
        Text("Set up your heart rate or power zones in Settings to see time in zone.")
          .font(.callout).foregroundStyle(.secondary)
      } else {
        let metric: ZoneMetric = shownZoneBasis.wrappedValue == .power ? .power : .heartRate
        ZoneTimeRows(shares: recent.map { timeInZones(of: $0, metric) }.combined())
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private struct Month: Identifiable {
    let start: Date
    let seconds: [Intensity: TimeInterval]
    var id: Date { start }
  }

  /// Time at each intensity per month for the last 12 months, from power zones when the rider
  /// has an FTP and heart rate zones otherwise.
  private var months: [Month] {
    let thisMonth = calendar.dateInterval(of: .month, for: .now)?.start ?? .now
    return (0..<12).reversed().compactMap { offset in
      guard let start = calendar.date(byAdding: .month, value: -offset, to: thisMonth),
        let end = calendar.date(byAdding: .month, value: 1, to: start)
      else { return nil }
      var seconds: [Intensity: TimeInterval] = [:]
      for ride in rides where (start..<end).contains(ride.startDate) {
        for (intensity, time) in intensities(of: ride) { seconds[intensity, default: 0] += time }
      }
      return Month(start: start, seconds: seconds)
    }
  }

  /// Time in the zones `ride` was ridden in: those of its sport on its day.
  private func timeInZones(of ride: RideRecording, _ metric: ZoneMetric) -> [ZoneShare] {
    settings.zones(for: metric, of: ride).map { ride.timeInZones($0, of: metric) } ?? []
  }

  private func intensities(of ride: RideRecording) -> [(Intensity, TimeInterval)] {
    let shares = [ZoneMetric.power, .heartRate].lazy.map { timeInZones(of: ride, $0) }
    return (shares.first { !$0.isEmpty } ?? []).map { ($0.zone.intensity, $0.seconds) }
  }

  private var intensity: some View {
    let months = months
    let totals = Dictionary(
      grouping: months.flatMap { $0.seconds.map { ($0.key, $0.value) } }, by: \.0
    ).mapValues { $0.reduce(0) { $0 + $1.1 } }
    let total = totals.values.reduce(0, +)
    return VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 6) {
        Text("Intensity · last 12 months").font(.headline)
        HStack(spacing: 12) {
          ForEach(Intensity.allCases, id: \.self) { intensity in
            let share = total > 0 ? Int(((totals[intensity] ?? 0) / total * 100).rounded()) : 0
            LegendSwatch(
              title: "\(intensity.name) \(share)%",
              color: intensity.color(differentiatingWithoutColor: differentiateWithoutColor),
              height: 10)
          }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      Chart {
        ForEach(months) { month in
          ForEach(Intensity.allCases.reversed(), id: \.self) { intensity in
            let hours = (month.seconds[intensity] ?? 0) / 3600
            BarMark(
              x: .value("Month", month.start, unit: .month),
              y: .value("Hours", hours)
            )
            .foregroundStyle(
              intensity.color(differentiatingWithoutColor: differentiateWithoutColor)
            )
            .accessibilityLabel(month.start.formatted(.dateTime.month(.wide).year()))
            .accessibilityValue(
              "\(intensity.name): \(hours.formatted(.number.precision(.fractionLength(1)))) h")
          }
        }
      }
      .chartYAxis(.hidden)
      .chartXAxis {
        AxisMarks(values: .stride(by: .month)) { _ in
          AxisValueLabel(format: .dateTime.month(.narrow), centered: true)
        }
      }
      .frame(height: 150)
      .accessibilityLabel("Hours at each intensity by month")
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

extension Intensity {
  /// With Differentiate Without Color on, easier intensities are also fainter, so they tell
  /// apart by more than hue.
  fileprivate func color(differentiatingWithoutColor: Bool) -> Color {
    guard differentiatingWithoutColor else { return color }
    return switch self {
    case .easy: color.opacity(0.35)
    case .moderate: color.opacity(0.65)
    case .hard: color
    }
  }

  fileprivate var color: Color {
    switch self {
    case .easy: .blue
    case .moderate: .yellow
    case .hard: .red
    }
  }
}

private struct HeadlineStat<Content: View>: View {
  let label: String
  var swatch: Color?
  /// The first stat in the row has no rule before it.
  var isFirst = false
  @ViewBuilder let content: Content
  @ScaledMetric(relativeTo: .title) private var valueSize = 28.0

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 6) {
        if let swatch { Rectangle().fill(swatch).frame(width: 12, height: 2) }
        Text(label)
      }
      .font(.caption)
      .foregroundStyle(.secondary)
      HStack(alignment: .firstTextBaseline, spacing: 6) { content }
        .font(.system(size: valueSize, weight: .medium))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
    .padding(.vertical, 14)
    .padding(.leading, isFirst ? 0 : 16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(alignment: .leading) {
      if !isFirst { Rectangle().fill(.separator).frame(width: 1) }
    }
    .accessibilityElement(children: .combine)
  }
}

/// What form means for the next ride, as a coloured label.
private struct FormBadge: View {
  let form: Double

  var body: some View {
    HStack(spacing: 5) {
      Circle().fill(state.color).frame(width: 6, height: 6)
      Text(state.title)
    }
    .font(.caption)
    .padding(.horizontal, 8)
    .padding(.vertical, 2)
    .background(.quaternary.opacity(0.6), in: .capsule)
  }

  private var state: (title: String, color: Color) {
    switch form {
    case 5...: ("Well recovered", .green)
    case -10..<5: ("Balanced", .gray)
    case -30 ..< -10: ("Building", .yellow)
    default: ("Overreaching", .red)
    }
  }
}

private struct ZoneTimeRows: View {
  let shares: [ZoneShare]

  var body: some View {
    if shares.isEmpty {
      Text("No rides with this data in the last 4 weeks.")
        .font(.callout).foregroundStyle(.secondary)
    } else {
      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 9) {
        ForEach(shares, id: \.zone) { share in
          GridRow {
            Text(share.zone.name).foregroundStyle(.secondary)
            Capsule()
              .fill(.quaternary.opacity(0.5))
              .frame(height: 8)
              .overlay(alignment: .leading) {
                GeometryReader { proxy in
                  Capsule().fill(share.zone.color)
                    .frame(width: proxy.size.width * share.fraction)
                }
              }
            Text("\(Int((share.fraction * 100).rounded()))%")
              .gridColumnAlignment(.trailing)
            Text(share.seconds > 0 ? share.seconds.spokenString : "—")
              .foregroundStyle(.secondary)
              .gridColumnAlignment(.trailing)
          }
          .accessibilityElement(children: .combine)
        }
      }
      .font(.caption)
    }
  }
}

#Preview {
  NavigationStack {
    TrainingProgressView(library: .sample()) {}
  }
  .environment(RiderSettingsStore.sample)
  .frame(width: 900, height: 800)
}

import Charts
import PrehabCore
import SwiftUI

struct ProgressScreen: View {
  @Environment(AppModel.self) private var model
  @State private var month = Date.now
  @State private var sessions: [SessionsGetAgendaOutputSessionsItem] = []
  @State private var checks: [CheckInListOutputCheckInsItem] = []
  @State private var plans: [PlansListOutputPlansItem] = []
  @State private var sessionID: String?
  var body: some View {
    List {
      Section {
        DatePicker("Month", selection: $month, displayedComponents: .date)
        Text(
          "\(sessions.filter { $0.completedAt != nil && !$0.isRestDay }.count) practices completed"
        ).font(.title2.bold())
        if !checks.isEmpty {
          Chart(checks) { check in
            BarMark(
              x: .value("Day", check.checkInDate),
              y: .value(
                "Readiness", check.readiness == "low" ? 1 : check.readiness == "high" ? 3 : 2)
            ).foregroundStyle(PrehabStyle.garden)
          }.frame(height: 180).accessibilityLabel("Daily readiness this month")
        }
      }
      Section("Practice history") {
        if sessions.isEmpty {
          ContentUnavailableView(
            "Your practice starts here", systemImage: "leaf",
            description: Text("Completed sessions will appear in your history."))
        }
        ForEach(sessions) { item in
          Button {
            sessionID = item.id
          } label: {
            HStack {
              Image(systemName: item.completedAt != nil ? "checkmark.circle.fill" : "circle")
              VStack(alignment: .leading) {
                Text(item.title.isEmpty ? "Rest day" : item.title)
                Text(item.sessionDate).font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              Text("\(item.exercisesCompleted)/\(item.exerciseCount)").monospacedDigit()
            }
          }.buttonStyle(.plain)
        }
      }
      Section("Plans") {
        ForEach(plans) { item in
          VStack(alignment: .leading, spacing: 4) {
            Text(item.headline ?? "Personalized plan").font(.headline)
            Text("\(item.startDate) - \(item.endDate) · \(item.status.displayName)")
              .foregroundStyle(.secondary)
          }
        }
      }
    }.navigationTitle("Progress").task(id: LocalDay.string(month)) {
      await model.perform { try await load() }
    }
    .navigationDestination(item: $sessionID) { SessionDetailView(id: $0) }
  }
  private func load() async throws {
    guard let interval = Calendar.current.dateInterval(of: .month, for: month) else { return }
    let input: [String: JSONValue] = [
      "startDate": .string(LocalDay.string(interval.start)),
      "endDate": .string(LocalDay.string(interval.end.addingTimeInterval(-1))),
    ]
    async let s = model.api.call(Endpoints.sessionsGetAgenda, input)
    async let c = model.api.call(Endpoints.checkInList, input)
    async let p = model.api.call(Endpoints.plansList)
    (sessions, checks, plans) = try await (s.sessions, c.checkIns, p.plans)
  }
}

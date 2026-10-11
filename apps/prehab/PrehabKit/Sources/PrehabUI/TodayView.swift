import PrehabCore
import SwiftUI

struct TodayView: View {
  @Environment(AppModel.self) private var model
  @State private var date = Date.now
  @State private var agenda: SessionsGetAgendaOutput?
  @State private var plan: PlansGetActiveOutputPlan?
  @State private var streak = 0
  @State private var checkIn = false
  @State private var sessionID: String?
  @State private var busy = false
  @State private var showReveal = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        HStack {
          VStack(alignment: .leading) {
            Text("YOUR DAILY PRACTICE").font(.caption.monospaced()).foregroundStyle(.secondary)
            Text("A little care, \(model.name.components(separatedBy: " ").first ?? model.name).")
              .font(.largeTitle.bold().italic())
          }
          Spacer()
          Label("\(streak)", systemImage: "flame").foregroundStyle(PrehabStyle.accent)
        }
        DatePicker("Your day", selection: $date, displayedComponents: .date)
        if let plan {
          PrehabCard {
            VStack(alignment: .leading, spacing: 12) {
              Label("Week \(plan.currentWeek) of \(plan.totalWeeks)", systemImage: "leaf")
              Text(plan.headline ?? "Your personalized practice").font(.title2.bold())
              Text(plan.subtitle ?? "Small steps, built around you.").foregroundStyle(.secondary)
              if plan.generationStatus == "pending" { ProgressView("Building your plan…") }
              if plan.generationStatus == "failed" { Button("Retry plan") { generatePlan() } }
              Button("View plan") { showReveal = true }
            }
          }
        } else {
          PrehabCard {
            VStack(alignment: .leading, spacing: 12) {
              Text("Make room for movement.").font(.title2.bold())
              Text("Talk with Coach or choose a plan from Explore to get started.")
              Button("Build my plan") { generatePlan() }.buttonStyle(.borderedProminent)
            }
          }
        }
        Button {
          checkIn = true
        } label: {
          Label("How is your body today?", systemImage: "heart.text.clipboard")
        }.buttonStyle(.bordered)
        if let agenda {
          ForEach(agenda.sessions) { session in
            Button {
              sessionID = session.id
            } label: {
              PrehabCard {
                VStack(alignment: .leading, spacing: 12) {
                  Label(
                    session.sessionType?.displayName ?? "Practice",
                    systemImage: session.completedAt == nil
                      ? "figure.flexibility" : "checkmark.circle.fill"
                  ).foregroundStyle(PrehabStyle.garden)
                  Text(session.isRestDay ? "Rest is part of progress" : session.title).font(
                    .title2.bold())
                  Text(
                    session.isRestDay
                      ? "Take it gently today."
                      : "\(Int(session.estimatedDurationMin)) min · \(session.exerciseCount) exercises"
                  ).font(.callout.monospaced()).foregroundStyle(.secondary)
                  if session.status == "pending" || session.status == "generating" {
                    ProgressView("Preparing…")
                  }
                  if session.status == "failed" {
                    Text("Generation failed. Open to retry.").foregroundStyle(.red)
                  }
                }
              }
            }.buttonStyle(.plain)
          }
          if agenda.sessions.isEmpty {
            ForEach(agenda.schedule, id: \.date) { item in
              Text(item.title ?? item.sessionTheme).font(.headline)
            }
            Button("Prepare today's session") { generate() }.buttonStyle(.borderedProminent)
              .disabled(busy)
            Button("Take a rest day") {
              Task {
                await model.perform {
                  _ = try await model.api.call(
                    Endpoints.sessionsAcknowledgeRestDay,
                    ["sessionDate": .string(LocalDay.string(date))])
                  try await load()
                }
              }
            }
          }
        } else {
          ProgressView("Loading your day…")
        }
        if busy { ProgressView() }
      }.padding(24).frame(maxWidth: 850)
    }.frame(maxWidth: .infinity).navigationTitle("Today")
      .task(id: LocalDay.string(date)) {
        while !Task.isCancelled {
          await model.perform { try await load() }
          do { try await Task.sleep(for: .seconds(3)) } catch { break }
          if plan?.generationStatus != "pending"
            && !(agenda?.sessions.contains { ["pending", "generating"].contains($0.status) }
              ?? false)
          {
            break
          }
        }
      }
      .refreshable { await model.perform { try await load() } }
      .sheet(
        isPresented: $checkIn, onDismiss: { Task { await model.perform { try await load() } } }
      ) { CheckInView(date: date) }
      .sheet(isPresented: $showReveal) { NavigationStack { PlanRevealView() } }
      .navigationDestination(item: $sessionID) { SessionDetailView(id: $0) }
  }
  private func load() async throws {
    let day = LocalDay.string(date)
    async let a = model.api.call(
      Endpoints.sessionsGetAgenda, ["startDate": .string(day), "endDate": .string(day)])
    async let p = model.api.call(Endpoints.plansGetActive, ["today": .string(day)])
    async let s = model.api.call(Endpoints.sessionsStreak)
    (agenda, plan, streak) = try await (a, p.plan, s.currentStreak)
  }
  private func generate() {
    busy = true
    Task {
      await model.perform {
        sessionID = try await model.api.call(
          Endpoints.sessionsGenerateDailySession, ["sessionDate": .string(LocalDay.string(date))]
        ).id
      }
      busy = false
    }
  }
  private func generatePlan() {
    busy = true
    Task {
      await model.perform {
        _ = try await model.api.call(
          Endpoints.plansStartGenerated, ["today": .string(LocalDay.string(date))])
        showReveal = true
        try await load()
      }
      busy = false
    }
  }
}

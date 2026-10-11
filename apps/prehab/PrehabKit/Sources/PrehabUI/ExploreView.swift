import PrehabCore
import SwiftUI

struct ExploreView: View {
  @Environment(AppModel.self) private var model
  @State private var search = ""
  @State private var category = "Plans"
  @State private var plans: [PlansListTemplatesOutputTemplatesItem] = []
  @State private var sessions: [SessionTemplatesListOutputTemplatesItem] = []
  @State private var exercises: [ExercisesListOutputExercisesItem] = []
  @State private var route: ExploreRoute?
  @State private var sport = "All sports"
  var body: some View {
    List {
      Section {
        Picker("Browse", selection: $category) {
          ForEach(["Plans", "Sessions", "Exercises"], id: \.self) { Text($0).tag($0) }
        }.pickerStyle(.segmented)
        Picker("Sport", selection: $sport) {
          Text("All sports").tag("All sports")
          ForEach(Array(Set(exercises.flatMap(\.sportTags))).sorted(), id: \.self) {
            Text($0.displayName).tag($0)
          }
        }
      }
      if category == "Plans" {
        ForEach(plans.filter { matches($0.title, tags: $0.sportTags) }) { item in
          Button {
            route = .plan(item.id)
          } label: {
            VStack(alignment: .leading, spacing: 8) {
              Text(item.title).font(.headline)
              Text(item.description).foregroundStyle(.secondary)
              Text(
                "\(item.durationWeeks) weeks · \(item.sessionsPerWeek) sessions/week · \(item.level)"
              ).font(.caption.monospaced())
            }.padding(.vertical, 8)
          }.buttonStyle(.plain)
        }
      } else if category == "Sessions" {
        ForEach(sessions.filter { matches($0.title, tags: $0.sportTags) }) { item in
          Button {
            route = .template(item.id)
          } label: {
            VStack(alignment: .leading, spacing: 8) {
              Text(item.title).font(.headline)
              Text(item.description).foregroundStyle(.secondary)
              Text("\(Int(item.estimatedDurationMin)) min · \(Int(item.exerciseCount)) exercises")
                .font(.caption.monospaced())
            }.padding(.vertical, 8)
          }.buttonStyle(.plain)
        }
      } else {
        ForEach(exercises.filter { matches($0.name, tags: $0.sportTags) }) { item in
          Button {
            route = .exercise(item.id)
          } label: {
            HStack {
              AsyncImage(url: URL(string: item.thumbnailUrl)) { image in
                image.resizable().scaledToFill()
              } placeholder: {
                Image(systemName: "figure.flexibility").font(.title)
              }.frame(width: 56, height: 56).clipped().clipShape(.rect(cornerRadius: 10))
              VStack(alignment: .leading) {
                Text(item.name).font(.headline)
                Text(item.muscleGroup.displayName).foregroundStyle(.secondary)
              }
            }
          }.buttonStyle(.plain)
        }
      }
    }.navigationTitle("Explore").searchable(text: $search)
      .task {
        await model.perform {
          async let p = model.api.call(Endpoints.plansListTemplates)
          async let s = model.api.call(Endpoints.sessionTemplatesList)
          async let e = model.api.call(Endpoints.exercisesList)
          (plans, sessions, exercises) = try await (p.templates, s.templates, e.exercises)
        }
      }
      .navigationDestination(item: $route) { route in
        switch route {
        case .exercise(let id): ExerciseDetailView(id: id)
        case .template(let id): TemplateDetailView(id: id)
        case .plan(let id):
          if let plan = plans.first(where: { $0.id == id }) { PlanTemplateView(plan: plan) }
        }
      }
  }
  private func matches(_ title: String, tags: [String]) -> Bool {
    (search.isEmpty || title.localizedCaseInsensitiveContains(search))
      && (sport == "All sports" || tags.isEmpty || tags.contains(sport))
  }
}

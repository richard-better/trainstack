import PrehabCore
import SwiftUI

struct TemplateDetailView: View {
  @Environment(AppModel.self) private var model
  let id: String
  @State private var template: SessionTemplatesGetOutput?
  @State private var sessionID: String?
  @State private var busy = false
  var body: some View {
    List {
      if let template {
        Section {
          Text(template.title).font(.title.bold())
          Text(template.description)
          Text("\(Int(template.estimatedDurationMin)) minutes")
        }
        Section("Your exercises") {
          ForEach(template.exercises) { item in
            VStack(alignment: .leading) {
              Text(item.name).font(.headline)
              Text(
                "\(item.sets) sets · \(item.reps.map { "\($0) reps" } ?? "\(item.durationSec ?? 0) seconds")"
              ).foregroundStyle(.secondary)
            }
          }
        }
        Button("Start session") {
          busy = true
          Task {
            await model.perform {
              sessionID = try await model.api.call(
                Endpoints.sessionTemplatesStart,
                ["templateId": .string(id), "sessionDate": .string(LocalDay.string())]
              ).id
            }
            busy = false
          }
        }.disabled(busy).buttonStyle(.borderedProminent)
      } else {
        ProgressView()
      }
    }.navigationTitle("Session").task {
      await model.perform {
        template = try await model.api.call(Endpoints.sessionTemplatesGet, ["id": .string(id)])
      }
    }
    .navigationDestination(item: $sessionID) { SessionDetailView(id: $0) }
  }
}

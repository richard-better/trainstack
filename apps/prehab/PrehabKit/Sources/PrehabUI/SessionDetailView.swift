import PrehabCore
import SwiftUI

struct SessionDetailView: View {
  @Environment(AppModel.self) private var model
  let id: String
  @State private var session: SessionsGetByIdOutput?
  @State private var running = false
  @State private var note = ""
  @State private var replacementID: String?
  @State private var busy = false
  var body: some View {
    List {
      if let session {
        Section {
          Text(session.title.isEmpty ? "Your practice" : session.title).font(
            .largeTitle.bold().italic())
          if let reasoning = session.reasoningLong { Text(reasoning).foregroundStyle(.secondary) }
          if ["pending", "generating"].contains(session.status) {
            ProgressView("Preparing your session…")
          } else if session.status == "failed" {
            Text(session.generationError ?? "Please try preparing this session again.")
              .foregroundStyle(.red)
          } else if session.exercises.isEmpty {
            Label("Rest is part of progress", systemImage: "leaf")
            Text("Take it gently today.")
          } else {
            Text(
              "\(Int(session.estimatedDurationMin)) minutes · \(session.exercises.count) exercises")
            if session.completedAt != nil {
              Label("Practice complete", systemImage: "checkmark.circle.fill").foregroundStyle(
                PrehabStyle.garden)
            } else {
              Button(session.dropOffExerciseIndex == nil ? "Begin practice" : "Resume practice") {
                running = true
              }.buttonStyle(.borderedProminent)
            }
          }
        }
        Section("Exercises") {
          ForEach(session.exercises) { exercise in
            NavigationLink(value: exercise.id) {
              VStack(alignment: .leading, spacing: 6) {
                Text(exercise.name).font(.headline)
                Text(
                  "\(exercise.sets) sets · \(exercise.reps.map { "\($0) reps" } ?? "\(exercise.durationSec ?? 0) seconds")"
                ).font(.callout.monospaced()).foregroundStyle(.secondary)
              }
            }
          }
        }
        if session.completedAt == nil {
          Section("Adapt this practice") {
            TextField("What should change?", text: $note, axis: .vertical)
            Button("Regenerate session") {
              busy = true
              Task {
                await model.perform {
                  replacementID = try await model.api.call(
                    Endpoints.sessionsRegenerateDailySession,
                    [
                      "sessionDate": .string(session.sessionDate),
                      "regenerationNote": .string(note),
                    ]
                  ).id
                }
                busy = false
              }
            }.disabled(busy || note.count > 500)
          }
        }
      } else {
        ProgressView("Loading session…")
      }
    }.navigationTitle("Practice")
      .task(id: id) {
        while !Task.isCancelled {
          await model.perform {
            session = try await model.api.call(Endpoints.sessionsGetById, ["id": .string(id)])
          }
          if !["pending", "generating"].contains(session?.status ?? "failed") { break }
          do { try await Task.sleep(for: .seconds(2)) } catch { break }
        }
      }
      .navigationDestination(for: String.self) { ExerciseDetailView(id: $0) }
      .navigationDestination(item: $replacementID) { SessionDetailView(id: $0) }
      .sheet(
        isPresented: $running,
        onDismiss: {
          Task {
            await model.perform {
              session = try await model.api.call(Endpoints.sessionsGetById, ["id": .string(id)])
            }
          }
        },
        content: {
          if let session { SessionPlayerView(session: session) }
        }
      )
  }
}

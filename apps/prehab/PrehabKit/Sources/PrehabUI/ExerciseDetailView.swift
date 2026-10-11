import AVKit
import PrehabCore
import SwiftUI

struct ExerciseDetailView: View {
  @Environment(AppModel.self) private var model
  let id: String
  @State private var exercise: ExercisesGetOutput?
  @State private var player: AVPlayer?
  var body: some View {
    ScrollView {
      if let exercise {
        VStack(alignment: .leading, spacing: 20) {
          if let player {
            VideoPlayer(player: player).frame(minHeight: 220).clipShape(.rect(cornerRadius: 16))
          }
          Text(exercise.name).font(.largeTitle.bold())
          Text(exercise.purpose).foregroundStyle(.secondary)
          Text("How to do it").font(.headline)
          Text(exercise.instructions)
          Label(exercise.muscleGroup.displayName, systemImage: "figure.flexibility")
          Text(
            exercise.equipment.isEmpty
              ? "No equipment needed"
              : exercise.equipment.map(\.displayName).joined(separator: ", "))
          if let url = URL(string: "https://www.youtube.com/watch?v=\(exercise.youtubeId)"),
            !exercise.youtubeId.isEmpty
          {
            Link("Watch demonstration", destination: url)
          }
        }.padding(24).frame(maxWidth: 800)
      } else {
        ProgressView()
      }
    }.navigationTitle("Exercise").task {
      await model.perform {
        exercise = try await model.api.call(Endpoints.exercisesGet, ["id": .string(id)])
        if let url = URL(string: exercise?.demoUrl ?? "") { player = AVPlayer(url: url) }
      }
    }.onDisappear { player?.pause() }
  }
}

import AVKit
import PrehabCore
import SwiftUI

struct SessionPlayerView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  let session: SessionsGetByIdOutput
  @State private var runner: SessionRunner
  @State private var busy = false
  @State private var feedback = "good"
  @State private var comment = ""
  @State private var tags: Set<String> = []
  @State private var capacity: [String: Int] = [:]
  @State private var rateCapacity = false
  @State private var player: AVPlayer?
  @State private var saved = false
  init(session: SessionsGetByIdOutput) {
    self.session = session
    _runner = State(
      initialValue: SessionRunner(
        exercises: session.exercises, resumeAfter: session.dropOffExerciseIndex,
        skipped: Set(session.skippedExercises)))
  }
  private var checkpointKey: String {
    "prehab.runner.\(model.server).\(model.user["id"].string ?? "").\(session.id)"
  }
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          if let exercise = runner.current {
            ProgressView(
              value: Double(runner.exerciseIndex), total: Double(session.exercises.count))
            Text("EXERCISE \(runner.exerciseIndex + 1) OF \(session.exercises.count)").font(
              .caption.monospaced()
            ).foregroundStyle(.secondary)
            Text(runner.phase == .rest ? "Breathe. Reset." : exercise.name).font(
              .largeTitle.bold().italic())
            if runner.phase != .rest, let player {
              VideoPlayer(player: player).frame(height: 210).clipShape(.rect(cornerRadius: 16))
            }
            Text(
              "Set \(runner.set) of \(exercise.sets)\(exercise.side == "left_right" ? (runner.isRightSide ? " · Right side" : " · Left side") : "")"
            ).font(.title3.monospaced())
            ForEach(exercise.formCues, id: \.self) { Text("• \($0)") }
            if runner.remaining > 0 {
              Text(Duration.seconds(runner.remaining).formatted(.time(pattern: .minuteSecond)))
                .font(.system(size: 64, weight: .light, design: .monospaced)).contentTransition(
                  .numericText()
                ).accessibilityLabel("\(Int(ceil(runner.remaining))) seconds remaining")
              Button(runner.isPaused ? "Start timer" : "Pause") {
                if runner.isPaused { runner.start() } else { runner.pause() }
                checkpoint()
              }.buttonStyle(.borderedProminent)
            } else if let reps = exercise.reps {
              Text("\(reps) reps").font(.largeTitle.monospaced())
            }
            Button(runner.phase == .rest ? "Finish rest" : "Complete set") {
              advance(skipping: false)
            }.buttonStyle(.borderedProminent).disabled(busy)
            Button("Skip this exercise") { advance(skipping: true) }.disabled(busy)
          } else if saved {
            Label("Practice complete", systemImage: "checkmark.circle.fill").font(
              .largeTitle.bold()
            ).foregroundStyle(PrehabStyle.garden)
            Text("A little care goes a long way.")
            Button("Done") { dismiss() }.buttonStyle(.borderedProminent)
          } else {
            Text(runner.canComplete ? "How do you feel?" : "You listened to your body.").font(
              .largeTitle.bold().italic())
            if !runner.canComplete {
              Text(
                "Your progress is saved. Complete at least 80% of the exercises to finish a session."
              )
              Button("Close practice") { dismiss() }
            } else {
              Picker("How was it?", selection: $feedback) {
                Text("Not great").tag("bad")
                Text("Good").tag("good")
                Text("Amazing").tag("amazing")
              }.pickerStyle(.segmented)
              ForEach(["felt_great", "less_stiff", "too_easy", "too_hard", "pain"], id: \.self) {
                tag in
                Toggle(
                  tag.displayName,
                  isOn: Binding(
                    get: { tags.contains(tag) },
                    set: { if $0 { tags.insert(tag) } else { tags.remove(tag) } }))
              }
              TextField("Anything to share?", text: $comment, axis: .vertical).textFieldStyle(
                .roundedBorder)
              Toggle("Rate your body's capacity", isOn: $rateCapacity)
              if rateCapacity {
                ForEach(["knee", "hip", "shoulder", "back", "wrist", "ankle"], id: \.self) {
                  region in
                  Stepper(
                    "\(region.capitalized): \(capacity[region] ?? 2) / 4",
                    value: Binding(get: { capacity[region] ?? 2 }, set: { capacity[region] = $0 }),
                    in: 0...4)
                }
                Text("How much do you trust each region today?").foregroundStyle(.secondary)
              }
              Button("Finish practice") { finish() }.buttonStyle(.borderedProminent).disabled(
                busy || comment.count > 500)
            }
          }
          if busy { ProgressView("Saving…") }
        }.padding(24).frame(maxWidth: 700)
      }.frame(maxWidth: .infinity).navigationTitle("Your practice").toolbar {
        Button("Save & close") {
          runner.pause()
          checkpoint()
          dismiss()
        }
      }
    }.frame(minWidth: 320, minHeight: 520)
      .task {
        if let data = UserDefaults.standard.data(forKey: checkpointKey),
          let saved = try? JSONDecoder().decode(SessionRunner.self, from: data),
          saved.exercises == session.exercises
        {
          runner = saved
          runner.pause()
        }
        loadVideo()
        while !Task.isCancelled {
          do { try await Task.sleep(for: .milliseconds(200)) } catch { break }
          guard !busy else { continue }
          let old = runner
          runner.tick()
          if old.exerciseIndex != runner.exerciseIndex || old.phase != runner.phase
            || old.set != runner.set || old.isRightSide != runner.isRightSide
          {
            busy = true
            await persistTransition(from: old, skipped: false)
            checkpoint()
            loadVideo()
            busy = false
          }
        }
      }
      .onChange(of: scenePhase) { _, phase in
        if phase != .active {
          runner.pause()
          checkpoint()
          player?.pause()
        }
      }
      .onDisappear {
        player?.pause()
        checkpoint()
      }
  }
  private func loadVideo() {
    player?.pause()
    player = runner.current.flatMap { URL(string: $0.videoUrl) }.map(AVPlayer.init(url:))
  }
  private func checkpoint() {
    if saved {
      UserDefaults.standard.removeObject(forKey: checkpointKey)
    } else if let data = try? JSONEncoder().encode(runner) {
      UserDefaults.standard.set(data, forKey: checkpointKey)
    }
  }
  private func advance(skipping: Bool) {
    let old = runner
    if skipping { runner.skip() } else { runner.advance() }
    busy = true
    Task {
      await persistTransition(from: old, skipped: skipping)
      busy = false
      checkpoint()
      loadVideo()
    }
  }
  private func persistTransition(from old: SessionRunner, skipped: Bool) async {
    guard old.exerciseIndex != runner.exerciseIndex else { return }
    do {
      if skipped {
        _ = try await model.api.call(
          Endpoints.sessionsSkipExercise,
          ["sessionId": .string(session.id), "exerciseIndex": .number(Double(old.exerciseIndex))])
      }
      _ = try await model.api.call(
        Endpoints.sessionsUpdateProgress,
        [
          "sessionId": .string(session.id),
          "dropOffExerciseIndex": .number(Double(old.exerciseIndex)),
        ])
    } catch {
      runner = old
      runner.pause()
      model.error = error.localizedDescription
    }
  }
  private func finish() {
    busy = true
    Task {
      await model.perform {
        if rateCapacity {
          _ = try await model.api.call(
            Endpoints.sessionsLogCapacity,
            [
              "sessionId": .string(session.id),
              "capacityRatingsAfter": .object(
                Dictionary(
                  uniqueKeysWithValues: ["knee", "hip", "shoulder", "back", "wrist", "ankle"].map {
                    ($0, .number(Double(capacity[$0] ?? 2)))
                  })),
            ])
        }
        _ = try await model.api.call(
          Endpoints.sessionsComplete,
          [
            "sessionId": .string(session.id), "feedbackRating": .string(feedback),
            "feedbackTags": .strings(tags.sorted()), "feedbackComment": .string(comment),
          ])
        saved = true
        checkpoint()
      }
      busy = false
    }
  }
}

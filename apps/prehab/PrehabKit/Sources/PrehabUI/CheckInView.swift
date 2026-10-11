import PrehabCore
import SwiftUI

struct CheckInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let date: Date
  @State private var readiness = "normal"
  @State private var note = ""
  @State private var busy = false
  var body: some View {
    NavigationStack {
      Form {
        Section("How ready do you feel?") {
          Picker("Readiness", selection: $readiness) {
            Text("Take it easy").tag("low")
            Text("Ready").tag("normal")
            Text("Feeling great").tag("high")
          }
          TextField("Anything to keep in mind?", text: $note, axis: .vertical).lineLimit(3...6)
        }
        Button("Save check-in") {
          busy = true
          Task {
            await model.perform {
              _ = try await model.api.call(
                Endpoints.checkInSave,
                [
                  "date": .string(LocalDay.string(date)), "readiness": .string(readiness),
                  "note": .string(note),
                ])
              dismiss()
            }
            busy = false
          }
        }.disabled(busy || note.count > 500).buttonStyle(.borderedProminent)
      }.formStyle(.grouped).navigationTitle("Daily check-in").toolbar {
        Button("Cancel") { dismiss() }
      }
      .task {
        await model.perform {
          if let saved = try await model.api.call(
            Endpoints.checkInGet, ["date": .string(LocalDay.string(date))]
          ).checkIn {
            readiness = saved.readiness
            note = saved.note ?? ""
          }
        }
      }
    }.frame(minWidth: 320, minHeight: 340)
  }
}

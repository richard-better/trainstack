#if os(iOS)
  import SwiftUI

  struct HealthImportSection: View {
    @State private var isOn = AppHealthImport.shared.isOn
    @State private var isAsking = false
    @State private var errorMessage: String?

    var body: some View {
      Section {
        Toggle("Import Workouts from Health", isOn: toggle)
          .disabled(isAsking)
      } header: {
        Text("Apple Health")
      } footer: {
        Text(
          isOn
            ? "Ride adds every workout in Health to your Trainstack account, the ones from before too, each a few minutes after it ends. If you turn this off, Ride stops adding them, and the workouts it added stay in your account until you delete them on the Trainstack website."
            : "Ride reads your workouts from Health, with their routes, heart rate, power, cadence, speed and distance, and adds them to your Trainstack account. It never adds the rides it saved to Health itself."
        )
      }
      .alert("Health Not Connected", isPresented: errorShown) {
        Button("OK") {}
      } message: {
        Text(errorMessage ?? "")
      }
    }

    private var toggle: Binding<Bool> {
      Binding(
        get: { isOn },
        set: { turnOn in
          guard turnOn else {
            AppHealthImport.shared.isOn = false
            isOn = false
            return
          }
          Task {
            isAsking = true
            defer { isAsking = false }
            do {
              try await AppHealthImport.workouts.requestAccess()
              AppHealthImport.shared.isOn = true
              isOn = true
            } catch {
              errorMessage = error.localizedDescription
            }
          }
        })
    }

    private var errorShown: Binding<Bool> {
      Binding(
        get: { errorMessage != nil },
        set: { if !$0 { errorMessage = nil } })
    }
  }
#endif

import PrehabCore
import SwiftUI

struct PlanRevealView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var state: PlansGetRevealStateOutput?
  @State private var recap: PlansGetRevealRecapOutput?
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Image("garden", bundle: .module).resizable().scaledToFill().frame(height: 190).clipped()
          .clipShape(.rect(cornerRadius: 20))
        if let plan = state?.plan {
          Text(plan.headline ?? "Your practice is taking shape.").font(.largeTitle.bold().italic())
          Text(plan.subtitle ?? "We’re bringing together your goals, sports, and daily rhythm.")
          ForEach(plan.themes ?? [], id: \.self) { Label($0, systemImage: "leaf") }
          if plan.generationStatus == "pending" { ProgressView("Building your plan…") }
          if plan.generationStatus == "failed" {
            Button("Try again") {
              Task {
                await model.perform {
                  _ = try await model.api.call(
                    Endpoints.plansStartGenerated, ["today": .string(LocalDay.string())])
                }
              }
            }
          }
          if plan.generationStatus == "ready" {
            Button("Let’s begin") {
              Task {
                await model.perform {
                  _ = try await model.api.call(Endpoints.plansMarkRevealSeen)
                  try await model.refreshProfile()
                  dismiss()
                }
              }
            }.buttonStyle(.borderedProminent)
          }
        } else {
          ProgressView("Finding your plan…")
        }
        if let recap {
          PrehabCard {
            VStack(alignment: .leading, spacing: 8) {
              Text("What you told us").font(.headline)
              Text(recap.sports.map(\.displayName).joined(separator: ", "))
              Text(recap.focusAreas.map(\.displayName).joined(separator: ", "))
              if let hours = recap.weeklyHoursLabel { Text(hours) }
            }
          }
        }
      }.padding(24).frame(maxWidth: 650)
    }.navigationTitle("Your plan").toolbar { Button("Close") { dismiss() } }
      .task {
        await model.perform { recap = try await model.api.call(Endpoints.plansGetRevealRecap) }
        while !Task.isCancelled {
          await model.perform {
            state = try await model.api.call(
              Endpoints.plansGetRevealState, ["today": .string(LocalDay.string())])
          }
          if state?.plan?.generationStatus == "ready" { break }
          do { try await Task.sleep(for: .seconds(2)) } catch { break }
        }
      }.frame(minWidth: 320, minHeight: 480)
  }
}

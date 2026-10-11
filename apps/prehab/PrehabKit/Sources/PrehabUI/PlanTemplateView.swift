import PrehabCore
import SwiftUI

struct PlanTemplateView: View {
  @Environment(AppModel.self) private var model
  let plan: PlansListTemplatesOutputTemplatesItem
  @State private var confirm = false
  @State private var started = false
  var body: some View {
    Form {
      Section {
        Text(plan.title).font(.title.bold())
        Text(plan.description)
        Text("\(plan.durationWeeks) weeks · \(plan.sessionsPerWeek) sessions per week")
      }
      Button("Make this my plan") { confirm = true }.buttonStyle(.borderedProminent)
        .confirmationDialog(
          "Replace your current plan? Your history will be kept.", isPresented: $confirm
        ) {
          Button("Start plan") {
            Task {
              await model.perform {
                _ = try await model.api.call(
                  Endpoints.plansStartFromTemplate,
                  ["templateId": .string(plan.id), "today": .string(LocalDay.string())])
                started = true
              }
            }
          }
        }
      if started { Label("Your plan is ready in Today", systemImage: "checkmark.circle") }
    }.formStyle(.grouped).navigationTitle("Plan")
  }
}

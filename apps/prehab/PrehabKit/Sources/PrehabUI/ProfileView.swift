import PrehabCore
import SwiftUI

struct ProfileView: View {
  @Environment(AppModel.self) private var model
  @Environment(Membership.self) private var membership
  @State private var deleting = false
  @State private var edit = false
  @State private var paywall = false
  @State private var reminder = false
  @State private var time = Date.now
  @AppStorage("prehab.analytics") private var analytics = false
  @AppStorage("prehab.appearance") private var appearance = "system"
  var body: some View {
    Form {
      Section {
        Text(model.name).font(.title.bold())
        Text(model.user["email"].string ?? "").foregroundStyle(.secondary)
        Button("Edit training profile") { edit = true }
      }
      Section("Daily practice") {
        DatePicker("Preferred time", selection: $time, displayedComponents: .hourAndMinute)
        Toggle("Daily reminder", isOn: $reminder)
        Button("Save reminder") {
          Task {
            await model.perform {
              let components = Calendar.current.dateComponents([.hour, .minute], from: time)
              let value = String(format: "%02d:%02d", components.hour ?? 18, components.minute ?? 0)
              _ = try await model.api.call(
                Endpoints.sportProfileSetPreferredTime, ["preferredSessionTime": .string(value)])
              if reminder {
                reminder = try await UNReminder.schedule(time: value)
              } else {
                UNReminder.cancel()
              }
              _ = try await model.api.call(
                Endpoints.sportProfileSavePartial,
                [
                  "questionId": .string("notifications"), "version": .number(1),
                  "status": .string("answered"), "value": .object(["optedIn": .bool(reminder)]),
                ])
              try await model.refreshProfile()
            }
          }
        }
      }
      Section("Appearance") {
        Picker("Theme", selection: $appearance) {
          Text("System").tag("system")
          Text("Light").tag("light")
          Text("Dark").tag("dark")
        }
      }
      Section("Privacy") {
        Toggle("Share anonymous usage", isOn: $analytics)
          .onChange(of: analytics) { _, enabled in
            Task { await model.api.setAnalytics(enabled: enabled) }
          }
        Text(
          "Sends feature usage to the configured analytics service. Profiles, conversation text and health details are excluded."
        ).font(.caption).foregroundStyle(.secondary)
      }
      Section("Membership") {
        LabeledContent("Prehab Pro", value: membership.active ? "Active" : "Not subscribed")
        Button("Manage membership") { paywall = true }
      }
      Section("About") {
        Text("TrainStack Prehab supports general fitness and is not a substitute for medical care.")
        if let base = URL(string: "http://localhost:4322") {
          Link("Privacy policy", destination: base.appending(path: "privacy"))
          Link("Terms", destination: base.appending(path: "terms"))
          Link("Health disclaimer", destination: base.appending(path: "health-disclaimer"))
        }
        LabeledContent("Server", value: model.server).textSelection(.enabled)
      }
      Section("Account") {
        Button("Sign out") { Task { await model.perform { try await model.signOut() } } }
        Button("Delete account", role: .destructive) { deleting = true }
          .confirmationDialog(
            "Schedule account deletion? You will be signed out. Signing in within 30 days cancels deletion.",
            isPresented: $deleting
          ) {
            Button("Schedule deletion", role: .destructive) {
              Task {
                await model.perform {
                  _ = try await model.api.call(Endpoints.accountDelete)
                  try model.clearSession()
                }
              }
            }
          }
      }
    }.formStyle(.grouped).navigationTitle("Profile")
      .sheet(isPresented: $edit) {
        NavigationStack {
          OnboardingView(editing: true).toolbar { Button("Close") { edit = false } }
        }.frame(minWidth: 340, minHeight: 550)
      }
      .sheet(isPresented: $paywall) { PaywallView() }
      .task {
        await model.perform {
          let values = try await model.api.call(Endpoints.sportProfileResumePoint).answers
          reminder = values["notifications"]?["optedIn"].bool ?? false
          if let saved = model.profile?.preferredSessionTime {
            let parts = saved.split(separator: ":").compactMap { Int($0) }
            if parts.count >= 2 {
              time =
                Calendar.current.date(
                  bySettingHour: parts[0], minute: parts[1], second: 0, of: .now) ?? .now
            }
          }
        }
      }
  }
}

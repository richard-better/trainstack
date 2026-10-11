import PrehabCore
import SwiftUI

struct OnboardingView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  var editing = false
  @State private var questions: [OnboardingQuestion] = []
  @State private var index = 0
  @State private var answers: [String: JSONValue] = [:]
  @State private var selected: Set<String> = []
  @State private var name = ""
  @State private var birth = Calendar.current.date(byAdding: .year, value: -25, to: .now) ?? .now
  @State private var includeBirth = false
  @State private var gender = "prefer-not-to-say"
  @State private var dailyTime = "10"
  @State private var sportTimes: [String: String] = [:]
  @State private var preferred = Date.now
  @State private var accepted = false
  @State private var adult = false
  @State private var busy = false
  private var question: OnboardingQuestion? {
    questions.indices.contains(index) ? questions[index] : nil
  }
  var body: some View {
    Group {
      if let question {
        Form {
          Section {
            ProgressView(value: Double(index), total: Double(max(questions.count, 1)))
            Text(question.title).font(.title.bold())
          }
          Section {
            switch question.id {
            case "welcome":
              Text("A few questions, a conversation with Coach, and a practice built around you.")
            case "demographics":
              TextField("Name", text: $name)
              Toggle("Include date of birth", isOn: $includeBirth)
              if includeBirth {
                DatePicker(
                  "Date of birth", selection: $birth, in: ...Date.now, displayedComponents: .date)
              }
              Picker("Gender", selection: $gender) {
                ForEach(["male", "female", "other", "prefer-not-to-say"], id: \.self) {
                  Text($0.replacingOccurrences(of: "-", with: " ").capitalized).tag($0)
                }
              }
            case "sport-time":
              ForEach(answers["sports"]?.array.compactMap(\.string) ?? [], id: \.self) { sport in
                Picker(
                  sport.displayName,
                  selection: Binding(
                    get: { sportTimes[sport] ?? "1-3" }, set: { sportTimes[sport] = $0 })
                ) {
                  ForEach(["<1", "1-3", "3-5", "5-10", "10+"], id: \.self) {
                    Text("\($0) hours").tag($0)
                  }
                }
              }
            case "daily-time":
              Picker("Minutes per day", selection: $dailyTime) {
                ForEach(question.choices, id: \.self) { Text("\($0) minutes").tag($0) }
              }
            case "preferred-time":
              DatePicker(
                "Practice time", selection: $preferred, displayedComponents: .hourAndMinute)
            case "notifications":
              Text("A gentle daily reminder at your chosen time. You can change this in Profile.")
            case "disclaimer":
              Text(
                "Prehab supports general fitness. It does not diagnose or treat medical conditions. Stop if an exercise causes pain and seek qualified advice for injuries or concerning symptoms."
              )
              Toggle("I am at least 18 years old", isOn: $adult)
              Toggle("I understand and agree", isOn: $accepted)
            default:
              ForEach(question.choices, id: \.self) { choice in
                Button {
                  if !selected.insert(choice).inserted { selected.remove(choice) }
                } label: {
                  HStack {
                    Text(choice.displayName)
                    Spacer()
                    if selected.contains(choice) { Image(systemName: "checkmark.circle.fill") }
                  }.frame(minHeight: 32)
                }.buttonStyle(.plain)
              }
            }
          }
          Section {
            Button(index == questions.count - 1 ? "Start my practice" : "Continue") {
              save(skipping: false)
            }
            .buttonStyle(.borderedProminent).disabled(busy || !valid)
            if question.skippable { Button("Skip for now") { save(skipping: true) }.disabled(busy) }
            if index > 0 {
              Button("Back") {
                index -= 1
                hydrate()
              }.disabled(busy)
            }
            if busy { ProgressView("Saving…") }
          }
        }.formStyle(.grouped)
      } else {
        ProgressView("Loading your profile…")
      }
    }.navigationTitle(editing ? "Edit profile" : "Your starting point")
      .task {
        await model.perform {
          questions = try OnboardingQuestion.load()
          let resume = try await model.api.call(Endpoints.sportProfileResumePoint)
          answers = resume.answers
          if !editing { index = questions.firstIndex { $0.id == resume.questionId } ?? 0 }
          name = model.name
          hydrate()
        }
      }
  }
  private var valid: Bool {
    switch question?.id {
    case "demographics": !name.trimmingCharacters(in: .whitespaces).isEmpty
    case "goals": !selected.isEmpty
    case "disclaimer": accepted && adult
    default: true
    }
  }
  private func hydrate() {
    guard let question else { return }
    selected = Set(answers[question.id]?.array.compactMap(\.string) ?? [])
    if let v = answers["daily-time"]?.string { dailyTime = v }
    if let v = answers["demographics"]?["name"].string { name = v }
    if let v = answers["demographics"]?["gender"].string { gender = v }
    if let v = answers["demographics"]?["dateOfBirth"].string {
      let formatter = DateFormatter()
      formatter.dateFormat = "yyyy-MM-dd"
      formatter.locale = Locale(identifier: "en_US_POSIX")
      if let date = formatter.date(from: v) {
        birth = date
        includeBirth = true
      }
    }
    if let v = answers["preferred-time"]?.string {
      let parts = v.split(separator: ":").compactMap { Int($0) }
      if parts.count == 2,
        let time = Calendar.current.date(
          bySettingHour: parts[0], minute: parts[1], second: 0, of: .now)
      {
        preferred = time
      }
    }
    sportTimes = answers["sport-time"]?.object.compactMapValues(\.string) ?? [:]
  }
  private func save(skipping: Bool) {
    guard let question else { return }
    busy = true
    Task {
      await model.perform {
        var value: JSONValue = .object([:])
        if !skipping {
          switch question.id {
          case "demographics":
            value = .object([
              "name": .string(name),
              "dateOfBirth": includeBirth ? .string(LocalDay.string(birth)) : .null,
              "gender": .string(gender),
            ])
          case "sport-time":
            value = .object(
              Dictionary(
                uniqueKeysWithValues: (answers["sports"]?.array.compactMap(\.string) ?? []).map {
                  ($0, .string(sportTimes[$0] ?? "1-3"))
                }))
          case "daily-time": value = .string(dailyTime)
          case "preferred-time":
            value = .string(
              preferred.formatted(
                .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(
                  Locale(identifier: "en_GB"))))
          case "notifications":
            value = .object([
              "optedIn": .bool(
                try await UNReminder.schedule(time: answers["preferred-time"]?.string ?? "18:00"))
            ])
          case "welcome", "disclaimer": break
          default: value = .strings(selected.sorted())
          }
        }
        var input: [String: JSONValue] = [
          "questionId": .string(question.id), "version": .number(1),
          "status": .string(skipping ? "skipped" : "answered"),
        ]
        if !skipping { input["value"] = value }
        _ = try await model.api.call(Endpoints.sportProfileSavePartial, input)
        answers[question.id] = value
        if index + 1 < questions.count {
          index += 1
          hydrate()
        } else {
          try await model.refreshProfile()
          if editing { dismiss() }
        }
      }
      busy = false
    }
  }
}

import PrehabCore
import SwiftUI

struct CoachView: View {
  @Environment(AppModel.self) private var model
  @State private var thread: CoachGetThreadOutput?
  @State private var text = ""
  @State private var busy = false
  @State private var pendingID: String?
  @State private var pendingText: String?
  @State private var reveal = false
  var body: some View {
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            Text("A conversation,\nbuilt around you.").font(.largeTitle.bold().italic())
            Text("Coach gathers context for your practice. It does not diagnose injuries.")
              .foregroundStyle(.secondary)
            if let thread {
              ForEach(thread.messages) { message in
                VStack(alignment: .leading, spacing: 8) {
                  Text(message.role == "user" ? "You" : "Coach").font(.caption.bold())
                    .foregroundStyle(PrehabStyle.accent)
                  ForEach(Array(message.parts.enumerated()), id: \.offset) { _, part in
                    if let content = part["text"].string { Text(content).textSelection(.enabled) }
                    if part["type"].string == "tool-flagRedFlag" {
                      Label(
                        "Consider checking these symptoms with a qualified professional.",
                        systemImage: "cross.case"
                      ).foregroundStyle(.secondary)
                    }
                  }
                }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(
                  .background.opacity(0.7), in: .rect(cornerRadius: 18)
                ).id(message.id)
              }
            } else {
              ProgressView("Opening your conversation…")
            }
            if busy { ProgressView("Coach is thinking…") }
          }.padding(24).frame(maxWidth: 780)
        }.onChange(of: thread?.messages.count) {
          if let id = thread?.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) }
        }
      }
      if thread?.thread.status == "pending" {
        HStack(alignment: .bottom) {
          TextField("Tell Coach about your body or training", text: $text, axis: .vertical)
            .textFieldStyle(.roundedBorder).lineLimit(1...5)
          Button("Send", systemImage: "arrow.up") { send() }.labelStyle(.iconOnly).buttonStyle(
            .borderedProminent
          ).disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }.padding()
        HStack {
          Button("Build my plan") { end(skip: false) }.disabled(busy)
          Button("Skip conversation") { end(skip: true) }.disabled(busy)
        }.padding(.bottom)
      } else if thread != nil {
        HStack {
          Button("View my plan") { reveal = true }
          Button("Start a new conversation") { Task { await model.perform { try await start() } } }
        }.padding()
      }
    }.navigationTitle("Coach").task { await model.perform { try await start() } }
      .sheet(isPresented: $reveal) { NavigationStack { PlanRevealView() } }
  }
  private func start() async throws {
    let started = try await model.api.call(Endpoints.coachStartThread)
    thread = try await model.api.call(
      Endpoints.coachGetThread, ["threadId": .string(started.thread.id)])
    if let last = thread?.messages.last, last.role == "user" {
      pendingID = last.id
      pendingText = last.parts.compactMap { $0["text"].string }.joined(separator: "\n")
      text = pendingText ?? ""
    }

  }
  private func send() {
    guard let id = thread?.thread.id else { return }
    if pendingText != text {
      pendingID = UUID().uuidString
      pendingText = text
    }
    let requestID = pendingID ?? UUID().uuidString
    pendingID = requestID
    busy = true
    Task {
      await model.perform {
        try await model.api.sendCoach(threadID: id, messageID: requestID, text: text)
        text = ""
        pendingID = nil
        pendingText = nil
        thread = try await model.api.call(Endpoints.coachGetThread, ["threadId": .string(id)])
        if thread?.thread.status == "completed" {
          _ = try await model.api.call(
            Endpoints.plansStartGenerated, ["today": .string(LocalDay.string())])
          reveal = true
        }
      }
      busy = false
    }
  }
  private func end(skip: Bool) {
    guard let id = thread?.thread.id else { return }
    busy = true
    Task {
      await model.perform {
        if skip {
          _ = try await model.api.call(Endpoints.coachSkipThread, ["threadId": .string(id)])
        } else {
          _ = try await model.api.call(Endpoints.coachEndThread, ["threadId": .string(id)])
        }
        _ = try await model.api.call(
          Endpoints.plansStartGenerated, ["today": .string(LocalDay.string())])
        thread = try await model.api.call(Endpoints.coachGetThread, ["threadId": .string(id)])
        reveal = true
      }
      busy = false
    }
  }
}

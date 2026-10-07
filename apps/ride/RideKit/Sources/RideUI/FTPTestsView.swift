import RideData
import SwiftUI

/// The FTP tests entered for a scope, newest first, with a way to add one.
struct FTPTestsView: View {
  let scope: ZoneScope
  @State private var isAdding = false
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    let tests = store.ftpTests(in: scope).reversed()
    List {
      if tests.isEmpty {
        ContentUnavailableView {
          Label("No FTP Tests", systemImage: "bolt.heart")
        } description: {
          Text("Add a test you did to keep its result and set your FTP from it.")
        } actions: {
          Button("Add Test") { isAdding = true }
        }
      }
      ForEach(tests) { test in
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(test.date.formatted(date: .long, time: .omitted))
            Text(test.kind.name).font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          Text("\(test.ftp) W").monospacedDigit()
        }
        .contextMenu {
          Button("Delete", role: .destructive) { store.removeFTPTest(test.id) }
        }
        .swipeActions {
          Button("Delete", role: .destructive) { store.removeFTPTest(test.id) }
        }
      }
    }
    .navigationTitle(scope == .all ? "FTP Tests" : "\(scope.title) FTP Tests")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("Add Test", systemImage: "plus") { isAdding = true }
      }
    }
    .sheet(isPresented: $isAdding) {
      AddFTPTestView(scope: scope)
    }
  }
}

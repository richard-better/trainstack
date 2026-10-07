import RideData
import SwiftUI

/// A form for a test's date, kind and result.
struct AddFTPTestView: View {
  let scope: ZoneScope
  @State private var date = Date.now
  @State private var kind = FTPTest.Kind.ramp
  @State private var ftp: Int?
  @State private var updatesFTP = true
  @Environment(RiderSettingsStore.self) private var store
  @Environment(\.dismiss) private var dismiss

  private var isValid: Bool { ftp.map(Threshold.ftp.range.contains) ?? false }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          DatePicker("Date", selection: $date, in: ...Date.now, displayedComponents: .date)
          Picker("Test", selection: $kind) {
            ForEach(FTPTest.Kind.allCases, id: \.self) { Text($0.name).tag($0) }
          }
          LabeledContent("FTP") {
            HStack(spacing: 6) {
              TextField("FTP", value: $ftp, format: .number.grouping(.never), prompt: Text("Watts"))
                .labelsHidden()
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 80)
                #if os(iOS)
                  .keyboardType(.numberPad)
                #endif
              Text("W").foregroundStyle(.secondary)
            }
          }
        } footer: {
          Text(
            "Enter the FTP your test gave. A ramp test usually takes 75% of your best minute, and a 20-minute test 95% of its average."
          )
        }
        Section {
          Toggle("Set my FTP from this test", isOn: $updatesFTP)
        } footer: {
          Text(
            scope == .all
              ? "Your zones use this FTP from the day of the test until your next FTP change."
              : "Your \(scope.title) zones use this FTP from the day of the test until your next FTP change."
          )
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Add FTP Test")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", action: cancel)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Add", action: add)
            .disabled(!isValid)
        }
      }
    }
    #if os(macOS)
      // A sheet on macOS is only as big as its content asks for.
      .frame(minWidth: 420, minHeight: 360)
    #endif
  }

  private func add() {
    if let ftp {
      store.add(FTPTest(date: date, kind: kind, ftp: ftp, scope: scope), updatesFTP: updatesFTP)
    }
    dismiss()
  }

  private func cancel() { dismiss() }
}

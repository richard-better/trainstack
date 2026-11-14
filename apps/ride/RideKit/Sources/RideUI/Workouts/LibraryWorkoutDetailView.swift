import RideBluetooth
import RideData
import RideStrava
import SwiftUI

struct LibraryWorkoutDetailView: View {
  let id: LibraryWorkout.ID
  @Environment(AccountWorkouts.self) private var accountWorkouts
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(RideLauncher.self) private var launcher
  @Environment(\.dismiss) private var dismiss
  @State private var isShowingDevices = false
  @State private var isConfirmingDelete = false

  var body: some View {
    if let workout = accountWorkouts[id] {
      details(of: workout)
    } else {
      ContentUnavailableView(
        "Workout Deleted", systemImage: "trash",
        description: Text("This workout is no longer in your TrainStack library."))
    }
  }

  private func details(of workout: LibraryWorkout) -> some View {
    let ftp = settings.ftp
    return List {
      if let planned = workout.planned {
        Section {
          WorkoutDetailChart(
            duration: planned.duration, summary: workout.summary(ftp: ftp), ftp: ftp
          ) {
            PlannedWorkoutProfile(workout: planned, ftp: ftp)
          }
          .padding(.vertical, 6)
        } header: {
          if let zone = workout.zone { ZoneLabel(zone: zone) }
        }
      }
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Text(workout.summary(ftp: ftp))
            .font(.subheadline.weight(.semibold))
            .monospacedDigit()
          if let why = workout.whyItCannotBeRidden {
            Label(why, systemImage: "exclamationmark.circle")
              .font(.subheadline)
              .foregroundStyle(.orange)
          }
          if let description = workout.description {
            Text(description)
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(.horizontal, 4)
      }
      if let steps = workout.workout {
        Section {
          LibraryWorkoutSteps(workout: steps, ftp: ftp)
        } header: {
          Text(ftp.map { "Steps · at your FTP of \($0) W" } ?? "Steps")
        } footer: {
          if ftp == nil, workout.planned != nil {
            Text("Add your FTP in Settings to see each step in watts and ride the workout.")
          }
        }
      }
    }
    #if os(iOS)
      .listStyle(.insetGrouped)
      .listSectionSpacing(.compact)
      .toolbarVisibility(.hidden, for: .tabBar)
      .navigationBarTitleDisplayMode(.large)
    #endif
    #if os(macOS)
      .frame(maxWidth: Design.ridePageWidth)
      .frame(maxWidth: .infinity)
    #endif
    .navigationTitle(workout.name)
    .toolbar {
      ToolbarItem(placement: .destructiveAction) {
        Button("Delete Workout", systemImage: "trash", role: .destructive) {
          isConfirmingDelete = true
        }
        .help("Delete this workout from your TrainStack library")
      }
    }
    .confirmationDialog(
      "Delete \(workout.name)?", isPresented: $isConfirmingDelete, titleVisibility: .visible
    ) {
      Button("Delete Workout", role: .destructive) {
        accountWorkouts.delete(workout.id)
        dismiss()
      }
    } message: {
      Text("It is deleted from your TrainStack library on every device, and cannot come back.")
    }
    .safeAreaBar(edge: .bottom) {
      #if os(macOS)
        if launcher.ride == nil { startBar(workout) }
      #else
        startBar(workout)
      #endif
    }
    .sheet(isPresented: $isShowingDevices) { DevicesSheet() }
  }

  private func startBar(_ workout: LibraryWorkout) -> some View {
    GlassEffectContainer {
      HStack(spacing: 10) {
        DeviceStatusButton(action: showDevices)
          .buttonStyle(.plain)
          .font(.title3)
          .padding(.horizontal, 18)
          .frame(minHeight: 54)
          .glassEffect(.regular.interactive(), in: .capsule)
        StartButton(workout: workout.planned, title: "Start ride", fillsWidth: true)
          .buttonStyle(.glassProminent)
          .controlSize(.extraLarge)
          .font(.headline)
      }
    }
    #if os(macOS)
      .frame(maxWidth: 560)
    #endif
    .padding(.horizontal, 16)
    .padding(.bottom, 8)
  }

  private func showDevices() { isShowingDevices = true }
}

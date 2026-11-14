import RideBluetooth
import RideData
import RideStrava
import SwiftUI

struct PlannedItemDetailView: View {
  let id: PlannedItem.ID
  @Environment(AccountCalendar.self) private var calendar
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(RideLauncher.self) private var launcher
  @State private var isShowingDevices = false

  var body: some View {
    if let item = calendar[id] {
      details(of: item)
    } else {
      ContentUnavailableView(
        "No Longer Planned", systemImage: "calendar.badge.minus",
        description: Text(
          "This was deleted from your TrainStack calendar, or moved out of the weeks Ride keeps."))
    }
  }

  private func details(of item: PlannedItem) -> some View {
    let ftp = settings.ftp
    return List {
      if let planned = item.playable {
        Section {
          WorkoutDetailChart(duration: planned.duration, summary: item.summary, ftp: ftp) {
            PlannedWorkoutProfile(workout: planned, ftp: ftp)
          }
          .padding(.vertical, 6)
        }
      }
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Text(dayName(item))
            .font(.subheadline)
            .foregroundStyle(.secondary)
          Text(item.summary)
            .font(.subheadline.weight(.semibold))
            .monospacedDigit()
          PlannedItemStateLabel(item: item)
            .font(.subheadline)
          if item.state != .completed, let why = item.whyItCannotBeRidden {
            Label(why, systemImage: "exclamationmark.circle")
              .font(.subheadline)
              .foregroundStyle(.orange)
          }
          if let notes = item.notes {
            Text(notes).font(.subheadline)
          }
          if let description = item.workout?.description {
            Text(description)
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(.horizontal, 4)
      }
      if let workout = item.workout {
        Section {
          LibraryWorkoutSteps(workout: workout, ftp: ftp)
        } header: {
          Text(ftp.map { "Steps · at your FTP of \($0) W" } ?? "Steps")
        } footer: {
          if ftp == nil, item.playable != nil {
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
    .navigationTitle(item.title)
    .safeAreaBar(edge: .bottom) {
      if item.canStart {
        #if os(macOS)
          if launcher.ride == nil { startBar(item) }
        #else
          startBar(item)
        #endif
      }
    }
    .sheet(isPresented: $isShowingDevices) { DevicesSheet() }
  }

  private func dayName(_ item: PlannedItem) -> String {
    guard let today = calendar.today else { return item.day.text }
    let name = TodayDayName.of(item.day, today: today)
    return abs(today.days(until: item.day)) <= 1
      ? "\(name), \(item.day.displayDate.formatted(.dateTime.weekday(.wide).day().month(.wide)))"
      : name
  }

  private func startBar(_ item: PlannedItem) -> some View {
    GlassEffectContainer {
      HStack(spacing: 10) {
        DeviceStatusButton(action: showDevices)
          .buttonStyle(.plain)
          .font(.title3)
          .padding(.horizontal, 18)
          .frame(minHeight: 54)
          .glassEffect(.regular.interactive(), in: .capsule)
        StartButton(workout: item.playable, title: "Start ride", fillsWidth: true)
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

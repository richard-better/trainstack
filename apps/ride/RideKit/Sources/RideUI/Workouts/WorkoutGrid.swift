import RideData
import RideStrava
import SwiftUI

struct WorkoutGrid: View {
  @Binding var state: WorkoutsState
  let shelves: [WorkoutShelf]
  let shown: [WorkoutTemplate]
  @Environment(\.openWorkout) private var openWorkout
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    ScrollView {
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: 230), spacing: 14, alignment: .top)],
        alignment: .leading,
        spacing: 14
      ) {
        ForEach(shelves) { shelf in
          Section {
            ForEach(shelf.workouts) { workout in
              card(for: workout, on: shelf)
            }
          } header: {
            header(shelf.title)
          }
        }
        Section {
          ForEach(shown) { template in
            WorkoutCard(
              template: template, isSelected: state.selection == .builtin(template.id),
              select: { state.selection = .builtin(template.id) },
              open: { openWorkout(template) },
              start: start(template.planned))
          }
        } header: {
          if !shelves.isEmpty { header("TrainStack Workouts") }
        }
      }
      .padding(Design.wideContentMargin)
    }
  }

  private func card(for workout: LibraryWorkout, on shelf: WorkoutShelf) -> some View {
    let ftp = settings.ftp
    return WorkoutCard(
      name: workout.name, summary: workout.summary(ftp: ftp),
      color: workout.zone?.color ?? .secondary, warning: workout.whyItCannotBeRidden,
      isSelected: state.selection == .library(workout.id),
      select: { state.selection = .library(workout.id) },
      open: { openWorkout(LibraryWorkoutRoute(id: workout.id)) },
      start: workout.planned.flatMap(start)
    ) {
      LibraryWorkoutThumbnail(workout: workout, ftp: ftp)
    }
    .id("\(shelf.id)-\(workout.id)")
  }

  private func header(_ title: String) -> some View {
    Text(title)
      .font(.title3.weight(.semibold))
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.top, 8)
  }

  private func start(_ workout: PlannedWorkout) -> (() -> Void)? {
    settings.ftp.map { ftp in
      {
        launcher.start(
          workout, ftp: ftp, heartRateZones: settings.heartRateZones,
          riderWeight: settings.weight)
      }
    }
  }
}

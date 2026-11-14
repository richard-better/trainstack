import RideData
import SwiftUI

struct OpenWorkoutAction {
  private let handler: (WorkoutTemplate) -> Void
  private let libraryHandler: (LibraryWorkoutRoute) -> Void
  private let plannedHandler: (PlannedItemRoute) -> Void

  init(
    _ handler: @escaping (WorkoutTemplate) -> Void,
    library libraryHandler: @escaping (LibraryWorkoutRoute) -> Void = { _ in },
    planned plannedHandler: @escaping (PlannedItemRoute) -> Void = { _ in }
  ) {
    self.handler = handler
    self.libraryHandler = libraryHandler
    self.plannedHandler = plannedHandler
  }

  func callAsFunction(_ template: WorkoutTemplate) {
    handler(template)
  }

  func callAsFunction(_ route: LibraryWorkoutRoute) {
    libraryHandler(route)
  }

  func callAsFunction(_ route: PlannedItemRoute) {
    plannedHandler(route)
  }
}

extension EnvironmentValues {
  @Entry var openWorkout = OpenWorkoutAction { _ in }
}

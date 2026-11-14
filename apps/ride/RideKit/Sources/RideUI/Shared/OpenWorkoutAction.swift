import RideData
import SwiftUI

struct OpenWorkoutAction {
  private let handler: (WorkoutTemplate) -> Void
  private let libraryHandler: (LibraryWorkoutRoute) -> Void

  init(
    _ handler: @escaping (WorkoutTemplate) -> Void,
    library libraryHandler: @escaping (LibraryWorkoutRoute) -> Void = { _ in }
  ) {
    self.handler = handler
    self.libraryHandler = libraryHandler
  }

  func callAsFunction(_ template: WorkoutTemplate) {
    handler(template)
  }

  func callAsFunction(_ route: LibraryWorkoutRoute) {
    libraryHandler(route)
  }
}

extension EnvironmentValues {
  @Entry var openWorkout = OpenWorkoutAction { _ in }
}

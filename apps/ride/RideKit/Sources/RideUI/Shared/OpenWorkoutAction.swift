import RideData
import SwiftUI

/// Opens a workout's page on top of the screen showing it. Call it like a function, as with
/// SwiftUI's `OpenURLAction`.
struct OpenWorkoutAction {
  private let handler: (WorkoutTemplate) -> Void

  init(_ handler: @escaping (WorkoutTemplate) -> Void) {
    self.handler = handler
  }

  func callAsFunction(_ template: WorkoutTemplate) {
    handler(template)
  }
}

extension EnvironmentValues {
  @Entry var openWorkout = OpenWorkoutAction { _ in }
}

import RideData
import SwiftUI

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

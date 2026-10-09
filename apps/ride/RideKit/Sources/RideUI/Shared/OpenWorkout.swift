import RideData
import SwiftUI

extension EnvironmentValues {
  /// Opens a workout's page on top of the screen showing it.
  @Entry var openWorkout: (WorkoutTemplate) -> Void = { _ in }
}

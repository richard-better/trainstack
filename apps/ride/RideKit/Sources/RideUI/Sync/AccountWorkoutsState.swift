import Foundation
import RideStrava

struct AccountWorkoutsState: Equatable, Codable {
  let account: String
  var workouts: [String: LibraryWorkout] = [:]
  var lists: [String: LibraryWorkoutList] = [:]
  var workoutCursor: String?
  var listCursor: String?
  var copiesToSend: [PendingWorkoutCopy] = []
  var deletionsToSend: Set<String> = []
  var deleted: Set<String> = []

  init(account: String) {
    self.account = account
  }
}

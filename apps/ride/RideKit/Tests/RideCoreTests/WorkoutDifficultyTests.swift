import Foundation
import RideData
import Testing

@testable import RideCore

struct WorkoutDifficultyTests {
  private static let ftp = 250
  private static let riders = RiderPhysiology.population(ftp: ftp)

  private static func shareFinishing(_ template: WorkoutTemplate) -> Double {
    let finishing = riders.count {
      HeadlessRide(template, ftp: ftp).run(with: SimulatedRider($0)).finishedWithoutCracking
    }
    return Double(finishing) / Double(riders.count)
  }

  private static let steadyCategories: Set<PowerZone> = [.recovery, .endurance, .tempo, .threshold]

  @Test(arguments: WorkoutTemplate.library.filter { steadyCategories.contains($0.category) })
  func everyRiderSetToTheirFTPFinishesASteadyWorkout(_ template: WorkoutTemplate) {
    #expect(Self.shareFinishing(template) == 1)
  }

  @Test(arguments: WorkoutTemplate.library.filter { $0.category == .vo2Max })
  func mostRidersFinishAVO2MaxWorkout(_ template: WorkoutTemplate) {
    #expect(Self.shareFinishing(template) >= 0.6)
  }

  @Test(arguments: WorkoutTemplate.library.filter { $0.category == .anaerobic })
  func anAllOutWorkoutBreaksRidersOnlyInItsHardestEfforts(_ template: WorkoutTemplate) {
    let hardest = template.steps.map(\.intensity).max()
    for physiology in Self.riders {
      let outcome = HeadlessRide(template, ftp: Self.ftp).run(with: SimulatedRider(physiology))
      let crackedIn = outcome.rider.crackedIntervals.map { template.steps[$0].intensity }
      #expect(crackedIn.allSatisfy { $0 == hardest })
    }
  }
}

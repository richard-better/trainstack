import Foundation
import RideData
import Testing

@testable import RideUI

struct RideMonthTests {
  @Test func groupsRidesByMonthNewestFirstKeepingTheirOrder() throws {
    let recording = try RideRecording.sample()
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
    func ride(_ month: Int, _ day: Int) throws -> Ride {
      var recording = recording
      recording.startDate = try #require(
        calendar.date(from: DateComponents(year: 2026, month: month, day: day)))
      return Ride(recording: recording, fileData: Data())
    }
    let rides = [try ride(9, 20), try ride(9, 3), try ride(8, 31)]
    let months = RideMonth.grouping(rides, calendar: calendar)
    #expect(months.map(\.rides.count) == [2, 1])
    #expect(months[0].rides.map(\.id) == [rides[0].id, rides[1].id])
    #expect(months.map { calendar.component(.month, from: $0.start) } == [9, 8])
  }
}

import Foundation
import RideData
import Testing

@testable import RideUI

struct RideMonthTests {
  @Test func groupsRidesByMonthNewestFirstKeepingTheirOrder() throws {
    let recording = try RideRecording.sample()
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try #require(TimeZone(identifier: "UTC"))
    func ride(_ month: Int, _ day: Int) throws -> HistoryEntry {
      var recording = recording
      recording.startDate = try #require(
        calendar.date(from: DateComponents(year: 2026, month: month, day: day)))
      let data = Data("\(month)-\(day)".utf8)
      let ride = Ride(recording: recording, fileData: data)
      return HistoryEntry(id: ride.id, ride: ride, activity: nil)
    }
    let entries = [try ride(9, 20), try ride(9, 3), try ride(8, 31)]
    let months = RideMonth.grouping(entries, calendar: calendar)
    #expect(months.map(\.entries.count) == [2, 1])
    #expect(months[0].entries.map(\.id) == [entries[0].id, entries[1].id])
    #expect(months.map { calendar.component(.month, from: $0.start) } == [9, 8])
  }
}

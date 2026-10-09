import Foundation
import Testing

@testable import RideUI

struct PaceFormatTests {
  @Test(arguments: ["4:05", "4.05", " 4:05 ", "245"])
  func parsesMinutesAndSecondsWithAnySeparatorOrPlainSeconds(_ text: String) throws {
    #expect(try PaceFormat().parseStrategy.parse(text) == 245)
  }

  @Test(arguments: ["4:60", "4:05:00", "", "fast", "4:"])
  func rejectsWhatIsNotAPace(_ text: String) {
    #expect(throws: (any Error).self) { try PaceFormat().parseStrategy.parse(text) }
  }

  @Test func readsBackWhatItFormats() throws {
    let format = PaceFormat()
    for seconds in [5, 65, 245, 3725] {
      #expect(try format.parseStrategy.parse(format.format(seconds)) == seconds)
    }
  }

  @Test(arguments: ["\(Int.max):00", "\(Int.max / 60):\(Int.max % 60 + 1)"])
  func rejectsPacesThatOverflowSeconds(_ text: String) {
    #expect(throws: CocoaError(.formatting)) { try PaceFormat().parseStrategy.parse(text) }
  }
}

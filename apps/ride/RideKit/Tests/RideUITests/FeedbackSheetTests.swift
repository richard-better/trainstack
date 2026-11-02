import Testing

@testable import RideUI

struct FeedbackSheetTests {
  @Test func trimsFeedbackToTheServersLimitCountedInUTF16() {
    let limit = FeedbackSheet.serverLimitInUTF16Units
    let trimmed = FeedbackSheet.trimmedToServerLimit(String(repeating: "a", count: limit + 10))
    #expect(trimmed.utf16.count == limit)
  }

  @Test func trimsWithoutSplittingACharacter() {
    let limit = FeedbackSheet.serverLimitInUTF16Units
    let text = String(repeating: "a", count: limit - 1) + "🚴"
    #expect(FeedbackSheet.trimmedToServerLimit(text) == String(repeating: "a", count: limit - 1))
  }
}

import Testing

@testable import RideUI

struct TodaySuggestionTests {
  @Test func suggestsOneWorkoutOfEachKindFittedToTheTime() {
    let suggestions = TodaySuggestion.suggestions(minutes: 45, shuffle: 0)
    #expect(suggestions.map(\.kindOfDay) == ["Fun pick", "Easy day", "Short and sharp"])
    #expect(suggestions.allSatisfy { abs($0.template.duration - 45 * 60) < 60 })
  }

  @Test func shufflingMovesEveryKindOnAndComesBackAround() {
    let first = TodaySuggestion.suggestions(minutes: 30, shuffle: 0).map(\.template.name)
    let next = TodaySuggestion.suggestions(minutes: 30, shuffle: 1).map(\.template.name)
    #expect(zip(first, next).allSatisfy { $0 != $1 })
    let shufflesUntilEveryKindLinesUpAgain = 6
    #expect(
      TodaySuggestion.suggestions(minutes: 30, shuffle: shufflesUntilEveryKindLinesUpAgain)
        .map(\.template.name) == first)
  }
}

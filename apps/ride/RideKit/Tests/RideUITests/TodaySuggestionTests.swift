import Testing

@testable import RideUI

struct TodaySuggestionTests {
  @Test func suggestsOneWorkoutOfEachKindFittedToTheTime() {
    let suggestions = TodaySuggestion.suggestions(minutes: 45, shuffle: 0)
    #expect(suggestions.map(\.tag) == ["Fun pick", "Easy day", "Short and sharp"])
    #expect(suggestions.allSatisfy { abs($0.template.duration - 45 * 60) < 60 })
  }

  @Test func shufflingMovesEveryKindOnAndComesBackAround() {
    let first = TodaySuggestion.suggestions(minutes: 30, shuffle: 0).map(\.template.name)
    let next = TodaySuggestion.suggestions(minutes: 30, shuffle: 1).map(\.template.name)
    #expect(zip(first, next).allSatisfy { $0 != $1 })
    // Kinds rotate through 3, 2 and 3 workouts, so all line up again after 6 shuffles.
    #expect(TodaySuggestion.suggestions(minutes: 30, shuffle: 6).map(\.template.name) == first)
  }
}

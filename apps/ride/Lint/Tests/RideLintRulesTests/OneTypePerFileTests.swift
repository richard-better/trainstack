import Testing

@testable import RideLintRules

struct OneTypePerFileTests {
  @Test func flagsEachTypeAfterTheFirst() {
    let source = """
      struct Ride {}
      enum Mode {}
      protocol Store {}
      """
    let found = violations(of: OneTypePerFile(), in: source)
    #expect(lines(found) == [2, 3])
    #expect(found.first?.message.contains("Mode.swift") == true)
  }

  @Test func allowsNestedTypesExtensionsAndPrivateHelpers() {
    let source = """
      struct Ride {
        enum Mode {}
      }
      extension Int {}
      private struct Helper {}
      fileprivate enum Key {}
      """
    #expect(violations(of: OneTypePerFile(), in: source).isEmpty)
  }
}

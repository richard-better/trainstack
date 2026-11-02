import Testing

@testable import RideLintRules

struct NoCommentsTests {
  @Test func flagsEveryKindOfComment() {
    let source = """
      /// Documentation.
      struct Ride {
        // A line comment.
        let power: Int  // A trailing comment.
        /* A block comment. */
        /** A documentation block. */
        let cadence: Int
      }
      """
    #expect(lines(violations(of: NoComments(), in: source)) == [1, 3, 4, 5, 6])
  }

  @Test func reportsTheColumnOfATrailingComment() {
    let found = violations(of: NoComments(), in: "let power = 1  // watts\n")
    #expect(found.map(\.column) == [16])
  }

  @Test func allowsToolDirectives() {
    let source = """
      // swift-tools-version: 6.2
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let x = 1
      """
    #expect(violations(of: NoComments(), in: source).isEmpty)
  }

  @Test func ignoresCommentMarkersInsideStrings() {
    #expect(violations(of: NoComments(), in: #"let url = "https://example.com""#).isEmpty)
  }
}

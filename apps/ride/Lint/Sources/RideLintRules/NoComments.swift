import SwiftSyntax

public struct NoComments: Rule {
  public static let name = "no-comments"

  static let toolDirectives = ["// swift-tools-version:", "// swift-format-ignore"]

  public func check(_ file: LintedFile) -> [Violation] {
    file.tree.tokens(viewMode: .sourceAccurate).flatMap { token in
      comments(in: token.leadingTrivia, from: token.position)
        + comments(in: token.trailingTrivia, from: token.endPositionBeforeTrailingTrivia)
    }
    .map {
      file.violation(
        self, at: $0,
        "Comments are not allowed. Say it with a name, a type or a test instead.")
    }
  }

  private func comments(in trivia: Trivia, from start: AbsolutePosition) -> [AbsolutePosition] {
    var position = start
    var found: [AbsolutePosition] = []
    for piece in trivia {
      if let text = Self.commentText(piece), !Self.isToolDirective(text) { found.append(position) }
      position += piece.sourceLength
    }
    return found
  }

  private static func commentText(_ piece: TriviaPiece) -> String? {
    switch piece {
    case .lineComment(let text), .blockComment(let text), .docLineComment(let text),
      .docBlockComment(let text):
      text
    default: nil
    }
  }

  private static func isToolDirective(_ text: String) -> Bool {
    toolDirectives.contains { text.hasPrefix($0) }
  }
}

import Testing

@testable import RideLintRules

struct NoGeometryReaderTests {
  @Test func flagsGeometryReader() {
    let source = """
      var body: some View {
        GeometryReader { proxy in Color.red.frame(width: proxy.size.width) }
      }
      """
    #expect(lines(violations(of: NoGeometryReader(), in: source)) == [2])
  }

  @Test func allowsGeometryChangeObservers() {
    let source =
      "let view = Color.red.onGeometryChange(for: CGFloat.self) { $0.size.width } action: { _ in }"
    #expect(violations(of: NoGeometryReader(), in: source).isEmpty)
  }
}

import Testing

@testable import RideLintRules

struct EntryHoldsNoClosureTests {
  @Test func flagsClosureTypesAndClosureValues() {
    let source = """
      extension EnvironmentValues {
        @Entry var openWorkout: (WorkoutTemplate) -> Void = { _ in }
        @Entry var onEnd: (@MainActor () -> Void)?
        @Entry var refresh = { }
      }
      """
    #expect(lines(violations(of: EntryHoldsNoClosure(), in: source)) == [2, 3, 4])
  }

  @Test func allowsActionStructs() {
    let source = """
      extension EnvironmentValues {
        @Entry var openWorkout = OpenWorkoutAction { _ in }
        @Entry var sendFeedback: SendFeedbackAction?
      }
      """
    #expect(violations(of: EntryHoldsNoClosure(), in: source).isEmpty)
  }

  @Test func ignoresClosuresWithoutEntry() {
    #expect(violations(of: EntryHoldsNoClosure(), in: "var onTick: (() -> Void)?").isEmpty)
  }
}

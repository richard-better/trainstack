public enum PlannedWriteResult: Equatable, Sendable {
  case stored(PlannedItem)
  case deletedOnTheServer
  case refused(code: String)
}

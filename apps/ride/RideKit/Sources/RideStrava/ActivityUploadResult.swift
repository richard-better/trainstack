public enum ActivityUploadResult: Equatable, Sendable {
  case stored
  case deletedOnTheServer
  case refused
}

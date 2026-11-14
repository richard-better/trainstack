import Foundation

public struct ActivityFile: Equatable, Sendable {
  public var data: Data
  public var fileName: String
  public var source: String
  public var sourceID: String?
  public var sport: String?
  public var name: String?
  public var startedAt: Date?

  public init(
    data: Data, fileName: String, source: String, sourceID: String? = nil, sport: String? = nil,
    name: String? = nil, startedAt: Date? = nil
  ) {
    self.data = data
    self.fileName = fileName
    self.source = source
    self.sourceID = sourceID
    self.sport = sport
    self.name = name
    self.startedAt = startedAt
  }
}

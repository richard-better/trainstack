import Foundation

public struct PlannedCompliance: Hashable, Codable, Sendable {
  public enum Rating: String, Hashable, Codable, Sendable {
    case onTarget = "on_target"
    case partly
    case offTarget = "off_target"
  }

  public struct Part: Hashable, Codable, Sendable {
    public var planned: Double
    public var done: Double
    public var ratio: Double
    public var score: Double

    public init(planned: Double, done: Double, ratio: Double, score: Double) {
      self.planned = planned
      self.done = done
      self.ratio = ratio
      self.score = score
    }
  }

  public struct Intervals: Hashable, Codable, Sendable {
    public var secondsWithData: Double
    public var secondsInTarget: Double
    public var share: Double?
    public var score: Double?

    public init(secondsWithData: Double, secondsInTarget: Double, share: Double?, score: Double?) {
      self.secondsWithData = secondsWithData
      self.secondsInTarget = secondsInTarget
      self.share = share
      self.score = score
    }
  }

  public struct Parts: Hashable, Codable, Sendable {
    public var duration: Part?
    public var distance: Part?
    public var load: Part?
    public var intervals: Intervals?

    public init(
      duration: Part? = nil, distance: Part? = nil, load: Part? = nil, intervals: Intervals? = nil
    ) {
      self.duration = duration
      self.distance = distance
      self.load = load
      self.intervals = intervals
    }
  }

  public var score: Double?
  public var rating: Rating?
  public var parts: Parts
  public var pending: Bool

  public init(score: Double?, rating: Rating?, parts: Parts, pending: Bool = false) {
    self.score = score
    self.rating = rating
    self.parts = parts
    self.pending = pending
  }

  private enum CodingKeys: String, CodingKey {
    case score, rating, parts, pending
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    score = try container.decodeIfPresent(Double.self, forKey: .score)
    rating = try? container.decodeIfPresent(Rating.self, forKey: .rating)
    parts = try container.decode(Parts.self, forKey: .parts)
    pending = try container.decodeIfPresent(Bool.self, forKey: .pending) ?? false
  }
}

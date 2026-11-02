import Foundation
import RideData

public struct InterruptedRide: Sendable {
  public let trace: RideTrace
  public let engine: RideEngine

  public init?(trace: RideTrace) {
    let engine = trace.replay()
    guard !engine.session.samples.isEmpty else { return nil }
    self.trace = trace
    self.engine = engine
  }

  public var name: String { trace.name }

  public var session: RideSession { engine.session }
}

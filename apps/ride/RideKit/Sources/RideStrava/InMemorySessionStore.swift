import Foundation

public final class InMemorySessionStore: SessionStore, @unchecked Sendable {
  private let lock = NSLock()
  private var session: AccountSession?

  public init(_ session: AccountSession? = nil) {
    self.session = session
  }

  public func load() async -> AccountSession? { lock.withLock { session } }

  public func save(_ session: AccountSession?) { lock.withLock { self.session = session } }
}

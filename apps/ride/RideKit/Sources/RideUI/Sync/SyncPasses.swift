import Foundation
import RideStrava
import os

final class SyncPasses {
  private let what: String
  private let log: Logger
  private let pass: () async throws -> Void
  private var running: Task<Void, Never>?
  private var generation = 0
  private var wantsAnotherPass = false
  private var retry: Task<Void, Never>?
  private var failuresInARow = 0
  var onSignedOut: (() -> Void)?

  init(of what: String, log: Logger, pass: @escaping () async throws -> Void) {
    self.what = what
    self.log = log
    self.pass = pass
  }

  func restart() {
    running?.cancel()
    running = nil
    retry?.cancel()
    retry = nil
    failuresInARow = 0
    soon()
  }

  func soon() {
    wantsAnotherPass = true
    guard running == nil else { return }
    retry?.cancel()
    retry = nil
    generation += 1
    let generation = generation
    running = Task {
      await passUntilSettled()
      if self.generation == generation { running = nil }
    }
  }

  func passAgain() {
    wantsAnotherPass = true
  }

  private func passUntilSettled() async {
    while wantsAnotherPass, !Task.isCancelled {
      wantsAnotherPass = false
      do {
        try await pass()
        failuresInARow = 0
      } catch is CancellationError {
        return
      } catch StravaError.signedOut {
        onSignedOut?()
        return
      } catch {
        failuresInARow += 1
        log.error("\(self.what) not synced with TrainStack: \(error.localizedDescription)")
        retryLater()
        return
      }
    }
  }

  private func retryLater() {
    let delay = Self.retryDelay(afterFailures: failuresInARow)
    retry = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      self?.soon()
    }
  }

  static func retryDelay(afterFailures failures: Int) -> Duration {
    .seconds(min(30 << min(max(failures - 1, 0), 6), 30 * 60))
  }
}

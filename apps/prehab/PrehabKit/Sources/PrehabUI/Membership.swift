import Foundation
import Observation
import StoreKit

@Observable
final class Membership {
  var active = false
  var ready = false
  func refresh() async {
    var found = false
    for await result in Transaction.currentEntitlements {
      if case .verified(let transaction) = result,
        ["com.trainstack.prehab.pro.monthly", "com.trainstack.prehab.pro.yearly"].contains(
          transaction.productID),
        transaction.revocationDate == nil, (transaction.expirationDate ?? .distantFuture) > .now
      {
        found = true
      }
    }
    active = found
    ready = true
  }
  func watch() async {
    await refresh()
    for await result in Transaction.updates {
      guard !Task.isCancelled else { return }
      if case .verified(let transaction) = result {
        await transaction.finish()
        await refresh()
      }
    }
  }
}

import StoreKit
import SwiftUI

struct PaywallView: View {
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      SubscriptionStoreView(productIDs: [
        "com.trainstack.prehab.pro.monthly", "com.trainstack.prehab.pro.yearly",
      ]) {
        VStack(spacing: 12) {
          Image(systemName: "sun.max.fill").font(.largeTitle).foregroundStyle(PrehabStyle.accent)
          Text("A practice that grows with you.").font(.title.bold().italic())
          Text("Personalized plans, guided sessions, and your ongoing Coach.")
            .multilineTextAlignment(.center)
        }.padding()
      }.storeButton(.visible, for: .restorePurchases).subscriptionStoreControlStyle(
        .prominentPicker
      )
      .navigationTitle("Prehab Pro").toolbar { Button("Close") { dismiss() } }
    }.frame(minWidth: 340, minHeight: 550)
  }
}

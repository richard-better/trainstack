import SwiftUI

public struct PrehabRootView: View {
  @State private var model = AppModel()
  @State private var membership = Membership()
  @AppStorage("prehab.appearance") private var appearance = "system"
  @Environment(\.colorScheme) private var scheme
  public init() {}
  private var requiresMembership: Bool {
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-prehab-local") { return false }
    #endif
    return membership.ready && !membership.active && model.profile?.planRevealSeenAt != nil
  }
  public var body: some View {
    Group {
      if model.loading {
        ProgressView("Opening Prehab…")
      } else if !model.signedIn {
        SignInView()
      } else if !model.onboarded {
        NavigationStack { OnboardingView() }
      } else if requiresMembership {
        PaywallView()
      } else {
        MainNavigation()
      }
    }
    .environment(model)
    .environment(membership)
    .preferredColorScheme(appearance == "light" ? .light : appearance == "dark" ? .dark : nil)
    .task { await membership.watch() }
    .tint(PrehabStyle.accent)
    .background(PrehabStyle.background(scheme))
    .task { await model.restore() }
    .alert(
      "Something needs attention",
      isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
    ) {
      Button("OK") { model.error = nil }
    } message: {
      Text(model.error ?? "")
    }
  }
}

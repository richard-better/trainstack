import SwiftUI

/// Sign in with Apple for builds that go through Apple's web flow, drawn as Apple's guidelines
/// draw the native button: the Apple logo and "Sign in with Apple", black on a light background
/// and white on a dark one.
struct WebSignInWithAppleButton: View {
  var isWorking = false
  var action: () -> Void
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if isWorking {
          ProgressView().controlSize(.small).tint(foreground)
        } else {
          Image(systemName: "apple.logo")
        }
        Text("Sign in with Apple")
      }
      // Apple sizes the title at 43% of the button's height.
      .font(.system(size: 19, weight: .medium))
      .foregroundStyle(foreground)
      .frame(maxWidth: .infinity, minHeight: 44)
      .background(background, in: .rect(cornerRadius: 6))
      .contentShape(.rect(cornerRadius: 6))
    }
    .buttonStyle(.plain)
    .disabled(isWorking)
    .accessibilityLabel("Sign in with Apple")
  }

  private var foreground: Color { colorScheme == .dark ? .black : .white }
  private var background: Color { colorScheme == .dark ? .white : .black }
}

#Preview {
  VStack {
    WebSignInWithAppleButton {}
    WebSignInWithAppleButton(isWorking: true) {}
  }
  .padding()
  .frame(width: 400)
}

import SwiftUI

struct WebSignInWithAppleButton: View {
  private static let titleSizeAt43PercentOfTheButtonHeight: CGFloat = 19
  private static let buttonHeight: CGFloat = 44

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
      .font(.system(size: Self.titleSizeAt43PercentOfTheButtonHeight, weight: .medium))
      .foregroundStyle(foreground)
      .frame(maxWidth: .infinity, minHeight: Self.buttonHeight)
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

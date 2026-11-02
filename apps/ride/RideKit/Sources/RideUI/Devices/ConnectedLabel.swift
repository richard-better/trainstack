import SwiftUI

struct ConnectedLabel: View {
  var body: some View {
    HStack(spacing: 5) {
      Circle().fill(.green).frame(width: 7, height: 7)
      Text("Connected")
    }
    .font(.subheadline.weight(.semibold))
    .foregroundStyle(.secondary)
  }
}

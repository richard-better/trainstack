import RideData
import SwiftUI

/// A workout's profile at full width, with a dashed line at FTP and the time along the bottom.
struct WorkoutDetailChart: View {
  let template: WorkoutTemplate
  let ftp: Int?
  @ScaledMetric private var height = 110.0

  var body: some View {
    VStack(spacing: 6) {
      WorkoutProfile(template: template)
        .frame(height: height)
        .overlay(alignment: .bottomTrailing) { ftpLine }
        .overlay(alignment: .bottom) { Rectangle().fill(.separator).frame(height: 1) }
      HStack {
        ForEach(0..<5) { quarter in
          if quarter > 0 { Spacer() }
          Text((template.duration * Double(quarter) / 4).clockString)
        }
      }
      .font(.caption2)
      .foregroundStyle(.secondary)
      .monospacedDigit()
      .accessibilityHidden(true)
    }
    .accessibilityElement()
    .accessibilityLabel("Workout profile")
    .accessibilityValue(template.summary)
  }

  /// The line sits at FTP's share of the profile's height.
  private var ftpLine: some View {
    // The label sits just above the line, at the trailing end.
    ZStack(alignment: .bottomTrailing) {
      Line()
        .stroke(.tertiary, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        .frame(height: 1)
      Text(ftp.map { "FTP \($0) W" } ?? "FTP")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.bottom, 3)
    }
    .padding(.bottom, height / WorkoutProfile.ceiling)
  }
}

/// A horizontal line across the middle of its frame.
private nonisolated struct Line: Shape {
  func path(in rect: CGRect) -> Path {
    Path { path in
      path.move(to: CGPoint(x: rect.minX, y: rect.midY))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
    }
  }
}

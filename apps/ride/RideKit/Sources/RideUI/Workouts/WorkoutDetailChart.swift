import RideData
import SwiftUI

struct WorkoutDetailChart<Profile: View>: View {
  let duration: TimeInterval
  let summary: String
  let ftp: Int?
  @ViewBuilder let profile: Profile
  @ScaledMetric private var height = 110.0

  var body: some View {
    VStack(spacing: 6) {
      profile
        .frame(height: height)
        .overlay(alignment: .bottomTrailing) { ftpLine }
        .overlay(alignment: .bottom) { Rectangle().fill(.separator).frame(height: 1) }
      HStack {
        ForEach(0..<5) { quarter in
          if quarter > 0 { Spacer() }
          Text((duration * Double(quarter) / 4).clockString)
        }
      }
      .font(.caption2)
      .foregroundStyle(.secondary)
      .monospacedDigit()
      .accessibilityHidden(true)
    }
    .accessibilityElement()
    .accessibilityLabel("Workout profile")
    .accessibilityValue(summary)
  }

  private var ftpLine: some View {
    ZStack(alignment: .bottomTrailing) {
      Line()
        .stroke(.tertiary, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        .frame(height: 1)
      Text(ftp.map { "FTP \($0) W" } ?? "FTP")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.secondary)
        .padding(.bottom, 3)
    }
    .padding(.bottom, height / WorkoutProfile.fullHeightIntensity)
  }
}

extension WorkoutDetailChart where Profile == WorkoutProfile {
  init(template: WorkoutTemplate, ftp: Int?) {
    self.init(duration: template.duration, summary: template.summary, ftp: ftp) {
      WorkoutProfile(template: template)
    }
  }
}

private nonisolated struct Line: Shape {
  func path(in rect: CGRect) -> Path {
    Path { path in
      path.move(to: CGPoint(x: rect.minX, y: rect.midY))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
    }
  }
}

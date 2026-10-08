import RideData
import RideStyle
import SwiftUI

/// The steps of a workout as bars: width for duration, height and colour for intensity.
struct WorkoutProfile: View {
  let template: WorkoutTemplate
  /// The intensity that fills the full height. Harder steps are cut off.
  static let ceiling = 1.75

  var body: some View {
    Canvas { context, size in
      let total = max(template.duration, 1)
      let gap = 1.0
      let width = size.width - gap * Double(max(template.steps.count - 1, 0))
      var x = 0.0
      for step in template.steps {
        let stepWidth = max(width * step.duration / total, 0.5)
        let height = size.height * min(step.intensity / Self.ceiling, 1)
        let bar = CGRect(x: x, y: size.height - height, width: stepWidth, height: height)
        let shape = UnevenRoundedRectangle(topLeadingRadius: 2, topTrailingRadius: 2)
        context.fill(shape.path(in: bar), with: .color(step.zone.color))
        x += stepWidth + gap
      }
    }
    .accessibilityHidden(true)
  }
}

import SwiftUI

/// Sizes and styles shared across the app's screens, so they look like one app.
enum Design {
  /// The margin either side of a scrolling page.
  static let pageMargin = 32.0
  /// The margin above and below a scrolling page.
  static let pageVerticalMargin = 24.0
  /// The margin either side of the player and the workout library, which use more of the
  /// width for the chart and cards.
  static let wideContentMargin = 24.0
  /// The widest a page's content grows. Beyond it the page leaves space at the side.
  static let pageWidth = 1100.0
  /// The widest a ride's page grows, narrower than others so its chart stays easy to follow.
  static let ridePageWidth = 900.0
  /// Numbers in rows of stats, a touch heavier than the text around them.
  static let statValueFont = Font.title2.weight(.medium)
}

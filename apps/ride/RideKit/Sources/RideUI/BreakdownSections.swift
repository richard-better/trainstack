import RideData
import SwiftUI

/// Where the time went: recent time in zone beside the year's intensity when there is room,
/// otherwise one above the other.
struct BreakdownSections: View {
  let rides: [RideRecording]

  var body: some View {
    let timeInZone = TimeInZoneSection(rides: rides)
    let intensity = IntensitySection(rides: rides)
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: 32) {
        timeInZone.frame(minWidth: 320)
        intensity.frame(minWidth: 320)
      }
      VStack(alignment: .leading, spacing: 22) {
        timeInZone
        intensity
      }
    }
  }
}

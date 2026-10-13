import RideData
import SwiftUI

/// A page of Settings.
enum SettingsPage: Hashable {
  case zones(ZoneScope)
  /// Reached from a zones page rather than the sidebar.
  case ftpTests(ZoneScope)
  case rider
  case player
  case devices
  case account
}

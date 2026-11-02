import RideData
import SwiftUI

enum SettingsPage: Hashable {
  case zones(ZoneScope)
  case ftpTests(ZoneScope)
  case rider
  case player
  case devices
  case account
}

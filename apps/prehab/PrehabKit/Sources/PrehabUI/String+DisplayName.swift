import Foundation

extension String {
  var displayName: String {
    replacingOccurrences(of: "-", with: " ").replacingOccurrences(of: "_", with: " ").capitalized
  }
}

import Foundation

func isolatedDefaults() -> UserDefaults {
  let suite = "RideBluetoothTests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defaults.removePersistentDomain(forName: suite)
  return defaults
}

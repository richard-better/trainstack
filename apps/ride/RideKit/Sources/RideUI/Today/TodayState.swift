/// What the rider has chosen on the Today page. Held above the tabs, so it survives Settings
/// taking over the sidebar.
struct TodayState: Equatable {
  /// How many times the suggestions have been shuffled.
  var shuffle = 0
  /// The index of the selected suggestion.
  var selection = 0
}

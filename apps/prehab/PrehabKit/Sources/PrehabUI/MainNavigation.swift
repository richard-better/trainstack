import SwiftUI

struct MainNavigation: View {
  @State private var selection: AppSection? = .today
  var body: some View {
    #if os(macOS)
      NavigationSplitView {
        List(AppSection.allCases, selection: $selection) { section in
          Label(section.rawValue, systemImage: section.symbol).tag(section)
        }
        .navigationTitle("Prehab")
        .navigationSplitViewColumnWidth(min: 180, ideal: 210)
      } detail: {
        NavigationStack { destination(selection ?? .today) }
      }
    #else
      TabView {
        ForEach(AppSection.allCases) { section in
          Tab(section.rawValue, systemImage: section.symbol) {
            NavigationStack { destination(section) }
          }
        }
      }
    #endif
  }
  @ViewBuilder private func destination(_ section: AppSection) -> some View {
    switch section {
    case .today: TodayView()
    case .explore: ExploreView()
    case .coach: CoachView()
    case .progress: ProgressScreen()
    case .profile: ProfileView()
    }
  }
}

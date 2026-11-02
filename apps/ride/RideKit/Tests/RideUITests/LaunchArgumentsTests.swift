import Foundation
import Testing

@testable import RideUI

struct LaunchArgumentsTests {
  #if DEBUG
    @Test func aDebugLaunchWithAServerAndSessionIsSignedInWithThatSession() async {
      let account = TrainStackAccount.launchAccount(arguments: [
        "Ride", "-trainstack-server", "http://localhost:8787", "-trainstack-session", "token",
      ])
      await account.restore()
      #expect(account.isSignedIn)
    }
  #endif
}

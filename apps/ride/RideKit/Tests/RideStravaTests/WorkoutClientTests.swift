import Foundation
import RideData
import Testing

@testable import RideStrava

struct WorkoutClientTests {
  private let account = ActivityAccount(id: "user-1", token: "session-token")

  private func identifiedClient(_ replies: [Reply]) -> (TrainStackClient, ScriptedTransport) {
    let transport = ScriptedTransport(replies)
    let store = InMemorySessionStore(
      AccountSession(token: "session-token", name: "Ada Rider", userID: "user-1"))
    return (
      TrainStackClient(
        server: URL(string: "https://api.example.com")!, store: store, transport: transport),
      transport
    )
  }

  private let stored = """
    {"id":"6f1c2b7e-3a51-4f0e-9d1a-0c2e7b6a5d41","name":"Ramps","sport":"cycling","focus":"threshold",\
    "description":"Up and down","author":null,"tags":[],"totals":{"seconds":600,"meters":0},\
    "origin":{"kind":"builtin","id":"zone-3-3x10"},"createdAt":"2026-11-13T09:00:00.000Z",\
    "updatedAt":"2026-11-13T09:00:00.123Z","workout":{"name":"Ramps","sport":"cycling",\
    "focus":"threshold","description":"Up and down","steps":[{"type":"step",\
    "duration":{"type":"time","seconds":600},"target":{"type":"power","unit":"ftp",\
    "level":{"kind":"ramp","from":0.5,"to":0.9}}}]}}
    """

  @Test func readsTheWorkoutsWrittenAndDeletedAfterACursor() async throws {
    let (client, transport) = identifiedClient([
      json(
        #"{"workouts":[\#(stored)],"deleted":[{"id":"gone","deletedAt":"2026-11-13T10:00:00.000Z"}],"cursor":"12"}"#
      )
    ])
    let changes = try await client.workoutChanges(since: "4", for: account)
    #expect(changes.cursor == "12")
    #expect(changes.deleted == ["gone"])
    let workout = try #require(changes.workouts.first)
    #expect(workout.id == "6f1c2b7e-3a51-4f0e-9d1a-0c2e7b6a5d41")
    #expect(workout.name == "Ramps")
    #expect(workout.focus == "threshold")
    #expect(workout.copiedFromBuiltin == "zone-3-3x10")
    #expect(workout.updatedAt == Date(timeIntervalSince1970: 1_794_560_400.123))
    #expect(
      workout.rideability?.planned?.steps
        == [PlannedStep(duration: 600, target: .shareOfFTP(.ramp(from: 0.5, to: 0.9)))])
    let request = try #require(await transport.requests.first)
    #expect(request.url?.path == "/api-reference/workouts/changes")
    #expect(request.url?.query == "since=4")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
  }

  @Test func keepsAWorkoutItCannotReadToReadItWhenRideKnowsMore() async throws {
    let (client, _) = identifiedClient([
      json(
        #"{"workouts":[{"id":"w","name":"Future","sport":"rowing","updatedAt":"2026-11-13T09:00:00Z","workout":{"name":"Future","sport":"rowing","steps":"in a shape from later"}}],"deleted":[],"cursor":"1"}"#
      )
    ])
    let workout = try #require(
      try await client.workoutChanges(since: nil, for: account).workouts.first)
    #expect(workout.sport == "rowing")
    #expect(workout.rideability == nil)
  }

  @Test func readsTheListsInTheAthletesOrder() async throws {
    let (client, transport) = identifiedClient([
      json(
        #"{"lists":[{"id":"l","name":"Base","workoutIds":["b","a"],"createdAt":"2026-11-13T09:00:00.000Z","updatedAt":"2026-11-13T09:00:00.000Z"}],"deleted":[{"id":"old","deletedAt":"2026-11-13T09:00:00.000Z"}],"cursor":"3"}"#
      )
    ])
    let changes = try await client.workoutListChanges(since: nil, for: account)
    #expect(changes.lists.map(\.workoutIDs) == [["b", "a"]])
    #expect(changes.deleted == ["old"])
    #expect(await transport.requests.first?.url?.path == "/api-reference/workout-lists/changes")
    #expect(await transport.requests.first?.url?.query == nil)
  }

  @Test func copiesABuiltInUnderTheIdTheDeviceChose() async throws {
    let (client, transport) = identifiedClient([json(stored)])
    let result = try await client.copyBuiltinWorkout(
      "zone-3-3x10", as: "6f1c2b7e-3a51-4f0e-9d1a-0c2e7b6a5d41",
      updatedAt: Date(timeIntervalSince1970: 1_794_560_400.123), for: account)
    guard case .stored(let workout) = result else {
      Issue.record("Not stored: \(result)")
      return
    }
    #expect(workout.name == "Ramps")
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.path == "/api-reference/builtin-workouts/zone-3-3x10/copy")
    let sent = try body(of: request)
    #expect(sent["as"] as? String == "6f1c2b7e-3a51-4f0e-9d1a-0c2e7b6a5d41")
    #expect(sent["updatedAt"] as? String == "2026-11-13T09:00:00.123Z")
  }

  @Test func hearsThatACopyWasDeletedOrRefused() async throws {
    let (client, _) = identifiedClient([
      json(#"{"code":"WORKOUT_DELETED"}"#, status: 410),
      json(#"{"code":"NOT_FOUND"}"#, status: 404),
    ])
    let deleted = try await client.copyBuiltinWorkout(
      "x", as: "id", updatedAt: .now, for: account)
    #expect(deleted == .deletedOnTheServer)
    let refused = try await client.copyBuiltinWorkout(
      "x", as: "id", updatedAt: .now, for: account)
    #expect(refused == .refused(reason: #"{"code":"NOT_FOUND"}"#))
  }

  @Test func deletesAWorkoutAndSignsOutWhenTheSessionIsGone() async throws {
    let (client, transport) = identifiedClient([
      json(#"{"id":"w","deletedAt":"2026-11-13T09:00:00.000Z"}"#), json("{}", status: 401),
    ])
    try await client.deleteWorkout("w", for: account)
    #expect(await transport.requests.first?.httpMethod == "DELETE")
    #expect(await transport.requests.first?.url?.path == "/api-reference/workouts/w")
    await #expect(throws: StravaError.signedOut) {
      try await client.deleteWorkout("w", for: account)
    }
    #expect(await client.isSignedIn == false)
  }
}

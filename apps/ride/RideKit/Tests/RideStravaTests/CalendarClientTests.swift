import Foundation
import RideData
import Testing

@testable import RideStrava

struct CalendarClientTests {
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

  private let range = """
    {"today":"2026-11-11","analysesDue":1,"weeks":[{"start":"2026-11-09","totals":\
    {"planned":{"seconds":3600,"meters":0,"load":73},"completed":{"seconds":4200,"meters":54189.58,"load":81}}}],\
    "days":[{"day":"2026-11-10","planned":[{"id":"9e10ca2e-f4a5-4a61-9b95-d9bf05ccb3d6","day":"2026-11-10",\
    "position":0,"content":{"kind":"workout","workout":{"name":"Threshold classic 60","sport":"cycling",\
    "focus":"threshold","steps":[{"type":"step","duration":{"type":"time","seconds":600},"target":\
    {"type":"power","unit":"ftp","level":{"kind":"constant","value":0.95}}}]},"source":{"kind":"builtin",\
    "id":"threshold-classic-60"},"notes":null},"planId":null,"planned":{"seconds":3600,"meters":null,"load":73},\
    "skipped":null,"state":"completed","pairing":{"activityId":"06f0","by":"auto"},"compliance":{"score":76,\
    "rating":"partly","parts":{"duration":{"planned":3600,"done":4200,"ratio":1.1666,"score":1},"distance":null,\
    "load":{"planned":73,"done":81,"ratio":1.1096,"score":1},"intervals":{"secondsWithData":3600,\
    "secondsInTarget":979,"share":0.2719,"score":0.2719,"alignedBy":"time","steps":null}},"pending":false},\
    "createdAt":"2026-11-14T05:26:23.824Z","updatedAt":"2026-11-14T05:25:23.892Z"}],"activities":[{"id":"06f0",\
    "sport":"cycling","indoor":true,"name":"Threshold intervals","startedAt":"2026-11-10T17:30:00.000Z",\
    "seconds":4200,"meters":54189.58,"load":81,"route":null,"analysisDue":false,\
    "plannedId":"9e10ca2e-f4a5-4a61-9b95-d9bf05ccb3d6"}],"totals":{"planned":{"seconds":3600,"meters":0,\
    "load":73},"completed":{"seconds":4200,"meters":54189.58,"load":81}}},{"day":"2026-11-11","planned":[\
    {"id":"a","day":"2026-11-11","position":0,"content":{"kind":"note","title":"Travel to Vienna",\
    "notes":"Train at 7:10"},"planId":null,"planned":null,"skipped":null,"state":"planned","pairing":null,\
    "compliance":null,"createdAt":"2026-11-14T05:26:23.824Z","updatedAt":"2026-11-14T05:25:23.892Z"},\
    {"id":"b","day":"2026-11-11","position":1,"content":{"kind":"rest","notes":null},"planId":null,\
    "planned":null,"skipped":{"reason":"Work ran late"},"state":"skipped","pairing":null,"compliance":null,\
    "createdAt":"2026-11-14T05:26:23.824Z","updatedAt":"2026-11-14T05:25:23.892Z"},{"id":"c",\
    "day":"2026-11-11","position":2,"content":{"kind":"strength","sets":[]},"planId":null,"planned":null,\
    "skipped":null,"state":"later","pairing":null,"compliance":null,"createdAt":"2026-11-14T05:26:23.824Z",\
    "updatedAt":"2026-11-14T05:25:23.892Z"}],"activities":[],"totals":{"planned":{"seconds":0,"meters":0,\
    "load":0},"completed":{"seconds":0,"meters":0,"load":0}}}]}
    """

  @Test func readsTheDaysOfARangeWithTheirPlanActivitiesAndTotals() async throws {
    let (client, transport) = identifiedClient([json(range)])
    let read = try await client.calendar(
      from: SettingDay("2026-11-10")!, through: SettingDay("2026-11-11")!, for: account)
    #expect(read.today == SettingDay("2026-11-11"))
    #expect(read.analysesDue == 1)
    #expect(read.weeks.map(\.start) == [SettingDay("2026-11-09")!])
    #expect(read.weeks.first?.totals.completed.load == 81)
    let workout = try #require(read.days.first?.planned.first)
    #expect(workout.state == .completed)
    #expect(workout.pairing == .init(activityId: "06f0", by: .auto))
    #expect(workout.planned == .init(seconds: 3600, meters: nil, load: 73))
    #expect(workout.workout?.name == "Threshold classic 60")
    #expect(
      workout.rideability?.planned?.steps == [
        PlannedStep(duration: 600, target: .shareOfFTP(.constant(0.95)))
      ])
    #expect(workout.compliance?.score == 76)
    #expect(workout.compliance?.rating == .partly)
    #expect(workout.compliance?.parts.intervals?.share == 0.2719)
    #expect(workout.compliance?.parts.distance == nil)
    #expect(workout.updatedAt == Date(timeIntervalSince1970: 1_794_633_923.892))
    let activity = try #require(read.days.first?.activities.first)
    #expect(activity.plannedId == workout.id)
    #expect(activity.startedAt == Date(timeIntervalSince1970: 1_794_331_800))
    let others = try #require(read.days.last?.planned)
    #expect(
      others.map(\.content) == [
        .note(title: "Travel to Vienna", notes: "Train at 7:10"), .rest(notes: nil),
        .unknown(kind: "strength"),
      ])
    #expect(others[1].skipped?.reason == "Work ran late")
    #expect(others[2].state == .planned)
    let request = try #require(await transport.requests.first)
    #expect(request.url?.path == "/api-reference/calendar")
    #expect(request.url?.query == "from=2026-11-10&through=2026-11-11")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
  }

  @Test func aSessionLoggedWithoutAFileReadsAsAnActivityOfItsDay() async throws {
    let (client, _) = identifiedClient([
      json(
        #"{"today":"2026-11-14","analysesDue":0,"weeks":[],"days":[{"day":"2026-11-14","planned":[],"activities":[{"id":"\#(String(repeating: "b", count: 64))","sport":"bouldering","indoor":null,"name":"Board session","startedAt":"2026-11-14T17:00:00.000Z","seconds":5400,"meters":null,"load":62,"route":null,"analysisDue":false,"plannedId":null,"file":null,"source":"logbook","logged":{"rpe":7,"problems":[{"grade":"6B","sent":true}]}}],"totals":{"planned":{"seconds":0,"meters":0,"load":0},"completed":{"seconds":5400,"meters":0,"load":62}}}]}"#
      )
    ])
    let read = try await client.calendar(
      from: SettingDay("2026-11-14")!, through: SettingDay("2026-11-14")!, for: account)
    let session = try #require(read.days.first?.activities.first)
    #expect(session.sport == "bouldering")
    #expect(session.indoor == nil)
    #expect(session.seconds == 5400)
    #expect(session.load == 62)
  }

  @Test func aRangeKeptOnTheDeviceReadsBackTheSame() async throws {
    let (client, _) = identifiedClient([json(range)])
    let read = try await client.calendar(
      from: SettingDay("2026-11-10")!, through: SettingDay("2026-11-11")!, for: account)
    let kept = try JSONDecoder().decode(CalendarRange.self, from: JSONEncoder().encode(read))
    #expect(kept == read)
  }

  @Test func readsOnlyTheCursorAndHowManyChangedFromTheChangesFeed() async throws {
    let (client, transport) = identifiedClient([
      json(
        #"{"planned":[{"id":"a"},{"id":"b"}],"deleted":[{"id":"c","deletedAt":"2026-11-14T05:25:23.892Z"}],"cursor":"9"}"#
      )
    ])
    let changes = try await client.plannedChanges(since: "4", for: account)
    #expect(changes == PlannedChanges(changed: 3, cursor: "9"))
    let request = try #require(await transport.requests.first)
    #expect(request.url?.path == "/api-reference/planned-workouts/changes")
    #expect(request.url?.query == "since=4")
  }

  @Test func readsTheAthletesTimeZoneAndNoneUntilOneIsSet() async throws {
    let (client, transport) = identifiedClient([
      json(#"{"day":null,"timeZone":"Europe/Budapest","defaults":{}}"#),
      json(#"{"day":null,"timeZone":null,"defaults":{}}"#),
    ])
    #expect(
      try await client.athleteTimeZone(for: account) == TimeZone(identifier: "Europe/Budapest"))
    #expect(try await client.athleteTimeZone(for: account) == nil)
    #expect(await transport.requests.first?.url?.path == "/api-reference/settings")
  }

  @Test func aRejectedSessionSignsOut() async throws {
    let (client, _) = identifiedClient([json("{}", status: 401)])
    await #expect(throws: StravaError.signedOut) {
      try await client.plannedChanges(since: nil, for: account)
    }
    #expect(await client.isSignedIn == false)
  }
}

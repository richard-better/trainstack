import Foundation
import RideData
import RideLink
import Testing

@testable import RideBluetooth
@testable import RideUI

struct RideControllerTests {
  private let template = WorkoutTemplate.named("Recovery 30")!

  @Test(.timeLimit(.minutes(1)))
  func releasingTheControllerCancelsItsClock() async throws {
    var controller: RideController? = RideController(template: template, ftp: 200, simulated: true)
    weak let released = controller
    let clock = try #require(controller?.start())
    controller = nil
    #expect(released == nil)
    await clock.value
    #expect(clock.isCancelled)
  }

  @Test(.timeLimit(.minutes(1)))
  func stoppingTheClockDoesNotRecordAnotherSampleOrReclaimTheTrainer() async throws {
    let (devices, transport, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: true)
    let (ticks, continuation) = AsyncStream.makeStream(
      of: Void.self, bufferingPolicy: .bufferingNewest(1))
    controller.onTick = { continuation.yield(()) }
    let clock = controller.start()
    defer {
      controller.stop()
      continuation.finish()
    }
    transport.onTrainerControlReady?(trainer.id)
    for _ in 0..<3 {
      let opCode = try #require(transport.trainerWrites.last?.first)
      transport.onTrainerValue?(trainer.id, .controlPoint, Data([0x80, opCode, 0x01]))
    }
    var iterator = ticks.makeAsyncIterator()
    await iterator.next()
    controller.stop()
    #expect(transport.trainerWrites.last == FitnessMachineCommand.reset.data)
    transport.onTrainerValue?(
      trainer.id, .controlPoint, Data([0x80, FitnessMachineCommand.reset.opCode, 0x01]))
    let samples = controller.session.samples
    let trainerWrites = transport.trainerWrites
    await clock.value
    #expect(controller.session.samples == samples)
    #expect(transport.trainerWrites == trainerWrites)
  }

  @Test(.timeLimit(.minutes(1)))
  func trainerMeasurementsMoveTheRideOnWhenTheClockIsNotRunning() {
    let (devices, transport, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    controller.start()
    defer { controller.stop() }
    let start = ContinuousClock.now
    controller.tickIfDue(at: start + .milliseconds(500))
    #expect(controller.session.samples.isEmpty)
    controller.tickIfDue(at: start + .seconds(3))
    #expect(controller.session.samples.count == 1)
    #expect(abs(controller.session.elapsed - 3) < 0.1)

    // The measurement is what calls it, but too soon after the last tick it does nothing.
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 180, 0, 250, 0]))
    #expect(controller.session.samples.count == 1)
  }

  @Test func stopsListeningForTrainerMeasurementsWhenTheRideStops() {
    let (devices, _, _) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    controller.start()
    #expect(devices.onCyclingActivity != nil)
    controller.stop()
    #expect(devices.onCyclingActivity == nil)
  }

  @Test func pausesWhenTheTrainerDropsAndWaitsForTheRiderToResume() {
    let (devices, transport, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    controller.tick(seconds: 1)
    #expect(controller.trainerNotice == nil)
    #expect(controller.session.samples.count == 1)

    transport.onDisconnect?(trainer.id)
    controller.tick(seconds: 1)
    #expect(controller.session.isPaused)
    #expect(controller.pausedForTrainer)
    #expect(controller.session.samples.count == 1)
    #expect(controller.trainerNotice == "KICKR disconnected, so the ride is paused. Reconnecting…")

    transport.onConnect?(trainer.id)
    controller.tick(seconds: 1)
    #expect(controller.session.isPaused)
    #expect(controller.trainerNotice == "KICKR is back. Resume when you are ready.")

    controller.togglePause()
    controller.tick(seconds: 1)
    #expect(!controller.session.isPaused)
    #expect(!controller.pausedForTrainer)
    #expect(controller.trainerNotice == nil)
    #expect(controller.session.samples.count == 2)
  }

  @Test func doesNotPauseAgainWhenResumedBeforeTheTrainerIsBack() {
    let (devices, transport, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    controller.tick(seconds: 1)
    transport.onDisconnect?(trainer.id)
    controller.tick(seconds: 1)
    controller.togglePause()
    controller.tick(seconds: 1)
    controller.tick(seconds: 1)
    #expect(!controller.session.isPaused)
    #expect(controller.trainerNotice == "KICKR is not connected. Reconnecting…")
    #expect(controller.session.samples.count == 3)
  }

  @Test func leavesARideWithoutAConnectedTrainerRunning() {
    let controller = RideController(template: template, ftp: 200, simulated: true)
    controller.tick(seconds: 1)
    #expect(controller.trainerNotice == nil)
    #expect(!controller.session.isPaused)

    let transport = CyclingTestTransport()
    let devices = BluetoothDevices(
      transport: transport, defaults: UserDefaults(suiteName: "RideControllerTests.\(UUID())")!)
    devices.pair(DiscoveredDevice(id: UUID(), name: "KICKR", services: [.trainer]))
    let waiting = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    waiting.tick(seconds: 1)
    #expect(!waiting.session.isPaused)
    #expect(waiting.trainerNotice == "KICKR is not connected. Reconnecting…")
  }

  @Test func takesHeartRateFromARealSensorOverTheSimulator() {
    let feed = HeartRateFeed()
    let controller = RideController(
      template: template, ftp: 200, heartRate: feed, simulated: true)
    let now = Date.now
    controller.tick(seconds: 1, at: now)
    #expect(controller.session.latest.heartRateSource == .simulated)
    feed.record(152, from: .watch, at: now)
    controller.tick(seconds: 1, at: now)
    #expect(controller.session.latest.heartRate == 152)
    #expect(controller.session.latest.heartRateSource == .watch)
    feed.record(154, from: .chestStrap, at: now)
    controller.tick(seconds: 1, at: now)
    #expect(controller.session.latest.heartRate == 154)
    #expect(controller.session.latest.heartRateSource == .chestStrap)
  }

  @Test func placesHeartRateInTheRidersZones() throws {
    // Percent of a 186 bpm max: zone 2 ends at 129 and zone 3 starts at 130.
    let zones = try #require(RiderSettingsStore.sample.heartRateZones)
    let feed = HeartRateFeed()
    let controller = RideController(
      template: template, ftp: 200, heartRateZones: zones, heartRate: feed, simulated: false)
    let now = Date.now
    controller.tick(seconds: 1, at: now)
    #expect(controller.heartRateZone == nil)
    feed.record(129, from: .chestStrap, at: now)
    controller.tick(seconds: 1, at: now)
    #expect(controller.heartRateZone?.label == "2")
    #expect(controller.heartRateZone?.name == "Aerobic")
    feed.record(130, from: .chestStrap, at: now)
    controller.tick(seconds: 1, at: now)
    #expect(controller.heartRateZone?.label == "3")
    #expect(controller.heartRateZone?.name == "Tempo")
  }

  @Test func showsNoHeartRateZoneWithoutThresholds() {
    let settings = RiderSettingsStore(settings: RiderSettings())
    #expect(settings.heartRateZones == nil)
    let feed = HeartRateFeed()
    let controller = RideController(
      template: template, ftp: 200, heartRateZones: settings.heartRateZones, heartRate: feed,
      simulated: false)
    let now = Date.now
    feed.record(150, from: .chestStrap, at: now)
    controller.tick(seconds: 1, at: now)
    #expect(controller.session.latest.heartRate == 150)
    #expect(controller.heartRateZone == nil)
  }

  @Test func reportsEachSecondForTheWatch() {
    let controller = RideController(template: template, ftp: 200, simulated: true)
    var glances: [RideGlance] = []
    controller.onTick = { glances.append(controller.glance) }
    defer { controller.onTick = nil }
    controller.tick(seconds: 1)
    controller.tick(seconds: 1)
    #expect(glances.map(\.interval?.remaining) == [179, 178])
    #expect(glances.first?.workoutName == "Recovery 30")
  }

  @Test func recordsLivePowerAndCadenceAndRefreshesThemWhilePaused() {
    let (devices, transport, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 180, 0, 250, 0]))
    controller.tick(seconds: 1)
    #expect(controller.session.latest.power == 250)
    #expect(controller.session.latest.cadence == 90)
    #expect(controller.session.samples.last?.sample.power == 250)
    #expect(controller.session.samples.last?.sample.cadence == 90)
    #expect(controller.glance.power == 250)

    controller.togglePause()
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 0, 0, 0, 0]))
    controller.tick(seconds: 1)
    #expect(controller.session.latest.power == 0)
    #expect(controller.session.latest.cadence == 0)
    #expect(controller.session.samples.count == 1)
  }

  @Test func showsPowerAsTheRiderChoseButRecordsEachReading() {
    let (devices, transport, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 180, 0, 250, 0]))
    controller.tick(seconds: 1)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 0, 0, 0, 0]))
    controller.tick(seconds: 1)
    #expect(controller.power == 125)
    #expect(controller.glance.power == 125)
    #expect(controller.session.samples.map(\.sample.power) == [250, 0])

    controller.powerDisplay = .instant
    #expect(controller.power == 0)
    #expect(controller.glance.power == 0)
  }

  @Test func liveCyclingReadingsOverrideSimulationAndExpire() {
    let (devices, _, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: true)
    let simulated = RideController(template: template, ftp: 200, simulated: true)
    let now = Date.now
    devices.receiveCycling(
      Data([0x45, 0, 180, 0, 250, 0]), from: trainer.id, characteristic: .indoorBike, at: now)
    controller.tick(seconds: 1, at: now)
    simulated.tick(seconds: 1, at: now)
    #expect(controller.session.latest.power == 250)
    #expect(controller.session.latest.cadence == 90)
    controller.tick(seconds: 1, at: now.addingTimeInterval(6))
    simulated.tick(seconds: 1, at: now.addingTimeInterval(6))
    #expect(controller.session.latest.power == simulated.session.latest.power)
    #expect(controller.session.latest.cadence == simulated.session.latest.cadence)
  }

  @Test func disconnectedAndExpiredSensorsLeaveGapsInTheRecording() {
    let (devices, transport, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    let now = Date.now
    devices.receiveCycling(
      Data([0x45, 0, 180, 0, 250, 0]), from: trainer.id, characteristic: .indoorBike, at: now)
    controller.tick(seconds: 1, at: now.addingTimeInterval(6))
    #expect(controller.session.latest.power == nil)
    #expect(controller.session.latest.cadence == nil)
    devices.receiveCycling(
      Data([0x45, 0, 180, 0, 250, 0]), from: trainer.id, characteristic: .indoorBike, at: now)
    transport.onDisconnect?(trainer.id)
    controller.tick(seconds: 1, at: now)
    #expect(controller.session.samples.last?.sample.power == nil)
    #expect(controller.session.samples.last?.sample.cadence == nil)
  }

  @Test func takesTheCurrentSensorPickEachSecond() {
    let (devices, transport, trainer) = cyclingDevices()
    let meter = DiscoveredDevice(id: UUID(), name: "Assioma", services: [.power])
    devices.pair(meter)
    transport.onConnect?(meter.id)
    transport.onCyclingMeasurement?(trainer.id, .indoorBike, Data([0x45, 0, 180, 0, 200, 0]))
    transport.onCyclingMeasurement?(meter.id, .power, Data([0, 0, 220, 0]))
    devices.select(trainer, for: .cadence)
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    controller.tick(seconds: 1)
    #expect(controller.session.latest.power == 220)
    #expect(controller.session.latest.cadence == 90)
    devices.select(trainer, for: .power)
    controller.tick(seconds: 1)
    #expect(controller.session.latest.power == 200)
  }

  @Test func setsTheTrainerForEachModeAndHandsItBackWhenTheRideStops() {
    let (devices, transport, trainer) = cyclingDevices()
    let controller = RideController(
      template: template, ftp: 200, devices: devices, simulated: false)
    func answerLastWrite() {
      guard let opCode = transport.trainerWrites.last?.first else { return }
      transport.onTrainerValue?(trainer.id, .controlPoint, Data([0x80, opCode, 0x01]))
    }
    transport.onTrainerValue?(trainer.id, .resistanceRange, Data([0, 0, 200, 0, 1, 0]))
    transport.onTrainerControlReady?(trainer.id)
    controller.tick(seconds: 1)
    answerLastWrite()
    answerLastWrite()
    let power = controller.session.targetPower!
    #expect(transport.trainerWrites.last == FitnessMachineCommand.targetPower(power).data)

    answerLastWrite()
    controller.adjust(by: 5)
    #expect(
      transport.trainerWrites.last
        == FitnessMachineCommand.targetPower(controller.session.targetPower!).data)
    #expect(controller.session.targetPower! > power)

    answerLastWrite()
    controller.mode = .slope
    #expect(transport.trainerWrites.last == FitnessMachineCommand.simulation(grade: 2).data)

    answerLastWrite()
    controller.mode = .level
    #expect(
      transport.trainerWrites.last
        == FitnessMachineCommand.targetResistance(60, wide: false).data)

    answerLastWrite()
    controller.stop()
    #expect(transport.trainerWrites.last == FitnessMachineCommand.reset.data)
  }

  @Test func showsTheRidersSensorsAndTheWatchOnceItSendsDuringTheRide() {
    let (devices, transport, trainer) = cyclingDevices()
    let heartRate = HeartRateFeed()
    let session = RideSession(workout: template.workout(ftp: 200))
    // From an earlier ride, so not this one's.
    heartRate.record(140, from: .watch, at: session.startDate - 60)
    let controller = RideController(
      template: template, ftp: 200, heartRate: heartRate, devices: devices, session: session,
      simulated: false)
    let now = Date.now
    #expect(controller.hasSensors)
    #expect(controller.sensorStatuses(at: now).map(\.source) == [.trainer])
    #expect(controller.sensorStatuses(at: now + 6).map(\.health) == [.quiet])
    heartRate.record(140, from: .watch, at: now)
    #expect(controller.sensorStatuses(at: now).map(\.source) == [.trainer, .watch])
    transport.onDisconnect?(trainer.id)
    #expect(controller.sensorStatuses(at: now).first?.health == .connecting)
    #expect(!RideController(template: template, ftp: 200, simulated: true).hasSensors)
  }

  private func cyclingDevices() -> (BluetoothDevices, CyclingTestTransport, DiscoveredDevice) {
    let transport = CyclingTestTransport()
    let defaults = UserDefaults(suiteName: "RideControllerTests.\(UUID().uuidString)")!
    let devices = BluetoothDevices(transport: transport, defaults: defaults)
    let trainer = DiscoveredDevice(id: UUID(), name: "KICKR", services: [.trainer])
    devices.startScanning()
    devices.pair(trainer)
    transport.onConnect?(trainer.id)
    return (devices, transport, trainer)
  }
}

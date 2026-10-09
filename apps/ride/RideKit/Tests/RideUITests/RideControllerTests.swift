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

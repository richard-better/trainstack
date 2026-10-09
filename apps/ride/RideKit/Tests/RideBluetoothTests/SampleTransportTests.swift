import Testing

@testable import RideBluetooth

@MainActor
struct SampleTransportTests {
  @Test(.timeLimit(.minutes(1)))
  func connectedDevicesDoNotRetainTheTransport() async {
    var transport: SampleTransport? = SampleTransport()
    weak let released = transport
    let (connections, continuation) = AsyncStream.makeStream(
      of: Void.self, bufferingPolicy: .bufferingNewest(1))
    transport?.onConnect = { _ in continuation.yield(()) }
    transport?.connect(SampleTransport.trainer.id)
    var iterator = connections.makeAsyncIterator()
    await iterator.next()
    transport = nil
    #expect(released == nil)
    released?.disconnect(SampleTransport.trainer.id)
    continuation.finish()
  }
}

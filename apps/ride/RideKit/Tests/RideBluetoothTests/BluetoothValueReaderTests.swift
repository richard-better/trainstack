import Foundation
import Testing

@testable import RideBluetooth

struct BluetoothValueReaderTests {
  @Test func readsLittleEndianFields() {
    var reader = BluetoothValueReader(Data([0x2C, 0x01, 0x07]))
    let wide = reader.uint16()
    let narrow = reader.uint8()
    #expect(wide == 300)
    #expect(narrow == 7)
  }

  @Test func readsFromAnUnalignedSlice() {
    var reader = BluetoothValueReader(Data([0xFF, 0x2C, 0x01]).dropFirst())
    let value = reader.uint16()
    #expect(value == 300)
  }

  @Test func returnsNothingPastTheEndOfAShortPacket() {
    var reader = BluetoothValueReader(Data([0x2C]))
    let wide = reader.uint16()
    let narrow = reader.uint8()
    #expect(wide == nil)
    #expect(narrow == nil)
  }

  @Test func skipsOnlyWhenEnoughBytesRemain() {
    var reader = BluetoothValueReader(Data([1, 2, 3]))
    let skippedPastTheEnd = reader.skip(4)
    let skippedTwo = reader.skip(2)
    let last = reader.uint8()
    #expect(!skippedPastTheEnd)
    #expect(skippedTwo)
    #expect(last == 3)
  }
}

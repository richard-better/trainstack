import Testing

@testable import RideUI

struct AppleSignInNonceTests {
  @Test func givesAppleTheSHA256OfTheRawNonceTheServerGets() {
    let sha256OfABCInHex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    #expect(AppleSignInNonce(raw: "abc").sha256ForApple == sha256OfABCInHex)
  }

  @Test func makesANewHardToGuessNonceEveryTime() {
    let first = AppleSignInNonce()
    let second = AppleSignInNonce()
    #expect(first.raw != second.raw)
    #expect(first.raw.count == 64)
    #expect(first.sha256ForApple.count == 64)
  }
}

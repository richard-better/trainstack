import Security

public struct SessionStoreError: Error, Equatable {
  public let status: OSStatus
}

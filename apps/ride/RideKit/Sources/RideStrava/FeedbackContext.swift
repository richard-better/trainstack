public struct FeedbackContext: Equatable, Sendable {
  public var app: String?
  public var system: String?
  public var device: String?
  public var screen: String?
  public var window: String?

  public init(
    app: String? = nil, system: String? = nil, device: String? = nil, screen: String? = nil,
    window: String? = nil
  ) {
    self.app = app
    self.system = system
    self.device = device
    self.screen = screen
    self.window = window
  }

  var json: [String: String] {
    let fields = [
      "app": app, "system": system, "device": device, "screen": screen, "window": window,
    ]
    return fields.compactMapValues { $0 }
  }
}

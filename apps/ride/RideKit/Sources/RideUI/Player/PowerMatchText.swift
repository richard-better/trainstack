enum PowerMatchText {
  static func detail(correction percent: Int) -> String {
    switch percent {
    case 0: "Power match"
    case 1...: "Power match +\(percent)%"
    default: "Power match −\(-percent)%"
    }
  }
}

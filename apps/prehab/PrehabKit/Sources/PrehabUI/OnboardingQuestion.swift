import Foundation
import PrehabCore

struct OnboardingQuestion: Decodable, Identifiable {
  let id: String
  let title: String
  let skippable: Bool
  let schema: JSONValue
  var choices: [String] {
    (schema["items"]["enum"].array + schema["enum"].array).compactMap(\.string)
  }
  static func load() throws -> [Self] {
    guard let url = Bundle.module.url(forResource: "onboarding", withExtension: "json") else {
      throw CocoaError(.fileNoSuchFile)
    }
    return try JSONDecoder().decode([Self].self, from: Data(contentsOf: url))
  }
}

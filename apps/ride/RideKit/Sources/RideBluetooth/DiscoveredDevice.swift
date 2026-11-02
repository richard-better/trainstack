import Foundation

public struct DiscoveredDevice: Identifiable, Equatable, Codable, Sendable {
  public let id: UUID
  public var name: String?
  public var services: Set<FitnessService>

  public var displayName: String { name ?? "Unnamed device" }
  public var isFitness: Bool { !services.isEmpty }

  public var kind: FitnessService? {
    FitnessService.mostCapableFirst.first(where: services.contains)
  }

  public init(id: UUID, name: String? = nil, services: Set<FitnessService> = []) {
    self.id = id
    self.name = name
    self.services = services
  }
}

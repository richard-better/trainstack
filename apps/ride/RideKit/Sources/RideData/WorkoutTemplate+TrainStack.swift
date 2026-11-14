import Foundation

extension WorkoutTemplate {
  public var builtinID: String {
    let searchable = String(
      String.UnicodeScalarView(
        name.decomposedStringWithCompatibilityMapping.unicodeScalars.filter {
          !$0.properties.generalCategory.isMark
        })
    ).replacing("×", with: "x").lowercased()
    var slug = ""
    var pendingHyphen = false
    for character in searchable {
      if character.isASCII, character.isLetter || character.isNumber {
        if pendingHyphen, !slug.isEmpty { slug.append("-") }
        pendingHyphen = false
        slug.append(character)
      } else {
        pendingHyphen = true
      }
    }
    return slug
  }

  public var trainStackWorkout: TrainStackWorkout {
    TrainStackWorkout(
      name: name, sport: .cycling, description: about.isEmpty ? nil : about,
      focus: TrainStackWorkout.Focus(category),
      blocks: steps.map {
        .step(
          .init(
            duration: .seconds($0.duration),
            target: .power(unit: "ftp", level: .constant($0.intensity))))
      })
  }

  public static func builtin(_ id: String) -> WorkoutTemplate? {
    library.first { $0.builtinID == id }
  }
}

extension TrainStackWorkout.Focus {
  init(_ zone: PowerZone) {
    self =
      switch zone {
      case .recovery: .recovery
      case .endurance: .endurance
      case .tempo: .tempo
      case .threshold: .threshold
      case .vo2Max: .vo2Max
      case .anaerobic: .anaerobic
      }
  }
}

extension Unicode.GeneralCategory {
  fileprivate var isMark: Bool {
    switch self {
    case .nonspacingMark, .spacingMark, .enclosingMark: true
    default: false
    }
  }
}

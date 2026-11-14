import RideStrava

enum PlannedItemAction: Identifiable {
  case skip(PlannedItem)
  case move(PlannedItem)
  case unpair(PlannedItem)

  var id: String {
    switch self {
    case .skip(let item): "skip-\(item.id)"
    case .move(let item): "move-\(item.id)"
    case .unpair(let item): "unpair-\(item.id)"
    }
  }
}

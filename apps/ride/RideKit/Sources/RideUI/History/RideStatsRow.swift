import SwiftUI

/// A ride's headline numbers in one row when they fit, otherwise in a grid.
struct RideStatsRow: View {
  let stats: [RideStat]

  var body: some View {
    ViewThatFits(in: .horizontal) {
      DividedRow(spacing: 16) {
        ForEach(stats, content: RideStatCell.init)
      }
      grid(columns: 3)
      grid(columns: 2)
    }
    .overlay(alignment: .top) { Divider() }
    .overlay(alignment: .bottom) { Divider() }
  }

  private func grid(columns: Int) -> some View {
    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 0) {
      ForEach(Array(stride(from: 0, to: stats.count, by: columns)), id: \.self) { start in
        GridRow {
          ForEach(stats[start..<min(start + columns, stats.count)], content: RideStatCell.init)
        }
      }
    }
  }
}

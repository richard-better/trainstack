import RideStrava
import SwiftUI

struct TodayPlannedCard: View {
  let item: PlannedItem
  let isFirstToStart: Bool
  @Environment(\.openWorkout) private var openWorkout
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button(action: open) {
        VStack(alignment: .leading, spacing: 0) {
          PlannedItemThumbnail(item: item, ftp: settings.ftp)
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .frame(height: 160)
            .background(.primary.opacity(0.05))
            .opacity(item.state == .skipped ? 0.4 : 1)
          VStack(alignment: .leading, spacing: 6) {
            Text(item.title)
              .font(.title2.bold())
              .strikethrough(item.state == .skipped)
            Text(item.summary)
              .font(.callout.monospacedDigit())
              .foregroundStyle(.secondary)
            PlannedItemStateLabel(item: item)
              .font(.callout)
            if item.state != .completed, let why = item.whyItCannotBeRidden {
              Label(why, systemImage: "exclamationmark.circle")
                .font(.callout)
                .foregroundStyle(.orange)
            }
            if let notes = item.notes {
              Text(notes)
                .font(.callout)
                .foregroundStyle(.secondary)
            }
          }
          .padding([.horizontal, .top], 20)
          .padding(.bottom, item.canStart ? 0 : 20)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
      }
      .buttonStyle(.plain)
      if item.canStart {
        start
          .controlSize(.extraLarge)
          .padding(20)
      }
    }
    .background(.primary.opacity(0.04))
    .clipShape(.rect(cornerRadius: 22))
    .overlay {
      RoundedRectangle(cornerRadius: 22)
        .strokeBorder(
          item.state == .planned ? Color.accentColor : Color.secondary.opacity(0.3),
          style: StrokeStyle(
            lineWidth: item.state == .planned ? 2 : 1, dash: item.state == .planned ? [6, 4] : []))
    }
  }

  @ViewBuilder private var start: some View {
    let button = StartButton(
      workout: item.playable, title: "Start ride", isDefaultAction: false)
    if isFirstToStart {
      button.buttonStyle(.glassProminent)
    } else {
      button.buttonStyle(.glass)
    }
  }

  private func open() { openWorkout(PlannedItemRoute(id: item.id)) }
}

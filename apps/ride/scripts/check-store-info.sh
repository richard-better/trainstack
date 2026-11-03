#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ] || [ ! -d "$1" ]; then
  echo "usage: check-store-info.sh <path to Ride.app>" >&2
  exit 2
fi

app="$1"
failed=0

fail() {
  echo "::error::$1"
  failed=1
}

mac_categories=(
  business developer-tools education entertainment finance games graphics-design
  healthcare-fitness lifestyle medical music news photography productivity reference
  social-networking sports travel utilities video weather
  action-games adventure-games arcade-games board-games card-games casino-games dice-games
  educational-games family-games kids-games music-games puzzle-games racing-games
  role-playing-games simulation-games sports-games strategy-games trivia-games word-games
)

ios_background_modes=(
  audio bluetooth-central bluetooth-peripheral external-accessory fetch location
  nearby-interaction network-authentication processing push-to-talk remote-notification voip
)

contains() {
  local wanted="$1"
  shift
  local item
  for item in "$@"; do
    [ "$item" == "$wanted" ] && return 0
  done
  return 1
}

require_app_plist() {
  if ! plutil -extract CFBundleIdentifier raw -o - "$1" >/dev/null 2>&1; then
    echo "::error::$1 is not an app's Info.plist."
    exit 1
  fi
}

if [ -f "$app/Contents/Info.plist" ]; then
  plist="$app/Contents/Info.plist"
  require_app_plist "$plist"
  category="$(plutil -extract LSApplicationCategoryType raw -o - "$plist" 2>/dev/null || true)"
  if [[ "$category" != public.app-category.* ]] ||
    ! contains "${category#public.app-category.}" "${mac_categories[@]}"; then
    fail "The Mac app's LSApplicationCategoryType is '$category', not one App Store Connect accepts."
  fi
elif [ -f "$app/Info.plist" ]; then
  plist="$app/Info.plist"
  require_app_plist "$plist"
  if plutil -extract UIBackgroundModes raw -o - "$plist" >/dev/null 2>&1; then
    if [ "$(plutil -type UIBackgroundModes "$plist")" != array ]; then
      fail "UIBackgroundModes must be an array."
    else
      count="$(plutil -extract UIBackgroundModes raw -o - "$plist")"
      for ((index = 0; index < count; index++)); do
        mode="$(plutil -extract "UIBackgroundModes.$index" raw -o - "$plist")"
        if ! contains "$mode" "${ios_background_modes[@]}"; then
          fail "UIBackgroundModes has '$mode', which App Store Connect rejects for an iOS app."
        fi
      done
    fi
  fi
else
  echo "::error::$app has no Info.plist."
  exit 1
fi

exit "$failed"

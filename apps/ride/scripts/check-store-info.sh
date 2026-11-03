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

read_key() {
  /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2>/dev/null || true
}

if [ -f "$app/Contents/Info.plist" ]; then
  plist="$app/Contents/Info.plist"
  category="$(read_key "$plist" LSApplicationCategoryType)"
  if [[ "$category" != public.app-category.* ]]; then
    fail "The Mac app needs LSApplicationCategoryType, or App Store Connect rejects the upload."
  fi
else
  plist="$app/Info.plist"
  ios_background_modes="audio bluetooth-central bluetooth-peripheral external-accessory fetch location nearby-interaction network-authentication processing push-to-talk remote-notification voip"
  while read -r mode; do
    [ -z "$mode" ] && continue
    if [[ " $ios_background_modes " != *" $mode "* ]]; then
      fail "UIBackgroundModes has '$mode', which App Store Connect rejects for an iOS app."
    fi
  done < <(/usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" "$plist" 2>/dev/null | sed -e '1d' -e '$d' -e 's/^ *//')
fi

exit "$failed"

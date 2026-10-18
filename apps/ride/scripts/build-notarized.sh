#!/usr/bin/env bash
# Builds Ride for macOS signed with Developer ID, notarizes and staples it, and writes
# Ride-<version>.zip and SHA256SUMS to the output directory. Homebrew installs that ZIP.
#
# Usage: build-notarized.sh <version> <build number> <output directory>
#
# The version is a named release such as 1.2.0, or an alpha such as 1.2-alpha.2610151230. The app's
# marketing version is the part before any suffix.
#
# In CI, set ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID to an App Store Connect API key with the
# Admin role: Xcode signs with it and notarytool submits with it. Locally, leave them unset to
# sign with the Xcode account and set NOTARY_KEYCHAIN_PROFILE to a profile saved with
# `xcrun notarytool store-credentials`.
set -euo pipefail

[[ $# == 3 ]] || { echo "Usage: $0 <version> <build number> <output directory>" >&2; exit 64; }
version="$1"
build="$2"
output="$3"
[[ "$version" =~ ^([0-9]+\.[0-9]+(\.[0-9]+)?)(-alpha\.[0-9]+)?$ ]] || { echo "Unexpected version $version" >&2; exit 64; }
marketing="${BASH_REMATCH[1]}"
[[ "$build" =~ ^[0-9]+$ ]] || { echo "Unexpected build number $build" >&2; exit 64; }

ride="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

auth=()
notary=()
if [[ -n "${ASC_KEY_PATH:-}" ]]; then
  : "${ASC_KEY_ID:?Set ASC_KEY_ID with ASC_KEY_PATH}"
  : "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID with ASC_KEY_PATH}"
  auth=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
  notary=(--key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID")
else
  : "${NOTARY_KEYCHAIN_PROFILE:?Set ASC_KEY_PATH, or NOTARY_KEYCHAIN_PROFILE to build locally}"
  notary=(--keychain-profile "$NOTARY_KEYCHAIN_PROFILE")
fi

xcodebuild archive \
  -project "$ride/Ride.xcodeproj" \
  -scheme Ride \
  -destination generic/platform=macOS \
  -archivePath "$work/Ride.xcarchive" \
  -allowProvisioningUpdates \
  "${auth[@]}" \
  CODE_SIGN_ENTITLEMENTS=Ride/Ride-macOS-DeveloperID.entitlements \
  MARKETING_VERSION="$marketing" \
  CURRENT_PROJECT_VERSION="$build"
xcodebuild -exportArchive \
  -archivePath "$work/Ride.xcarchive" \
  -exportPath "$work/export" \
  -exportOptionsPlist "$ride/ExportOptions-DeveloperID.plist" \
  -allowProvisioningUpdates \
  "${auth[@]}"

app="$work/export/Ride.app"
plist="$app/Contents/Info.plist"
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$plist")" == com.trainstackhq.ride ]] || { echo 'Unexpected bundle ID' >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$plist")" == "$marketing" ]] || { echo 'Unexpected marketing version' >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$plist")" == "$build" ]] || { echo 'Unexpected build number' >&2; exit 1; }
# Developer ID Application, issued to the TrainStack team.
requirement='anchor apple generic and identifier "com.trainstackhq.ride" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "S64PDPJKMJ"'
codesign --verify --deep --strict --verbose=2 --test-requirement="=$requirement" "$app"
# Developer ID cannot hold Sign in with Apple, but the keychain needs the application identifier.
# PlistBuddy, unlike plutil, does not split these keys at their dots.
codesign --display --entitlements "$work/entitlements.plist" --xml "$app"
for key in com.apple.application-identifier com.apple.security.app-sandbox com.apple.security.device.bluetooth; do
  /usr/libexec/PlistBuddy -c "Print :$key" "$work/entitlements.plist" > /dev/null || { echo "Missing entitlement $key" >&2; exit 1; }
done
if /usr/libexec/PlistBuddy -c 'Print :com.apple.developer.applesignin' "$work/entitlements.plist" > /dev/null 2>&1; then
  echo 'Developer ID build must not hold Sign in with Apple' >&2
  exit 1
fi

ditto -c -k --keepParent "$app" "$work/submission.zip"
status=0
xcrun notarytool submit "$work/submission.zip" "${notary[@]}" --wait --timeout 30m --output-format json > "$work/notarization.json" || status=$?
cat "$work/notarization.json"
echo
if [[ "$(plutil -extract status raw "$work/notarization.json" 2> /dev/null)" != Accepted ]]; then
  if id="$(plutil -extract id raw "$work/notarization.json" 2> /dev/null)"; then
    xcrun notarytool log "$id" "${notary[@]}"
  fi
  echo 'Notarization failed' >&2
  exit 1
fi
[[ "$status" == 0 ]] || exit "$status"
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"

mkdir -p "$output"
zip="Ride-$version.zip"
ditto -c -k --keepParent "$app" "$output/$zip"
(cd "$output" && shasum -a 256 "$zip" > SHA256SUMS)
cat "$output/SHA256SUMS"

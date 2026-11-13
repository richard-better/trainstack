#!/bin/sh
set -eu
root=$(git rev-parse --show-toplevel)
data="$root/apps/ride/RideKit/Sources/RideData"
traces="$root/apps/ride/RideKit/Tests/RideCoreTests/Traces"
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
swiftc -O -parse-as-library -o "$build/reference" \
  $(ls "$data"/*.swift | grep -v SampleRide.swift) \
  "$root/packages/analysis/test/reference/Reference.swift"
"$build/reference" \
  "$data/Resources/SampleRide.fit" \
  "$traces/quick-test-trainer-drop.fit" \
  "$traces/recovery-every-control.fit" \
  "$traces/trainer-and-strap.fit" \
  > "$root/packages/analysis/test/fixtures/ride-reference.json"
cd "$root" && bunx vp fmt packages/analysis/test/fixtures/ride-reference.json

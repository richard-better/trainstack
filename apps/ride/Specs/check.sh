#!/usr/bin/env bash
set -euo pipefail
specs=$(cd "$(dirname "$0")" && pwd)
cache="${XDG_CACHE_HOME:-$HOME/.cache}/ride-tla"
version=1.7.4
digest=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
mkdir -p "$cache"
jar="$cache/tla2tools-$version.jar"
verify() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s  %s\n' "$digest" "$1" | sha256sum --check --status
  else
    [[ $(shasum -a 256 "$1" | cut -d ' ' -f 1) == "$digest" ]]
  fi
}
if [[ ! -f "$jar" ]] || ! verify "$jar"; then
  download=$(mktemp "$cache/download.XXXXXX")
  trap 'rm -f "$download"' EXIT
  curl --fail --location --retry 3 --output "$download" \
    "https://github.com/tlaplus/tlaplus/releases/download/v$version/tla2tools.jar"
  verify "$download"
  mv "$download" "$jar"
fi
run=$(mktemp -d "$cache/run.XXXXXX")
trap 'rm -rf "$run"' EXIT
java="${JAVA_HOME:+$JAVA_HOME/bin/}java"
if [[ -z ${JAVA_HOME:-} && -x /usr/bin/java ]]; then java=/usr/bin/java; fi
for spec in "$specs"/*.tla; do
  name=$(basename "$spec" .tla)
  printf '\nChecking %s\n' "$name"
  "$java" -XX:+UseParallelGC -Xmx2g -cp "$jar" tlc2.TLC \
    -workers 2 -cleanup -metadir "$run/$name" \
    -config "$specs/$name.cfg" "$spec"
done

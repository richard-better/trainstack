#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 2 ] || [ ! -f "$1" ] || [ -z "${DEVELOPER_ID_P12_PASSWORD:-}" ]; then
  echo "usage: DEVELOPER_ID_P12_PASSWORD=... import-developer-id.sh <Developer ID .p12> <new keychain path>" >&2
  exit 64
fi

p12="$1"
keychain="$2"
keychain_password="$(openssl rand -hex 24)"

security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$p12" -k "$keychain" -f pkcs12 -x -P "$DEVELOPER_ID_P12_PASSWORD" -T /usr/bin/codesign > /dev/null

if ! security find-identity -v -p codesigning "$keychain" | grep -q '"Developer ID Application: .* (S64PDPJKMJ)"'; then
  echo "error: the .p12 holds no Developer ID Application certificate for team S64PDPJKMJ together with its private key." >&2
  echo "Export it from the My Certificates tab in Keychain Access, which includes the key." >&2
  exit 1
fi

security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" > /dev/null

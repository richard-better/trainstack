#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: set-developer-id-secrets.sh <Developer ID .p12>" >&2
  exit 64
fi

p12="$1"
repo=richard-better/trainstack
work="$(mktemp -d)"
trap 'security delete-keychain "$work/check.keychain-db" 2> /dev/null || true; rm -rf "$work"' EXIT

read -r -s -p "Password of $p12: " DEVELOPER_ID_P12_PASSWORD
echo
export DEVELOPER_ID_P12_PASSWORD

"$(dirname "$0")/import-developer-id.sh" "$p12" "$work/check.keychain-db"
echo "The .p12 holds the Developer ID certificate and its private key."

base64 -i "$p12" | gh secret set DEVELOPER_ID_P12_BASE64 --env testflight --repo "$repo"
printf '%s' "$DEVELOPER_ID_P12_PASSWORD" | gh secret set DEVELOPER_ID_P12_PASSWORD --env testflight --repo "$repo"
rm -f "$p12"
echo "Set DEVELOPER_ID_P12_BASE64 and DEVELOPER_ID_P12_PASSWORD on the testflight environment, and deleted $p12."

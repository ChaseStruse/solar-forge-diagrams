#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)
# Every manifest must agree before a release archive is cut.
for manifest in src-tauri/Cargo.toml src-tauri/tauri.conf.json packaging/omarchy/pkgbuilds/solar-forge-diagrams/PKGBUILD; do
  if ! grep -Eq "^(version = \"$version\"|  \"version\": \"$version\",|pkgver=$version)$" "$manifest"; then
    echo "Version mismatch: $manifest does not declare $version (package.json)." >&2
    exit 1
  fi
done
# Cargo.lock records the app's own version; --locked builds fail if it is stale.
if ! grep -A1 -x 'name = "solar-forge-diagrams"' src-tauri/Cargo.lock | grep -qx "version = \"$version\""; then
  echo "Version mismatch: src-tauri/Cargo.lock does not declare $version for solar-forge-diagrams." >&2
  exit 1
fi
mkdir -p artifacts
# Archive tracked source at the current reviewed commit, never credentials/caches.
git archive --format=tar.gz --prefix="solar-forge-diagrams-$version/" HEAD > "artifacts/solar-forge-diagrams-$version.tar.gz"
sha256sum "artifacts/solar-forge-diagrams-$version.tar.gz"

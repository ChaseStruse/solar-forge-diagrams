#!/usr/bin/env bash
set -euo pipefail
if (( $# != 1 )); then
  echo 'Usage: scripts/omarchy-bundle.sh /path/to/solar-forge-diagrams-VERSION-x86_64.pkg.tar.zst' >&2
  exit 2
fi
package=$(realpath -- "$1")
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
metadata=$(LC_ALL=C pacman -Qp -- "$package")
read -r name version <<< "$metadata"
if [[ $name != solar-forge-diagrams || $(basename -- "$package") != "solar-forge-diagrams-$version-x86_64.pkg.tar.zst" ]]; then
  echo 'Expected an x86_64 Solar Forge application package.' >&2
  exit 1
fi
mkdir -p artifacts/omarchy
bundle="solar-forge-diagrams-$version-omarchy-x86_64"
staging=$(mktemp -d "$PWD/artifacts/omarchy/.bundle.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
mkdir "$staging/$bundle"
cp -- "$package" "$staging/$bundle/"
cp packaging/omarchy/install.sh "$staging/$bundle/"
cp packaging/omarchy/README.md "$staging/$bundle/README.md"
cp docs/USER_GUIDE.md docs/DOCUMENTS.md docs/BUILDING.md "$staging/$bundle/"
(
  cd "$staging/$bundle"
  sha256sum -- ./* > SHA256SUMS
)
tar -czf "artifacts/omarchy/$bundle.tar.gz" -C "$staging" "$bundle"
# A fixed-name copy lets releases/latest/download/<name> links stay valid across versions.
latest=solar-forge-diagrams-omarchy-x86_64.tar.gz
cp -- "artifacts/omarchy/$bundle.tar.gz" "artifacts/omarchy/$latest"
(
  cd artifacts/omarchy
  sha256sum -- "$bundle.tar.gz" "$latest" | tee "$bundle.SHA256SUMS"
)

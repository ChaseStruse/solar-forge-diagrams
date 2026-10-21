#!/usr/bin/env bash
# Build the Omarchy release package and install bundle inside Docker; no host Rust or makepkg needed.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -n $(git status --porcelain) ]]; then
  echo 'Warning: uncommitted changes are not included; the release is built from HEAD.' >&2
fi
scripts/source-archive.sh
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)
input=$(mktemp -d "$PWD/artifacts/.release-input.XXXXXX")
trap 'rm -rf -- "$input"' EXIT
cp -- "artifacts/solar-forge-diagrams-$version.tar.gz" "$input/"
docker buildx build --target release-artifacts \
  --build-context release-source="$input" \
  --output type=local,dest="artifacts/release/$version" .
echo "Release files in artifacts/release/$version:"
ls -l "artifacts/release/$version"

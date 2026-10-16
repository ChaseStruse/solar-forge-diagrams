#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p artifacts
# Archive tracked source at the current reviewed commit, never credentials/caches.
git archive --format=tar.gz --prefix=solar-forge-diagrams-0.1.0/ HEAD > artifacts/solar-forge-diagrams-0.1.0.tar.gz
sha256sum artifacts/solar-forge-diagrams-0.1.0.tar.gz

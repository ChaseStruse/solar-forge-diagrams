#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  --help|-h)
    echo 'Usage: ./install.sh [--check]'
    echo 'Verify and install the bundled Solar Forge package on x86_64 Omarchy.'
    echo '--check verifies the bundle without installing anything.'
    exit 0 ;;
  ''|--check) ;;
  *) echo 'Usage: ./install.sh [--check]' >&2; exit 2 ;;
esac
if (( $# > 1 )); then
  echo 'Usage: ./install.sh [--check]' >&2
  exit 2
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
for command in sha256sum pacman uname awk; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
if [[ $(awk -F= '$1 == "ID" {gsub(/"/, "", $2); print $2}' /etc/os-release) != omarchy ]]; then
  echo 'This installer targets Omarchy. See BUILDING.md for the package recipe.' >&2
  exit 1
fi
if [[ $(uname -m) != x86_64 ]]; then
  echo 'This alpha bundle supports x86_64 Omarchy only.' >&2
  exit 1
fi
sha256sum --check --strict SHA256SUMS
shopt -s nullglob
packages=(solar-forge-diagrams-[0-9]*-x86_64.pkg.tar.zst)
if (( ${#packages[@]} != 1 )); then
  echo 'Expected exactly one Solar Forge application package.' >&2
  exit 1
fi
package=${packages[0]}
metadata=$(LC_ALL=C pacman -Qp -- "$package")
read -r name version <<< "$metadata"
if [[ $name != solar-forge-diagrams ]]; then
  echo 'Unexpected package identity.' >&2
  exit 1
fi
printf 'Verified Solar Forge Diagrams %s for Omarchy.\n' "$version"
if [[ ${1:-} == --check ]]; then
  exit 0
fi

# Omarchy's `pkg add` uses pacman -S for repository names, not local files.
# Keep the normal pacman transaction/confirmation for this unpublished bundle.
if (( EUID == 0 )); then
  pacman -U -- "$package"
else
  sudo pacman -U -- "$package"
fi
printf '\nLaunch Solar Forge Diagrams from the Omarchy application launcher (Super+Space).\n'

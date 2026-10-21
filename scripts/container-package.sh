#!/usr/bin/env bash
# Runs inside the omarchy-package Docker stage: build, check and bundle one source archive.
set -euo pipefail
input=$1
out=$2
shopt -s nullglob
archives=("$input"/solar-forge-diagrams-*.tar.gz)
if (( ${#archives[@]} != 1 )); then
  echo "Expected exactly one source archive in $input." >&2
  exit 1
fi
archive=${archives[0]}
version=${archive##*/solar-forge-diagrams-}
version=${version%.tar.gz}
work=$(mktemp -d)
tar -xzf "$archive" -C "$work"
source="$work/solar-forge-diagrams-$version"
recipe="$work/recipe"
cp -r "$source/packaging/omarchy/pkgbuilds/solar-forge-diagrams" "$recipe"
cp -- "$archive" "$recipe/"

# The PKGBUILD runs bun verify and cargo test. Build tools come from this image, not pacman.
sum=$(sha256sum -- "$archive" | cut -d' ' -f1)
sed -i "s/^sha256sums=.*/sha256sums=('$sum')/" "$recipe/PKGBUILD"
(cd "$recipe" && makepkg --nodeps --cleanbuild --noconfirm)
packages=("$recipe/solar-forge-diagrams-$version"-*-x86_64.pkg.tar.zst)
if (( ${#packages[@]} != 1 )); then
  echo 'Expected exactly one application package from makepkg.' >&2
  exit 1
fi

# Remaining Rust release gates, on the tree makepkg just built (it holds node_modules and dist).
built="$recipe/src/solar-forge-diagrams-$version"
cargo fmt --manifest-path "$built/src-tauri/Cargo.toml" --check
cargo clippy --manifest-path "$built/src-tauri/Cargo.toml" --locked --all-targets -- -D warnings

"$source/scripts/omarchy-bundle.sh" "${packages[0]}"
mkdir -p "$out"
cp -- "${packages[0]}" "$archive" "$source"/artifacts/omarchy/* "$out/"
(cd "$out" && sha256sum -- * > SHA256SUMS)

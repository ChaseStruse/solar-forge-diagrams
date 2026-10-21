# Releasing

Releases are GitHub Releases on `ChaseStruse/solar-forge-diagrams`. Each release carries the Omarchy install bundle under two names: a versioned one, and a fixed name that external pages (such as chasestruse.github.io) link to permanently:

```
https://github.com/ChaseStruse/solar-forge-diagrams/releases/latest/download/solar-forge-diagrams-omarchy-x86_64.tar.gz
```

`releases/latest` skips drafts and pre-releases. **Publish alpha releases as normal releases**, not pre-releases, or that link breaks.

## 1. Set the version

Pick `X.Y.Z` per [Semantic Versioning](https://semver.org/) and set it in all four manifests:

- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `"version"`
- `packaging/omarchy/pkgbuilds/solar-forge-diagrams/PKGBUILD` → `pkgver`, and reset `pkgrel=1`. Increase `pkgrel` only for packaging-only rebuilds of the same version.

Also update the app's own entry in `src-tauri/Cargo.lock`: the `version` line directly below `name = "solar-forge-diagrams"`. Dependencies are unchanged, and `--locked` builds fail if this entry is stale. `scripts/source-archive.sh` checks all five files.

Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `[X.Y.Z] — YYYY-MM-DD` heading, update `docs/STATUS.md`, and merge to `main`.

## 2. Build and verify in Docker

From a clean checkout of `main`, with Docker running:

```sh
scripts/docker-release.sh
```

The script git-archives `HEAD` (stopping if the five version entries disagree) and builds it in the pinned Arch container stage `omarchy-package`. Nothing is compiled on the host, and no host Rust, Bun or `makepkg` is needed. Inside the container it:

- builds the package with `makepkg`, whose PKGBUILD runs `bun run verify` (lint, types, tests, build, size budget) and `cargo test`
- runs `cargo fmt --check` and `cargo clippy -D warnings`
- creates the Omarchy install bundle

Outputs land in `artifacts/release/X.Y.Z/`:

- `solar-forge-diagrams-X.Y.Z-1-x86_64.pkg.tar.zst` (package)
- `solar-forge-diagrams-X.Y.Z-1-omarchy-x86_64.tar.gz` (versioned bundle)
- `solar-forge-diagrams-omarchy-x86_64.tar.gz` (fixed-name copy)
- `solar-forge-diagrams-X.Y.Z.tar.gz` (source archive)
- `SHA256SUMS`

Cargo, Bun and compiler caches persist between runs as BuildKit cache mounts. `docker builder prune` clears them.

## 3. Test the bundle

The container has no display, so the native `--smoke-test` and the install are checked on the host. Extract the bundle in a scratch directory, run `./install.sh --check`, then `./install.sh`, and launch the app from `Super+Space`. Installing is a normal pacman transaction for the finished package; it does not build anything.

## 4. Publish

```sh
git tag -a vX.Y.Z -m "Solar Forge Diagrams X.Y.Z"
git push origin vX.Y.Z
cd artifacts/release/X.Y.Z
gh release create vX.Y.Z \
  solar-forge-diagrams-X.Y.Z-1-omarchy-x86_64.tar.gz \
  solar-forge-diagrams-omarchy-x86_64.tar.gz \
  solar-forge-diagrams-X.Y.Z.tar.gz \
  SHA256SUMS \
  --title "Solar Forge Diagrams X.Y.Z" --notes-file <(sed -n '/^## \[X.Y.Z\]/,/^## \[/p' ../../../CHANGELOG.md | sed '1d;$d')
cd -
```

Afterwards confirm the fixed link downloads the new bundle:

```sh
curl -sIL https://github.com/ChaseStruse/solar-forge-diagrams/releases/latest/download/solar-forge-diagrams-omarchy-x86_64.tar.gz | grep -i '^location' | tail -1
```

Bundles are unsigned; the published `SHA256SUMS` lets users detect corruption.
